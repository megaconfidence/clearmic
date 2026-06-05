import { cleanedFileName, escapeHeaderFilename, extensionFromUrl } from "./audio";
import { getJob, markJobFailed } from "./db";
import { safeResponseText } from "./http";
import { maybeSendCompletionEmail } from "./notifications";
import {
	ENHANCEMENT_MODEL,
	ENHANCEMENT_MODEL_VERSION,
	NOISE_REMOVAL_MODEL,
	NOISE_REMOVAL_MODEL_VERSION,
	SILENCE_REMOVAL_MODEL,
	SILENCE_REMOVAL_MODEL_VERSION,
	TRANSCRIPTION_MODEL,
	TRANSCRIPTION_MODEL_VERSION,
	pickOutputUrl,
	whisperTranscriptionArg,
} from "./model";
import { firstAudioStep, hasAudioStep, modelForProcessingStep, nextAudioStep, processingStepForModel, processingStepLabel } from "./pipeline";
import type { AppEnv, JobRow, ProcessingStep, ProcessJobMessage, ReplicatePrediction } from "./types";

// The pipeline runs as two concurrent branches that finish independently:
//   * audio       — silence removal -> noise removal -> enhancement (the cleaned download)
//   * transcribe  — whisper, on the silence-removed audio (or the raw upload)
// `branch` tags every prediction (via the webhook URL) so completions route to
// the right handler. The job is marked completed only once BOTH branches finish.
type Branch = "audio" | "transcribe";
type AudioStep = Exclude<ProcessingStep, "transcription">;

export async function processQueuedJob(message: ProcessJobMessage, env: AppEnv): Promise<void> {
	const job = await getJob(env, message.jobId);
	if (!job) {
		return;
	}

	if (job.status !== "queued" && job.status !== "processing") {
		return;
	}

	// Queue redelivery: a branch is already in flight, so just reconcile instead
	// of starting duplicate predictions.
	if (job.replicate_prediction_id || job.transcribe_prediction_id) {
		await syncJob(job, env, message.baseUrl);
		return;
	}

	if (job.status !== "queued") {
		return;
	}

	const inputUrl = `${message.baseUrl}/api/jobs/${encodeURIComponent(job.id)}/input?token=${encodeURIComponent(job.input_token)}`;
	const firstAudio = firstAudioStep(job);

	if (firstAudio) {
		await startAudioStep(job, firstAudio, inputUrl, message.baseUrl, env, null);
		// When there's no silence-removal step the timeline is unchanged, so
		// transcription can run on the raw upload in parallel right away. With
		// silence removal, transcription waits and forks off its output (below)
		// so subtitle timestamps line up with the trimmed download.
		if (job.transcribe === 1 && firstAudio !== "silence_removal") {
			await startTranscription(job, inputUrl, message.baseUrl, env);
		}
		return;
	}

	if (job.transcribe === 1) {
		await startTranscription(job, inputUrl, message.baseUrl, env);
		return;
	}

	await markJobFailed(env, job.id, "Select at least one processing step.");
}

// Reconcile both branches from Replicate, then re-check completion. Used by the
// status poll (resilience) and queue redelivery. Per-branch errors are isolated.
export async function syncJob(job: JobRow, env: AppEnv, baseUrl?: string): Promise<JobRow> {
	let current: JobRow = job;
	for (const branch of ["audio", "transcribe"] as const) {
		if (current.status !== "queued" && current.status !== "processing") {
			break;
		}
		const predictionId = branch === "audio" ? current.replicate_prediction_id : current.transcribe_prediction_id;
		if (!predictionId) {
			continue;
		}
		try {
			current = await syncBranch(current, branch, env, baseUrl);
		} catch (error) {
			console.error(`Replicate ${branch} sync failed`, error);
		}
	}
	return finalizeIfDone(current.id, env, baseUrl);
}

