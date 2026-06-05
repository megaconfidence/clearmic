import type { AppEnv, JobRow, PublicJob } from "./types";
import { firstSelectedProcessingStep, processingStepForModel } from "./pipeline";

export async function getJob(env: AppEnv, jobId: string): Promise<JobRow | null> {
	return env.DB.prepare("SELECT * FROM jobs WHERE id = ?").bind(jobId).first<JobRow>();
}

export async function markJobFailed(env: AppEnv, jobId: string, error: string): Promise<void> {
	const now = new Date().toISOString();
	await env.DB.prepare("UPDATE jobs SET status = ?, error = ?, updated_at = ? WHERE id = ?")
		.bind("failed", error.slice(0, 1000), now, jobId)
		.run();
}

export function publicJob(job: JobRow, options: { includeTranscript?: boolean } = {}): PublicJob {
	return {
		id: job.id,
		status: job.status,
		processingStep: publicProcessingStep(job),
		preset: job.preset,
		outputChoice: job.output_choice,
		inputName: job.input_name,
		inputSize: job.input_size,
		silenceRemovalRequested: job.silence_removal === 1,
		noiseRemovalRequested: job.noise_removal === 1,
		enhancementRequested: job.enhance === 1,
		transcriptionRequested: job.transcribe === 1,
		transcript: options.includeTranscript ? job.transcript : null,
		transcriptFormat: job.transcript_format,
		emailRequested: job.email_on_completion === 1,
		error: publicJobError(job.error),
		downloadUrl:
			job.status === "completed" && job.output_key && !isExpired(job.expires_at)
				? `/api/jobs/${encodeURIComponent(job.id)}/download?token=${encodeURIComponent(job.download_token)}`
				: null,
		transcriptUrl:
			job.status === "completed" && job.transcript && !isExpired(job.expires_at)
				? `/api/jobs/${encodeURIComponent(job.id)}/transcript?token=${encodeURIComponent(job.download_token)}`
				: null,
		expiresAt: job.expires_at,
	};
}

function publicProcessingStep(job: JobRow): "silence_removal" | "noise_removal" | "enhancement" | "transcription" | null {
	if (job.status !== "queued" && job.status !== "processing") {
		return null;
	}

	// Two branches can run at once; surface the audio step if active, else
	// transcription, else the first step that will run.
	if (job.replicate_prediction_id) {
		return processingStepForModel(job.model) ?? firstSelectedProcessingStep(job);
	}
	if (job.transcribe_prediction_id) {
		return "transcription";
	}
	return firstSelectedProcessingStep(job);
}

export function isExpired(expiresAt: string): boolean {
	return new Date(expiresAt).getTime() <= Date.now();
}

function publicJobError(error: string | null): string | null {
	if (!error) {
		return null;
	}

	if (error === "Processing was canceled.") {
		return error;
	}

	if (error.startsWith("Transcription failed")) {
		return "Transcription failed. Please try again.";
	}
	if (error.startsWith("Silence removal failed")) {
		return "Silence removal failed. Please try again.";
	}
	if (error.startsWith("Noise removal failed")) {
		return "Noise removal failed. Please try again.";
	}
	if (error.startsWith("Enhancement failed")) {
		return "Enhancement failed. Please try again.";
	}

	return "Audio processing failed. Please try again.";
}
