import type { AppEnv, JobRow, PublicJob, User } from "./types";
import { firstSelectedProcessingStep, processingStepForModel } from "./pipeline";

export async function getUser(env: AppEnv, userId: string): Promise<User | null> {
	return env.DB.prepare("SELECT id, email FROM users WHERE id = ?").bind(userId).first<User>();
}

export async function getOrCreateUser(env: AppEnv, email: string): Promise<User> {
	const existing = await env.DB.prepare("SELECT id, email FROM users WHERE email = ?").bind(email).first<User>();
	if (existing) {
		return existing;
	}

	const now = new Date().toISOString();
	const userId = crypto.randomUUID();
	await env.DB.prepare("INSERT INTO users (id, email, created_at, updated_at) VALUES (?, ?, ?, ?)")
		.bind(userId, email, now, now)
		.run();

	return { id: userId, email };
}

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
		noiseRemovalRequested: job.noise_removal === 1,
		enhancementRequested: job.enhance === 1,
		transcriptionRequested: job.transcribe === 1,
		transcript: options.includeTranscript ? job.transcript : null,
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

function publicProcessingStep(job: JobRow): "noise_removal" | "enhancement" | "transcription" | null {
	if (job.status !== "queued" && job.status !== "processing") {
		return null;
	}

	return processingStepForModel(job.model) ?? firstSelectedProcessingStep(job);
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
	if (error.startsWith("Noise removal failed")) {
		return "Noise removal failed. Please try again.";
	}
	if (error.startsWith("Enhancement failed")) {
		return "Enhancement failed. Please try again.";
	}

	return "Audio processing failed. Please try again.";
}