async function syncBranch(job: JobRow, branch: Branch, env: AppEnv, baseUrl?: string): Promise<JobRow> {
	const predictionId = branch === "audio" ? job.replicate_prediction_id : job.transcribe_prediction_id;
	if (!predictionId) {
		return job;
	}

	const rawGetUrl = branch === "audio" ? job.replicate_get_url : job.transcribe_get_url;
	const getUrl = requireReplicateStatusUrl(rawGetUrl ?? `https://api.replicate.com/v1/predictions/${predictionId}`);
	const response = await fetch(getUrl, {
		headers: {
			Authorization: `Bearer ${env.REPLICATE_API_TOKEN}`,
			"Content-Type": "application/json",
		},
	});

	if (!response.ok) {
		console.error(`Replicate status fetch failed: ${response.status} ${await safeResponseText(response)}`);
		throw new Error("Replicate status fetch failed.");
	}

	const prediction = (await response.json()) as ReplicatePrediction;
	return applyPredictionResult(job, prediction, env, baseUrl, branch);
}

export async function applyPredictionResult(
	job: JobRow,
	prediction: ReplicatePrediction,
	env: AppEnv,
	baseUrl: string | undefined,
	branch: Branch,
): Promise<JobRow> {
	const status = normalizeReplicateStatus(prediction.status);

	if (status === "failed" || status === "canceled") {
		return failJob(job, prediction, branch, status, env);
	}

	if (status === "succeeded") {
		return branch === "transcribe"
			? onTranscribeSucceeded(job, prediction, env, baseUrl)
			: onAudioSucceeded(job, prediction, env, baseUrl);
	}

	return job;
}

async function onAudioSucceeded(job: JobRow, prediction: ReplicatePrediction, env: AppEnv, baseUrl?: string): Promise<JobRow> {
	// Idempotency: ignore if this is no longer the active audio prediction (a
	// concurrent poll/webhook already advanced the branch).
	if (job.replicate_prediction_id !== prediction.id) {
		return (await getJob(env, job.id)) ?? job;
	}

	const step = processingStepForModel(job.model);
	if (!step || step === "transcription") {
		await markJobFailed(env, job.id, "Audio processing failed.");
		return (await getJob(env, job.id)) ?? job;
	}

	const outputUrl = outputUrlForStep(step, prediction.output, job);
	if (!outputUrl) {
		await markJobFailed(env, job.id, `${processingStepLabel(step)} failed: Replicate returned no audio output URL.`);
		return (await getJob(env, job.id)) ?? job;
	}

	const base = effectiveBaseUrl(job, baseUrl);

	// Fork transcription off the silence-removed audio so subtitle timestamps
	// match the trimmed download. Guarded so it starts exactly once.
	if (step === "silence_removal" && job.transcribe === 1 && !job.transcribe_prediction_id && base) {
		await startTranscription(job, outputUrl, base, env);
	}

	const next = nextAudioStep(job, step);
	if (next) {
		if (!base) {
			await markJobFailed(env, job.id, `${processingStepLabel(next)} failed: missing public webhook URL.`);
			return (await getJob(env, job.id)) ?? job;
		}
		await startAudioStep(job, next, outputUrl, base, env, prediction.id);
		return (await getJob(env, job.id)) ?? job;
	}

	// Final audio step: persist the cleaned file, then complete if transcription is done too.
	await persistAudioOutput(job, prediction, outputUrl, env);
	return finalizeIfDone(job.id, env, base ?? baseUrl);
}

async function onTranscribeSucceeded(job: JobRow, prediction: ReplicatePrediction, env: AppEnv, baseUrl?: string): Promise<JobRow> {
	if (job.transcribe_prediction_id !== prediction.id) {
		return (await getJob(env, job.id)) ?? job;
	}

	const transcript = transcriptFromOutput(prediction.output);
	if (!transcript) {
		await markJobFailed(env, job.id, "Transcription failed: Replicate returned no transcript.");
		return (await getJob(env, job.id)) ?? job;
	}

	const now = new Date().toISOString();
	await env.DB.prepare(
		`UPDATE jobs
		 SET transcript = ?, transcribe_prediction_id = NULL, transcribe_get_url = NULL, error = NULL, updated_at = ?
		 WHERE id = ? AND transcribe_prediction_id = ? AND status IN ('queued', 'processing')`,
	)
		.bind(transcript, now, job.id, prediction.id)
		.run();

	return finalizeIfDone(job.id, env, effectiveBaseUrl(job, baseUrl) ?? baseUrl);
}

