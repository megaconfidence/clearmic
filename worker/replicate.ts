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
import {
	firstSelectedProcessingStep,
	modelForProcessingStep,
	nextSelectedProcessingStep,
	processingStepForModel,
	processingStepLabel,
} from "./pipeline";
import type { AppEnv, JobRow, ProcessingStep, ProcessJobMessage, ReplicatePrediction } from "./types";

export async function processQueuedJob(message: ProcessJobMessage, env: AppEnv): Promise<void> {
	const job = await getJob(env, message.jobId);
	if (!job) {
		return;
	}

	if (job.status !== "queued" && job.status !== "processing") {
		return;
	}

	if (job.replicate_prediction_id) {
		await syncReplicatePrediction(job, env, message.baseUrl);
		return;
	}

	if (job.status !== "queued") {
		return;
	}

	const firstStep = firstSelectedProcessingStep(job);
	if (!firstStep) {
		await markJobFailed(env, job.id, "Select at least one processing step.");
		return;
	}

	const inputUrl = `${message.baseUrl}/api/jobs/${encodeURIComponent(job.id)}/input?token=${encodeURIComponent(job.input_token)}`;
	const callbackUrl = webhookUrl(job, message.baseUrl);
	const prediction = await createPredictionForStep(firstStep, inputUrl, callbackUrl, job, env);
	await storeActivePrediction(job, prediction, modelForProcessingStep(firstStep), callbackUrl, env);
}

export async function syncReplicatePrediction(job: JobRow, env: AppEnv, baseUrl?: string): Promise<JobRow> {
	if (!job.replicate_prediction_id) {
		return job;
	}

	const getUrl = requireReplicateStatusUrl(job.replicate_get_url ?? `https://api.replicate.com/v1/predictions/${job.replicate_prediction_id}`);
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
	return applyPredictionResult(job, prediction, env, baseUrl);
}

export async function applyPredictionResult(job: JobRow, prediction: ReplicatePrediction, env: AppEnv, baseUrl?: string): Promise<JobRow> {
	const status = normalizeReplicateStatus(prediction.status);

	if (status === "succeeded") {
		const step = processingStepForModel(job.model);
		if (!step) {
			await markJobFailed(env, job.id, "Replicate completed an unknown processing step.");
			return (await getJob(env, job.id)) ?? job;
		}

		if (step === "transcription") {
			return persistTranscript(job, prediction, env, baseUrl);
		}

		return continueAfterAudioStep(job, prediction, step, env, baseUrl);
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
				status === "canceled" ? "Processing was canceled." : predictionError(prediction, job),
				prediction.id,
				optionalReplicateStatusUrl(prediction.urls?.get),
				prediction.urls?.web ?? null,
				now,
				job.id,
			)
			.run();
		return (await getJob(env, job.id)) ?? job;
	}

	return job;
}

async function continueAfterAudioStep(
	job: JobRow,
	prediction: ReplicatePrediction,
	step: Exclude<ProcessingStep, "transcription">,
	env: AppEnv,
	baseUrl?: string,
): Promise<JobRow> {
	const outputUrl = outputUrlForStep(step, prediction.output, job);
	if (!outputUrl) {
		await markJobFailed(env, job.id, `${processingStepLabel(step)} failed: Replicate returned no audio output URL.`);
		return (await getJob(env, job.id)) ?? job;
	}

	const nextStep = nextSelectedProcessingStep(job, step);
	// Another audio step (silence removal / noise removal / enhancement) follows:
	// feed this step's output straight in without persisting it as the download —
	// only the final audio step's output becomes the cleaned file.
	if (nextStep !== null && nextStep !== "transcription") {
		const predictionWebhookUrl = requireWebhookUrl(job, prediction, baseUrl);
		if (!predictionWebhookUrl) {
			await markJobFailed(env, job.id, `${processingStepLabel(nextStep)} failed: missing public webhook URL.`);
			return (await getJob(env, job.id)) ?? job;
		}

		const nextPrediction = await createPredictionForStep(nextStep, outputUrl, predictionWebhookUrl, job, env);
		await storeActivePrediction(job, nextPrediction, modelForProcessingStep(nextStep), predictionWebhookUrl, env);
		return (await getJob(env, job.id)) ?? job;
	}

	const audioResult = await persistAudioOutput(job, prediction, outputUrl, env, nextStep === null, baseUrl);
	if (audioResult.job.status === "failed" || nextStep !== "transcription") {
		return audioResult.job;
	}

	const predictionWebhookUrl = requireWebhookUrl(job, prediction, baseUrl);
	if (!predictionWebhookUrl) {
		await markJobFailed(env, job.id, "Transcription failed: missing public webhook URL.");
		return (await getJob(env, job.id)) ?? audioResult.job;
	}

	const nextPrediction = await createPredictionForStep(nextStep, audioResult.outputUrl, predictionWebhookUrl, audioResult.job, env);
	await storeActivePrediction(audioResult.job, nextPrediction, modelForProcessingStep(nextStep), predictionWebhookUrl, env);
	return (await getJob(env, job.id)) ?? audioResult.job;
}

