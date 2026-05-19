import type { AppEnv, JobRow, PublicJob } from "./types";

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
		error: job.error,
		downloadUrl:
			job.status === "completed" && job.output_key
				? `/api/jobs/${encodeURIComponent(job.id)}/download?token=${encodeURIComponent(job.download_token)}`
				: null,
	};
}
