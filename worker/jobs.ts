import { cleanedFileName, escapeHeaderFilename, objectHeaders, transcriptContentType, transcriptFileName } from "./audio";
import { getJob, isExpired, markJobFailed, publicJob } from "./db";
import { getErrorMessage, getPublicBaseUrl, json, readJson } from "./http";
import { maybeSendCompletionEmail } from "./notifications";
import { applyPredictionResult, syncReplicatePrediction } from "./replicate";
import type { AppEnv, ReplicatePrediction } from "./types";

// Reads are open and keyed by the job's unguessable id (auth.md A5). Whoever
// created the job holds the id; no account scoping.
export async function getJobStatus(jobId: string, request: Request, env: AppEnv): Promise<Response> {
	let job = await getJob(env, jobId);
	if (!job || isExpired(job.expires_at)) {
		return json({ error: "Job not found." }, 404);
	}

	const baseUrl = getPublicBaseUrl(request) ?? undefined;
	if (job.status === "processing" && job.replicate_prediction_id) {
		job = await syncReplicatePrediction(job, env, baseUrl);
	}
	if (job.status === "completed") {
		await maybeSendCompletionEmail(job, env, baseUrl);
	}

	return json({ job: publicJob(job, { includeTranscript: true }) });
}

export async function getInputAudio(jobId: string, url: URL, env: AppEnv): Promise<Response> {
	const job = await getJob(env, jobId);
	if (!job) {
		return json({ error: "Job not found." }, 404);
	}

	if (isExpired(job.expires_at)) {
		return json({ error: "This file has expired." }, 410);
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

	if (isExpired(job.expires_at)) {
		return json({ error: "This file has expired." }, 410);
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

export async function downloadTranscript(jobId: string, url: URL, env: AppEnv): Promise<Response> {
	const job = await getJob(env, jobId);
	if (!job) {
		return json({ error: "Job not found." }, 404);
	}

	if (isExpired(job.expires_at)) {
		return json({ error: "This file has expired." }, 410);
	}

	if (url.searchParams.get("token") !== job.download_token) {
		return json({ error: "Invalid download token." }, 403);
	}

	if (job.status !== "completed" || !job.transcript) {
		return json({ error: "Transcript is not ready." }, 409);
	}

	const headers = new Headers({
		"content-type": transcriptContentType(job.transcript_format),
		"content-disposition": `attachment; filename="${escapeHeaderFilename(transcriptFileName(job.input_name, job.transcript_format))}"`,
		"cache-control": "private, max-age=0, no-store",
	});

	return new Response(`${job.transcript}\n`, { headers });
}

export async function receiveReplicateWebhook(jobId: string, url: URL, request: Request, env: AppEnv): Promise<Response> {
	let job = await getJob(env, jobId);
	if (!job) {
		return json({ error: "Job not found." }, 404);
	}

	if (url.searchParams.get("token") !== job.webhook_token) {
		return json({ error: "Invalid webhook token." }, 403);
	}
	if (job.status !== "queued" && job.status !== "processing") {
		return json({ job: publicJob(job, { includeTranscript: true }) });
	}

	const prediction = await readJson<ReplicatePrediction>(request, 4 * 1024 * 1024);
	if (!prediction) {
		return json({ error: "Send webhook payload as JSON." }, 400);
	}

	if (job.replicate_prediction_id && prediction.id !== job.replicate_prediction_id) {
		return json({ job: publicJob(job) });
	}

	const baseUrl = getPublicBaseUrl(request) ?? undefined;
	try {
		job = await applyPredictionResult(job, prediction, env, baseUrl);
	} catch (error) {
		console.error("Replicate webhook processing failed", error);
		await markJobFailed(env, job.id, getErrorMessage(error));
		job = (await getJob(env, job.id)) ?? job;
	}
	return json({ job: publicJob(job, { includeTranscript: true }) });
}