async function createPredictionForStep(
	step: ProcessingStep,
	audioUrl: string,
	webhookUrl: string,
	job: JobRow,
	env: AppEnv,
): Promise<ReplicatePrediction> {
	if (step === "silence_removal") {
		return createSilenceRemovalPrediction(audioUrl, webhookUrl, env);
	}

	if (step === "noise_removal") {
		return createNoiseRemovalPrediction(audioUrl, webhookUrl, env);
	}

	if (step === "transcription") {
		return createTranscriptionPrediction(audioUrl, webhookUrl, job, env);
	}

	return createEnhancementPrediction(audioUrl, webhookUrl, job, env);
}

async function createSilenceRemovalPrediction(audioUrl: string, webhookUrl: string, env: AppEnv): Promise<ReplicatePrediction> {
	return postReplicatePrediction(
		SILENCE_REMOVAL_MODEL,
		SILENCE_REMOVAL_MODEL_VERSION,
		{
			input_audio: audioUrl,
			sampling_rate: 16000,
			out_format: "wav",
		},
		webhookUrl,
		env,
		"silence removal",
	);
}

async function createNoiseRemovalPrediction(audioUrl: string, webhookUrl: string, env: AppEnv): Promise<ReplicatePrediction> {
	return postReplicatePrediction(
		NOISE_REMOVAL_MODEL,
		NOISE_REMOVAL_MODEL_VERSION,
		{
			audio: audioUrl,
			model: "mossformer2_se_48k",
		},
		webhookUrl,
		env,
		"noise removal",
	);
}

async function createEnhancementPrediction(audioUrl: string, webhookUrl: string, job: JobRow, env: AppEnv): Promise<ReplicatePrediction> {
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
		webhookUrl,
		env,
		"enhancement",
	);
}

async function createTranscriptionPrediction(audioUrl: string, webhookUrl: string, job: JobRow, env: AppEnv): Promise<ReplicatePrediction> {
	return postReplicatePrediction(
		TRANSCRIPTION_MODEL,
		TRANSCRIPTION_MODEL_VERSION,
		{
			audio: audioUrl,
			transcription: whisperTranscriptionArg(job.transcript_format),
			language: "auto",
		},
		webhookUrl,
		env,
		"transcription",
	);
}

async function postReplicatePrediction(
	model: string,
	version: string,
	input: Record<string, unknown>,
	webhookUrl: string,
	env: AppEnv,
	label: string,
): Promise<ReplicatePrediction> {
	const response = await fetch("https://api.replicate.com/v1/predictions", {
		method: "POST",
		headers: {
			Authorization: `Bearer ${env.REPLICATE_API_TOKEN}`,
			"Cancel-After": "15m",
			"Content-Type": "application/json",
		},
		body: JSON.stringify({
			version: `${model}:${version}`,
			input,
			webhook: webhookUrl,
			webhook_events_filter: ["completed"],
		}),
	});

	if (!response.ok) {
		console.error(`Replicate ${label} prediction failed: ${response.status} ${await safeResponseText(response)}`);
		throw new Error(`Replicate ${label} request failed.`);
	}

	return (await response.json()) as ReplicatePrediction;
}