// Mark completed only once every requested output exists. Idempotent: safe to
// call from either branch's completion and from the status poll.
async function finalizeIfDone(jobId: string, env: AppEnv, baseUrl?: string): Promise<JobRow> {
	const job = await getJob(env, jobId);
	if (!job) {
		throw new Error("Job disappeared while finalizing.");
	}
	if (job.status !== "queued" && job.status !== "processing") {
		return job;
	}

	const audioDone = !hasAudioStep(job) || job.output_key !== null;
	const transcribeDone = job.transcribe !== 1 || job.transcript !== null;
	if (!audioDone || !transcribeDone) {
		return job;
	}

	const now = new Date().toISOString();
	const result = await env.DB.prepare(
		`UPDATE jobs SET status = 'completed', completed_at = COALESCE(completed_at, ?), updated_at = ?
		 WHERE id = ? AND status IN ('queued', 'processing')`,
	)
		.bind(now, now, jobId)
		.run();

	const updated = (await getJob(env, jobId)) ?? job;
	if ((result.meta.changes ?? 0) > 0) {
		await maybeSendCompletionEmail(updated, env, baseUrl);
	}
	return updated;
}

async function failJob(job: JobRow, prediction: ReplicatePrediction, branch: Branch, status: "failed" | "canceled", env: AppEnv): Promise<JobRow> {
	const now = new Date().toISOString();
	await env.DB.prepare(`UPDATE jobs SET status = ?, error = ?, updated_at = ? WHERE id = ? AND status IN ('queued', 'processing')`)
		.bind(status === "canceled" ? "canceled" : "failed", status === "canceled" ? "Processing was canceled." : predictionError(prediction, job, branch), now, job.id)
		.run();

	// The sibling branch is now moot — cancel it so it doesn't keep running.
	const sibling = branch === "audio" ? job.transcribe_prediction_id : job.replicate_prediction_id;
	if (sibling) {
		await cancelPrediction(sibling, env);
	}

	return (await getJob(env, job.id)) ?? job;
}

async function startAudioStep(
	job: JobRow,
	step: AudioStep,
	audioUrl: string,
	baseUrl: string,
	env: AppEnv,
	fromPredictionId: string | null,
): Promise<void> {
	const callbackUrl = webhookUrl(job, baseUrl, "audio");
	const prediction = await createPredictionForStep(step, audioUrl, callbackUrl, job, env);
	// Claim the slot. If we lost the race (another poll/webhook advanced first),
	// cancel the prediction we just created so it doesn't run as a duplicate.
	const won = await storeAudioPrediction(env, job.id, fromPredictionId, prediction, modelForProcessingStep(step), callbackUrl);
	if (!won) {
		await cancelPrediction(prediction.id, env);
	}
}

async function startTranscription(job: JobRow, audioUrl: string, baseUrl: string, env: AppEnv): Promise<void> {
	const callbackUrl = webhookUrl(job, baseUrl, "transcribe");
	const prediction = await createTranscriptionPrediction(audioUrl, callbackUrl, job, env);
	const won = await storeTranscribePrediction(env, job.id, prediction, callbackUrl);
	if (!won) {
		await cancelPrediction(prediction.id, env);
	}
}

