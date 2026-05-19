import { cleanedFileName, escapeHeaderFilename, extensionFromUrl } from "./audio";
import { getJob, markJobFailed } from "./db";
import { safeResponseText } from "./http";
import { pickOutputUrl, REPLICATE_MODEL, REPLICATE_MODEL_VERSION } from "./model";
import type { AppEnv, JobRow, ProcessJobMessage, ReplicatePrediction } from "./types";

export async function processQueuedJob(message: ProcessJobMessage, env: AppEnv): Promise<void> {
	const job = await getJob(env, message.jobId);
	if (!job) {
		return;
	}

	if (job.replicate_prediction_id) {
		await syncReplicatePrediction(job, env);
		return;
	}

	if (job.status !== "queued") {
		return;
	}

	const inputUrl = `${message.baseUrl}/api/jobs/${encodeURIComponent(job.id)}/input?token=${encodeURIComponent(job.input_token)}`;
	const webhookUrl = `${message.baseUrl}/api/jobs/${encodeURIComponent(job.id)}/webhook?token=${encodeURIComponent(job.webhook_token)}`;
	const prediction = await createReplicatePrediction(inputUrl, webhookUrl, job, env);
	const now = new Date().toISOString();

	await env.DB.prepare(
		`UPDATE jobs
		 SET status = CASE WHEN status IN ('completed', 'failed', 'canceled') THEN status ELSE ? END,
		     replicate_prediction_id = ?, replicate_get_url = ?, replicate_web_url = ?, updated_at = ?
		 WHERE id = ?`,
	)
		.bind("processing", prediction.id, prediction.urls?.get ?? null, prediction.urls?.web ?? null, now, job.id)
		.run();
}

export async function syncReplicatePrediction(job: JobRow, env: AppEnv): Promise<JobRow> {
	if (!job.replicate_prediction_id) {
		return job;
	}

	const getUrl = job.replicate_get_url ?? `https://api.replicate.com/v1/predictions/${job.replicate_prediction_id}`;
	const response = await fetch(getUrl, {
		headers: {
			Authorization: `Bearer ${env.REPLICATE_API_TOKEN}`,
			"Content-Type": "application/json",
		},
	});

	if (!response.ok) {
		throw new Error(`Replicate status fetch failed: ${response.status} ${await safeResponseText(response)}`);
	}

	const prediction = (await response.json()) as ReplicatePrediction;
	return applyPredictionResult(job, prediction, env);
}

export async function applyPredictionResult(job: JobRow, prediction: ReplicatePrediction, env: AppEnv): Promise<JobRow> {
	const status = normalizeReplicateStatus(prediction.status);

	if (status === "succeeded") {
		return persistOutput(job, prediction, env);
	}

	if (status === "failed" || status === "canceled") {
		const now = new Date().toISOString();
		await env.DB.prepare(
			`UPDATE jobs
			 SET status = ?, error = ?, replicate_prediction_id = COALESCE(replicate_prediction_id, ?),
			     replicate_get_url = COALESCE(replicate_get_url, ?), replicate_web_url = COALESCE(replicate_web_url, ?), updated_at = ?
			 WHERE id = ?`,
		)
			.bind(
				status === "canceled" ? "canceled" : "failed",
				prediction.error ?? `Replicate ${status}.`,
				prediction.id,
				prediction.urls?.get ?? null,
				prediction.urls?.web ?? null,
				now,
				job.id,
			)
			.run();
		return (await getJob(env, job.id)) ?? job;
	}

	return job;
}

async function createReplicatePrediction(
	inputAudioUrl: string,
	webhookUrl: string,
	job: JobRow,
	env: AppEnv,
): Promise<ReplicatePrediction> {
	const response = await fetch("https://api.replicate.com/v1/predictions", {
		method: "POST",
		headers: {
			Authorization: `Bearer ${env.REPLICATE_API_TOKEN}`,
			"Cancel-After": "10m",
			"Content-Type": "application/json",
		},
		body: JSON.stringify({
			version: `${REPLICATE_MODEL}:${REPLICATE_MODEL_VERSION}`,
			input: {
				input_audio: inputAudioUrl,
				solver: job.solver,
				number_function_evaluations: job.number_function_evaluations,
				prior_temperature: job.prior_temperature,
				denoise_flag: true,
			},
			webhook: webhookUrl,
			webhook_events_filter: ["completed"],
		}),
	});

	if (!response.ok) {
		throw new Error(`Replicate prediction failed: ${response.status} ${await safeResponseText(response)}`);
	}

	return (await response.json()) as ReplicatePrediction;
}

async function persistOutput(job: JobRow, prediction: ReplicatePrediction, env: AppEnv): Promise<JobRow> {
	if (job.output_key) {
		return job;
	}

	const outputUrl = pickOutputUrl(prediction.output, job.output_choice);
	if (!outputUrl) {
		await markJobFailed(env, job.id, "Replicate succeeded but returned no audio output URL.");
		return (await getJob(env, job.id)) ?? job;
	}

	const outputResponse = await fetch(outputUrl, {
		headers: {
			Authorization: `Bearer ${env.REPLICATE_API_TOKEN}`,
		},
	});
	if (!outputResponse.ok || !outputResponse.body) {
		throw new Error(`Failed to fetch Replicate output: ${outputResponse.status} ${await safeResponseText(outputResponse)}`);
	}

	const outputContentType = outputResponse.headers.get("content-type") ?? "audio/wav";
	const outputKey = `outputs/${job.id}/cleaned.${extensionFromUrl(outputUrl)}`;
	await env.AUDIO_BUCKET.put(outputKey, outputResponse.body, {
		httpMetadata: {
			contentType: outputContentType,
			contentDisposition: `attachment; filename="${escapeHeaderFilename(cleanedFileName(job.input_name))}"`,
		},
		customMetadata: {
			jobId: job.id,
			replicatePredictionId: prediction.id,
		},
	});

	const now = new Date().toISOString();
	await env.DB.prepare(
		`UPDATE jobs
		 SET status = ?, output_key = ?, output_content_type = ?, error = NULL,
		     replicate_prediction_id = COALESCE(replicate_prediction_id, ?),
		     replicate_get_url = COALESCE(replicate_get_url, ?), replicate_web_url = COALESCE(replicate_web_url, ?),
		     completed_at = ?, updated_at = ?
		 WHERE id = ?`,
	)
		.bind(
			"completed",
			outputKey,
			outputContentType,
			prediction.id,
			prediction.urls?.get ?? null,
			prediction.urls?.web ?? null,
			now,
			now,
			job.id,
		)
		.run();

	return (await getJob(env, job.id)) ?? job;
}

function normalizeReplicateStatus(status: string): "succeeded" | "failed" | "canceled" | "processing" {
	if (status === "succeeded" || status === "successful") {
		return "succeeded";
	}

	if (status === "failed") {
		return "failed";
	}

	if (status === "canceled") {
		return "canceled";
	}

	return "processing";
}
