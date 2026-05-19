import { MAX_UPLOAD_BYTES, cleanedFileName, escapeHeaderFilename, formatBytes, isAudioFile, objectHeaders, randomToken, sanitizeFileName } from "./audio";
import { getJob, markJobFailed, publicJob } from "./db";
import { getErrorMessage, getPublicBaseUrl, json } from "./http";
import { parseModelOptions, REPLICATE_MODEL } from "./model";
import { applyPredictionResult, syncReplicatePrediction } from "./replicate";
import type { AppEnv, ReplicatePrediction } from "./types";

export async function createJob(request: Request, env: AppEnv): Promise<Response> {
	if (!env.REPLICATE_API_TOKEN) {
		return json({ error: "Missing REPLICATE_API_TOKEN secret." }, 500);
	}

	const rateLimitResponse = await enforceUploadRateLimit(request, env);
	if (rateLimitResponse) {
		return rateLimitResponse;
	}

	const baseUrl = getPublicBaseUrl(request);
	if (!baseUrl) {
		return json(
			{
				error: "Replicate needs a public HTTPS URL to fetch audio. Deploy the Worker or open the app through `npm run dev:tunnel`.",
			},
			400,
		);
	}

	const contentType = request.headers.get("content-type") ?? "";
	if (!contentType.toLowerCase().includes("multipart/form-data")) {
		return json({ error: "Upload audio with multipart/form-data field named audio." }, 400);
	}

	const form = await request.formData();
	const audio = form.get("audio");
	if (!(audio instanceof File)) {
		return json({ error: "Missing audio file." }, 400);
	}

	if (audio.size <= 0) {
		return json({ error: "Audio file is empty." }, 400);
	}

	if (audio.size > MAX_UPLOAD_BYTES) {
		return json({ error: `Audio file is too large. MVP limit is ${formatBytes(MAX_UPLOAD_BYTES)}.` }, 413);
	}

	if (!isAudioFile(audio)) {
		return json({ error: "File must be an audio upload." }, 400);
	}

	const modelOptions = parseModelOptions(form);
	if (typeof modelOptions === "string") {
		return json({ error: modelOptions }, 400);
	}

	const now = new Date().toISOString();
	const jobId = crypto.randomUUID();
	const safeName = sanitizeFileName(audio.name || "audio");
	const inputKey = `inputs/${jobId}/${safeName}`;
	const inputContentType = audio.type || "application/octet-stream";
	const inputToken = randomToken();
	const downloadToken = randomToken();
	const webhookToken = randomToken();

	await env.AUDIO_BUCKET.put(inputKey, audio.stream(), {
		httpMetadata: {
			contentType: inputContentType,
			contentDisposition: `attachment; filename="${escapeHeaderFilename(safeName)}"`,
		},
		customMetadata: {
			jobId,
			originalName: audio.name || safeName,
		},
	});

	await env.DB.prepare(
		`INSERT INTO jobs (
			id, status, model, input_key, input_name, input_content_type, input_size,
			preset, solver, number_function_evaluations, prior_temperature, output_choice,
			input_token, download_token, webhook_token, created_at, updated_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
	)
		.bind(
			jobId,
			"queued",
			REPLICATE_MODEL,
			inputKey,
			audio.name || safeName,
			inputContentType,
			audio.size,
			modelOptions.preset,
			modelOptions.solver,
			modelOptions.numberFunctionEvaluations,
			modelOptions.priorTemperature,
			modelOptions.outputChoice,
			inputToken,
			downloadToken,
			webhookToken,
			now,
			now,
		)
		.run();

	try {
		await env.AUDIO_QUEUE.send({ jobId, baseUrl });
	} catch (error) {
		await markJobFailed(env, jobId, `Failed to enqueue job: ${getErrorMessage(error)}`);
		throw error;
	}

	const job = await getJob(env, jobId);
	if (!job) {
		throw new Error("Failed to read created job.");
	}

	return json({ job: publicJob(job) }, 201);
}

export async function getJobStatus(jobId: string, env: AppEnv): Promise<Response> {
	let job = await getJob(env, jobId);
	if (!job) {
		return json({ error: "Job not found." }, 404);
	}

	if (job.status === "processing" && job.replicate_prediction_id) {
		job = await syncReplicatePrediction(job, env);
	}

	return json({ job: publicJob(job) });
}

export async function getInputAudio(jobId: string, url: URL, env: AppEnv): Promise<Response> {
	const job = await getJob(env, jobId);
	if (!job) {
		return json({ error: "Job not found." }, 404);
	}

	if (url.searchParams.get("token") !== job.input_token) {
		return json({ error: "Invalid input token." }, 403);
	}

	const object = await env.AUDIO_BUCKET.get(job.input_key);
	if (!object) {
		return json({ error: "Input audio not found." }, 404);
	}

	const headers = objectHeaders(object, job.input_name, job.input_content_type ?? "application/octet-stream");
	return new Response(object.body, { headers });
}

export async function downloadOutput(jobId: string, url: URL, env: AppEnv): Promise<Response> {
	const job = await getJob(env, jobId);
	if (!job) {
		return json({ error: "Job not found." }, 404);
	}

	if (url.searchParams.get("token") !== job.download_token) {
		return json({ error: "Invalid download token." }, 403);
	}

	if (job.status !== "completed" || !job.output_key) {
		return json({ error: "Output is not ready." }, 409);
	}

	const object = await env.AUDIO_BUCKET.get(job.output_key);
	if (!object) {
		return json({ error: "Output audio not found." }, 404);
	}

	const headers = objectHeaders(object, cleanedFileName(job.input_name), job.output_content_type ?? "audio/wav");
	return new Response(object.body, { headers });
}

export async function receiveReplicateWebhook(jobId: string, url: URL, request: Request, env: AppEnv): Promise<Response> {
	let job = await getJob(env, jobId);
	if (!job) {
		return json({ error: "Job not found." }, 404);
	}

	if (url.searchParams.get("token") !== job.webhook_token) {
		return json({ error: "Invalid webhook token." }, 403);
	}

	const prediction = (await request.json()) as ReplicatePrediction;
	if (job.replicate_prediction_id && prediction.id !== job.replicate_prediction_id) {
		return json({ error: "Prediction ID mismatch." }, 409);
	}

	job = await applyPredictionResult(job, prediction, env);
	return json({ job: publicJob(job) });
}

async function enforceUploadRateLimit(request: Request, env: AppEnv): Promise<Response | null> {
	const clientIp = request.headers.get("CF-Connecting-IP") ?? "unknown";
	const { success } = await env.UPLOAD_RATE_LIMITER.limit({ key: `upload:${clientIp}` });

	if (!success) {
		return json({ error: "Too many uploads. Please wait a minute and try again." }, 429);
	}

	return null;
}