// Compare-and-swap the audio branch's active prediction. fromPredictionId=null
// claims the first step (column must be empty); otherwise it must match the
// prediction we're advancing from. Returns true only for the single winner.
async function storeAudioPrediction(
	env: AppEnv,
	jobId: string,
	fromPredictionId: string | null,
	prediction: ReplicatePrediction,
	model: string,
	callbackUrl: string,
): Promise<boolean> {
	const now = new Date().toISOString();
	const condition = fromPredictionId === null ? "replicate_prediction_id IS NULL" : "replicate_prediction_id = ?";
	const statement = env.DB.prepare(
		`UPDATE jobs
		 SET status = CASE WHEN status IN ('completed', 'failed', 'canceled') THEN status ELSE 'processing' END,
		     model = ?, replicate_prediction_id = ?, replicate_get_url = ?, replicate_web_url = ?, replicate_webhook_url = ?, updated_at = ?
		 WHERE id = ? AND ${condition} AND status IN ('queued', 'processing')`,
	);
	const binds: unknown[] = [
		model,
		prediction.id,
		optionalReplicateStatusUrl(prediction.urls?.get),
		prediction.urls?.web ?? null,
		callbackUrl,
		now,
		jobId,
	];
	if (fromPredictionId !== null) {
		binds.push(fromPredictionId);
	}
	const result = await statement.bind(...binds).run();
	return (result.meta.changes ?? 0) === 1;
}

async function storeTranscribePrediction(env: AppEnv, jobId: string, prediction: ReplicatePrediction, callbackUrl: string): Promise<boolean> {
	const now = new Date().toISOString();
	const result = await env.DB.prepare(
		`UPDATE jobs
		 SET status = CASE WHEN status IN ('completed', 'failed', 'canceled') THEN status ELSE 'processing' END,
		     transcribe_prediction_id = ?, transcribe_get_url = ?, replicate_webhook_url = COALESCE(replicate_webhook_url, ?), updated_at = ?
		 WHERE id = ? AND transcribe_prediction_id IS NULL AND status IN ('queued', 'processing')`,
	)
		.bind(prediction.id, optionalReplicateStatusUrl(prediction.urls?.get), callbackUrl, now, jobId)
		.run();
	return (result.meta.changes ?? 0) === 1;
}

async function createPredictionForStep(
	step: ProcessingStep,
	audioUrl: string,
	callbackUrl: string,
	job: JobRow,
	env: AppEnv,
): Promise<ReplicatePrediction> {
	if (step === "silence_removal") {
		return createSilenceRemovalPrediction(audioUrl, callbackUrl, env);
	}

	if (step === "noise_removal") {
		return createNoiseRemovalPrediction(audioUrl, callbackUrl, env);
	}

	if (step === "transcription") {
		return createTranscriptionPrediction(audioUrl, callbackUrl, job, env);
	}

	return createEnhancementPrediction(audioUrl, callbackUrl, job, env);
}

async function createSilenceRemovalPrediction(audioUrl: string, callbackUrl: string, env: AppEnv): Promise<ReplicatePrediction> {
	return postReplicatePrediction(
		SILENCE_REMOVAL_MODEL,
		SILENCE_REMOVAL_MODEL_VERSION,
		{
			input_audio: audioUrl,
			sampling_rate: 16000,
			out_format: "wav",
		},
		callbackUrl,
		env,
		"silence removal",
	);
}

async function createNoiseRemovalPrediction(audioUrl: string, callbackUrl: string, env: AppEnv): Promise<ReplicatePrediction> {
	return postReplicatePrediction(
		NOISE_REMOVAL_MODEL,
		NOISE_REMOVAL_MODEL_VERSION,
		{
			audio: audioUrl,
			model: "mossformer2_se_48k",
		},
		callbackUrl,
		env,
		"noise removal",
	);
}

async function createEnhancementPrediction(audioUrl: string, callbackUrl: string, job: JobRow, env: AppEnv): Promise<ReplicatePrediction> {
	return postReplicatePrediction(
		ENHANCEMENT_MODEL,
		ENHANCEMENT_MODEL_VERSION,
		{
			input_audio: audioUrl,
			solver: job.solver,
			number_function_evaluations: job.number_function_evaluations,
			prior_temperature: job.prior_temperature,
			denoise_flag: job.noise_removal !== 1,
		},
		callbackUrl,
		env,
		"enhancement",
	);
}