async function persistAudioOutput(
	job: JobRow,
	prediction: ReplicatePrediction,
	outputUrl: string,
	env: AppEnv,
	completeJob: boolean,
	baseUrl?: string,
): Promise<{ job: JobRow; outputUrl: string }> {
	if (job.output_key) {
		if (completeJob) {
			await maybeSendCompletionEmail(job, env, baseUrl);
		}
		return { job, outputUrl };
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
		 SET status = ?, output_key = ?, output_content_type = ?, error = NULL,
		     replicate_prediction_id = COALESCE(replicate_prediction_id, ?),
		     replicate_get_url = COALESCE(replicate_get_url, ?), replicate_web_url = COALESCE(replicate_web_url, ?),
		     completed_at = ?, updated_at = ?
		 WHERE id = ?`,
	)
		.bind(
			completeJob ? "completed" : "processing",
			outputKey,
			outputContentType,
			prediction.id,
			optionalReplicateStatusUrl(prediction.urls?.get),
			prediction.urls?.web ?? null,
			completeJob ? now : null,
			now,
			job.id,
		)
		.run();

	const updatedJob = (await getJob(env, job.id)) ?? job;
	if (completeJob) {
		await maybeSendCompletionEmail(updatedJob, env, baseUrl);
	}

	return { job: updatedJob, outputUrl };
}

async function persistTranscript(job: JobRow, prediction: ReplicatePrediction, env: AppEnv, baseUrl?: string): Promise<JobRow> {
	const transcript = transcriptFromOutput(prediction.output);
	if (!transcript) {
		await markJobFailed(env, job.id, "Transcription failed: Replicate returned no transcript.");
		return (await getJob(env, job.id)) ?? job;
	}

	const now = new Date().toISOString();
	await env.DB.prepare(
		`UPDATE jobs
		 SET status = ?, transcript = ?, error = NULL,
		     replicate_prediction_id = COALESCE(replicate_prediction_id, ?),
		     replicate_get_url = COALESCE(replicate_get_url, ?), replicate_web_url = COALESCE(replicate_web_url, ?),
		     completed_at = COALESCE(completed_at, ?), updated_at = ?
		 WHERE id = ?`,
	)
		.bind(
			"completed",
			transcript,
			prediction.id,
			optionalReplicateStatusUrl(prediction.urls?.get),
			prediction.urls?.web ?? null,
			now,
			now,
			job.id,
		)
		.run();

	const updatedJob = (await getJob(env, job.id)) ?? job;
	await maybeSendCompletionEmail(updatedJob, env, baseUrl);
	return updatedJob;
}

async function storeActivePrediction(
	job: JobRow,
	prediction: ReplicatePrediction,
	model: string,
	webhookUrl: string,
	env: AppEnv,
): Promise<void> {
	const now = new Date().toISOString();
	await env.DB.prepare(
		`UPDATE jobs
		 SET status = CASE WHEN status IN ('completed', 'failed', 'canceled') THEN status ELSE ? END,
		     model = ?, replicate_prediction_id = ?, replicate_get_url = ?, replicate_web_url = ?, replicate_webhook_url = ?, updated_at = ?
		 WHERE id = ?`,
	)
		.bind("processing", model, prediction.id, optionalReplicateStatusUrl(prediction.urls?.get), prediction.urls?.web ?? null, webhookUrl, now, job.id)
		.run();
}

function outputUrlForStep(step: Exclude<ProcessingStep, "transcription">, output: unknown, job: JobRow): string | null {
	return step === "enhancement" ? pickOutputUrl(output, job.output_choice) : pickOutputUrl(output, "enhanced");
}

function predictionError(prediction: ReplicatePrediction, job: JobRow): string {
	if (typeof prediction.error !== "string" || !prediction.error.trim()) {
		const step = processingStepForModel(job.model);
		return step ? `${processingStepLabel(step)} failed.` : "Audio processing failed.";
	}

	return prediction.error.slice(0, 1000);
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

function requireWebhookUrl(job: JobRow, prediction: ReplicatePrediction, baseUrl?: string): string | null {
	for (const value of [prediction.webhook, job.replicate_webhook_url, baseUrl ? webhookUrl(job, baseUrl) : null]) {
		if (value && isHttpsUrl(value)) {
			return value;
		}
	}

	return null;
}

function webhookUrl(job: JobRow, baseUrl: string): string {
	return `${baseUrl}/api/jobs/${encodeURIComponent(job.id)}/webhook?token=${encodeURIComponent(job.webhook_token)}`;
}

function isHttpsUrl(value: string): boolean {
	try {
		return new URL(value).protocol === "https:";
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
