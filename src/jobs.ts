import { cleanedFileName, objectHeaders } from "./audio";
import { getJob, isExpired, publicJob } from "./db";
import { json, readJson } from "./http";
import { applyPredictionResult, syncReplicatePrediction } from "./replicate";
import type { AppEnv, JobRow, ReplicatePrediction, User } from "./types";

export async function listJobs(env: AppEnv, user: User): Promise<Response> {
	const { results } = await env.DB.prepare(
		`SELECT * FROM jobs
		 WHERE user_id = ? AND expires_at > ?
		 ORDER BY created_at DESC
		 LIMIT 50`,
	)
		.bind(user.id, new Date().toISOString())
		.all<JobRow>();

	return json({ jobs: results.map(publicJob) });
}

export async function getJobStatus(jobId: string, env: AppEnv, user: User): Promise<Response> {
	let job = await getJob(env, jobId);
	if (!job || job.user_id !== user.id || isExpired(job.expires_at)) {
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

export async function downloadOutput(jobId: string, url: URL, env: AppEnv, user: User): Promise<Response> {
	const job = await getJob(env, jobId);
	if (!job || job.user_id !== user.id) {
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

export async function receiveReplicateWebhook(jobId: string, url: URL, request: Request, env: AppEnv): Promise<Response> {
	let job = await getJob(env, jobId);
	if (!job) {
		return json({ error: "Job not found." }, 404);
	}

	if (url.searchParams.get("token") !== job.webhook_token) {
		return json({ error: "Invalid webhook token." }, 403);
	}

	const prediction = await readJson<ReplicatePrediction>(request, 64 * 1024);
	if (!prediction) {
		return json({ error: "Send webhook payload as JSON." }, 400);
	}

	if (job.replicate_prediction_id && prediction.id !== job.replicate_prediction_id) {
		return json({ error: "Prediction ID mismatch." }, 409);
	}

	job = await applyPredictionResult(job, prediction, env);
	return json({ job: publicJob(job) });
}