async function createTranscriptionPrediction(audioUrl: string, callbackUrl: string, job: JobRow, env: AppEnv): Promise<ReplicatePrediction> {
	return postReplicatePrediction(
		TRANSCRIPTION_MODEL,
		TRANSCRIPTION_MODEL_VERSION,
		{
			audio: audioUrl,
			transcription: whisperTranscriptionArg(job.transcript_format),
			language: "auto",
		},
		callbackUrl,
		env,
		"transcription",
	);
}

async function postReplicatePrediction(
	model: string,
	version: string,
	input: Record<string, unknown>,
	callbackUrl: string,
	env: AppEnv,
	label: string,
): Promise<ReplicatePrediction> {
	// Route through an always-warm deployment when configured, otherwise the
	// public model+version. Deployments pin the version, so it's omitted there.
	const deployment = deploymentForModel(model, env);
	const url = deployment
		? `https://api.replicate.com/v1/deployments/${deployment}/predictions`
		: "https://api.replicate.com/v1/predictions";
	const payload = deployment
		? { input, webhook: callbackUrl, webhook_events_filter: ["completed"] }
		: { version: `${model}:${version}`, input, webhook: callbackUrl, webhook_events_filter: ["completed"] };

	const response = await fetch(url, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${env.REPLICATE_API_TOKEN}`,
			"Cancel-After": "15m",
			"Content-Type": "application/json",
		},
		body: JSON.stringify(payload),
	});

	if (!response.ok) {
		console.error(`Replicate ${label} prediction failed: ${response.status} ${await safeResponseText(response)}`);
		throw new Error(`Replicate ${label} request failed.`);
	}

	return (await response.json()) as ReplicatePrediction;
}

function deploymentForModel(model: string, env: AppEnv): string | null {
	if (model === SILENCE_REMOVAL_MODEL) {
		return validDeployment(env.SILENCE_REMOVAL_DEPLOYMENT);
	}
	if (model === NOISE_REMOVAL_MODEL) {
		return validDeployment(env.NOISE_REMOVAL_DEPLOYMENT);
	}
	if (model === ENHANCEMENT_MODEL) {
		return validDeployment(env.ENHANCEMENT_DEPLOYMENT);
	}
	return null;
}

function validDeployment(value: string | undefined): string | null {
	const deployment = (value ?? "").trim();
	return /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(deployment) ? deployment : null;
}

async function cancelPrediction(predictionId: string, env: AppEnv): Promise<void> {
	try {
		await fetch(`https://api.replicate.com/v1/predictions/${encodeURIComponent(predictionId)}/cancel`, {
			method: "POST",
			headers: { Authorization: `Bearer ${env.REPLICATE_API_TOKEN}` },
		});
	} catch (error) {
		console.error("Replicate cancel failed", error);
	}
}

