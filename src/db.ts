import type { AppEnv, JobRow, PublicJob, User } from "./types";

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

export function publicJob(job: JobRow): PublicJob {
	return {
		id: job.id,
		status: job.status,
		preset: job.preset,
		outputChoice: job.output_choice,
		inputName: job.input_name,
		inputSize: job.input_size,
		error: publicJobError(job.error),
		downloadUrl:
			job.status === "completed" && job.output_key && !isExpired(job.expires_at)
				? `/api/jobs/${encodeURIComponent(job.id)}/download?token=${encodeURIComponent(job.download_token)}`
				: null,
		expiresAt: job.expires_at,
	};
}

export function isExpired(expiresAt: string): boolean {
	return new Date(expiresAt).getTime() <= Date.now();
}

function publicJobError(error: string | null): string | null {
	if (!error) {
		return null;
	}

	return error === "Processing was canceled." ? error : "Audio cleanup failed. Please try again.";
}
