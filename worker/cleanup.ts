import type { AppEnv, JobRow, UploadIntentRow } from "./types";

const CLEANUP_BATCH_SIZE = 100;

type CleanupResult = {
	otpCodes: number;
	sessions: number;
	uploadIntents: number;
	jobs: number;
	r2Objects: number;
};

type ExpiredUploadIntent = Pick<UploadIntentRow, "id" | "input_key">;
type ExpiredJob = Pick<JobRow, "id" | "input_key" | "output_key">;

export async function cleanupExpiredData(env: AppEnv, now = new Date()): Promise<CleanupResult> {
	const cutoff = now.toISOString();
	const auth = await cleanupExpiredAuth(env, cutoff);
	const uploads = await cleanupExpiredUploadIntents(env, cutoff);
	const jobs = await cleanupExpiredJobs(env, cutoff);

	return {
		otpCodes: auth.otpCodes,
		sessions: auth.sessions,
		uploadIntents: uploads.uploadIntents,
		jobs: jobs.jobs,
		r2Objects: uploads.r2Objects + jobs.r2Objects,
	};
}

async function cleanupExpiredAuth(env: AppEnv, cutoff: string): Promise<Pick<CleanupResult, "otpCodes" | "sessions">> {
	const otpCodes = await env.DB.prepare("DELETE FROM otp_codes WHERE expires_at <= ? OR consumed_at IS NOT NULL").bind(cutoff).run();
	const sessions = await env.DB.prepare("DELETE FROM sessions WHERE expires_at <= ?").bind(cutoff).run();

	return {
		otpCodes: changedRows(otpCodes),
		sessions: changedRows(sessions),
	};
}

async function cleanupExpiredUploadIntents(
	env: AppEnv,
	cutoff: string,
): Promise<Pick<CleanupResult, "uploadIntents" | "r2Objects">> {
	const { results } = await env.DB.prepare("SELECT id, input_key FROM upload_intents WHERE upload_expires_at <= ? LIMIT ?")
		.bind(cutoff, CLEANUP_BATCH_SIZE)
		.all<ExpiredUploadIntent>();

	let uploadIntents = 0;
	let r2Objects = 0;
	for (const upload of results) {
		r2Objects += await deleteR2Object(env, upload.input_key);
		const deleted = await env.DB.prepare("DELETE FROM upload_intents WHERE id = ? AND upload_expires_at <= ?")
			.bind(upload.id, cutoff)
			.run();
		uploadIntents += changedRows(deleted);
	}

	return { uploadIntents, r2Objects };
}

async function cleanupExpiredJobs(env: AppEnv, cutoff: string): Promise<Pick<CleanupResult, "jobs" | "r2Objects">> {
	const { results } = await env.DB.prepare("SELECT id, input_key, output_key FROM jobs WHERE expires_at <= ? LIMIT ?")
		.bind(cutoff, CLEANUP_BATCH_SIZE)
		.all<ExpiredJob>();

	let jobs = 0;
	let r2Objects = 0;
	for (const job of results) {
		r2Objects += await deleteR2Object(env, job.input_key);
		if (job.output_key) {
			r2Objects += await deleteR2Object(env, job.output_key);
		}
		const deleted = await env.DB.prepare("DELETE FROM jobs WHERE id = ? AND expires_at <= ?").bind(job.id, cutoff).run();
		jobs += changedRows(deleted);
	}

	return { jobs, r2Objects };
}

async function deleteR2Object(env: AppEnv, key: string): Promise<number> {
	await env.AUDIO_BUCKET.delete(key);
	return 1;
}

function changedRows(result: D1Result): number {
	return result.meta.changes;
}