// Persist the final cleaned audio to R2 and mark the audio branch done. The CAS
// (still the active prediction, no output yet) keeps it single-flight.
async function persistAudioOutput(job: JobRow, prediction: ReplicatePrediction, outputUrl: string, env: AppEnv): Promise<void> {
	if (job.output_key) {
		return;
	}
	assertReplicateOutputUrl(outputUrl);

	const outputResponse = await fetch(outputUrl);
	if (!outputResponse.ok || !outputResponse.body) {
		console.error(`Failed to fetch Replicate output: ${outputResponse.status} ${await safeResponseText(outputResponse)}`);
		throw new Error("Failed to fetch Replicate output.");
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
		 SET output_key = ?, output_content_type = ?, error = NULL,
		     replicate_prediction_id = NULL, replicate_get_url = NULL,
		     replicate_web_url = COALESCE(replicate_web_url, ?), updated_at = ?
		 WHERE id = ? AND replicate_prediction_id = ? AND output_key IS NULL AND status IN ('queued', 'processing')`,
	)
		.bind(outputKey, outputContentType, prediction.urls?.web ?? null, now, job.id, prediction.id)
		.run();
}

function outputUrlForStep(step: AudioStep, output: unknown, job: JobRow): string | null {
	return step === "enhancement" ? pickOutputUrl(output, job.output_choice) : pickOutputUrl(output, "enhanced");
}

function predictionError(prediction: ReplicatePrediction, job: JobRow, branch: Branch): string {
	if (typeof prediction.error === "string" && prediction.error.trim()) {
		return prediction.error.slice(0, 1000);
	}

	if (branch === "transcribe") {
		return "Transcription failed.";
	}

	const step = processingStepForModel(job.model);
	return step ? `${processingStepLabel(step)} failed.` : "Audio processing failed.";
}

function transcriptFromOutput(output: unknown): string | null {
	if (typeof output === "string") {
		return normalizeTranscript(output);
	}

	if (typeof output === "object" && output !== null) {
		// openai/whisper returns the chosen format (plain text / SRT / VTT) inline
		// in `transcription`; `text` is kept as a defensive fallback.
		const objectOutput = output as { transcription?: unknown; text?: unknown };
		if (typeof objectOutput.transcription === "string") {
			return normalizeTranscript(objectOutput.transcription);
		}
		if (typeof objectOutput.text === "string") {
			return normalizeTranscript(objectOutput.text);
		}
	}

	return null;
}

// Format-safe: preserve SRT/VTT cue line breaks, only normalize line endings and trim surrounding/trailing blank space.
function normalizeTranscript(value: string): string | null {
	const transcript = value
		.replace(/\r\n?/g, "\n")
		.replace(/[ \t]+$/gm, "")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
	return transcript || null;
}

function webhookUrl(job: JobRow, baseUrl: string, branch: Branch): string {
	const origin = baseUrl.replace(/\/+$/, "");
	return `${origin}/api/jobs/${encodeURIComponent(job.id)}/webhook?token=${encodeURIComponent(job.webhook_token)}&branch=${branch}`;
}

// The public origin to use for webhooks/email. Prefer the live request origin;
// fall back to the one captured on the job when it started.
function effectiveBaseUrl(job: JobRow, baseUrl?: string): string | null {
	if (baseUrl) {
		const trimmed = baseUrl.replace(/\/+$/, "");
		if (isPublicHttpsUrl(trimmed)) {
			return trimmed;
		}
	}

	if (job.replicate_webhook_url) {
		try {
			const origin = new URL(job.replicate_webhook_url).origin;
			if (isPublicHttpsUrl(origin)) {
				return origin;
			}
		} catch {
			// ignore
		}
	}

	return null;
}

function isPublicHttpsUrl(value: string): boolean {
	try {
		const url = new URL(value);
		return url.protocol === "https:" && url.hostname !== "localhost" && url.hostname !== "127.0.0.1";
	} catch {
		return false;
	}
}

function optionalReplicateStatusUrl(value: string | undefined): string | null {
	return value ? requireReplicateStatusUrl(value) : null;
}

function requireReplicateStatusUrl(value: string): string {
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		throw new Error("Replicate returned an invalid status URL.");
	}

	if (url.protocol !== "https:" || url.hostname !== "api.replicate.com" || !url.pathname.startsWith("/v1/predictions/")) {
		throw new Error("Replicate returned an unexpected status URL host.");
	}

	return url.toString();
}

function assertReplicateOutputUrl(value: string): void {
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		throw new Error("Replicate returned an invalid output URL.");
	}

	if (url.protocol !== "https:" || (url.hostname !== "replicate.delivery" && !url.hostname.endsWith(".replicate.delivery"))) {
		throw new Error("Replicate returned an unexpected output URL host.");
	}
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
