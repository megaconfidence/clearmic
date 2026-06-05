import type { AppEnv, JobStatus, UploadIntentRow } from "./types";

const CLEANUP_BATCH_SIZE = 100;

type CleanupResult = {
	uploadIntents: number;
	jobs: number;
	r2Objects: number;
};

type ExpiredUploadIntent = Pick<UploadIntentRow, "id" | "input_key">;
type ExpiredJob = {
	id: string;
	input_key: string;
	output_key: string | null;
	status: JobStatus;
	silence_removal: number;
	noise_removal: number;
	enhance: number;
	transcribe: number;
	email_on_completion: number;
	input_size: number;
	created_at: string;
};

export async function cleanupExpiredData(env: AppEnv, now = new Date()): Promise<CleanupResult> {
	const cutoff = now.toISOString();
	const uploads = await cleanupExpiredUploadIntents(env, cutoff);
	const jobs = await cleanupExpiredJobs(env, cutoff);

	return {
		uploadIntents: uploads.uploadIntents,
		jobs: jobs.jobs,
		r2Objects: uploads.r2Objects + jobs.r2Objects,
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
	const { results } = await env.DB.prepare(
		`SELECT id, input_key, output_key, status, silence_removal, noise_removal, enhance, transcribe, email_on_completion, input_size, created_at
		 FROM jobs WHERE expires_at <= ? LIMIT ?`,
	)
		.bind(cutoff, CLEANUP_BATCH_SIZE)
		.all<ExpiredJob>();

	let jobs = 0;
	let r2Objects = 0;
	for (const job of results) {
		r2Objects += await deleteR2Object(env, job.input_key);
		if (job.output_key) {
			r2Objects += await deleteR2Object(env, job.output_key);
		}

		// Archive the job's aggregate facts into the permanent rollup and delete the
		// row in one atomic batch, so usage history is never lost and never double-counted.
		const batch = await env.DB.batch([
			archiveJobStatement(env, job),
			env.DB.prepare("DELETE FROM jobs WHERE id = ? AND expires_at <= ?").bind(job.id, cutoff),
		]);
		jobs += changedRows(batch[batch.length - 1]);
	}

	return { jobs, r2Objects };
}

function archiveJobStatement(env: AppEnv, job: ExpiredJob): D1PreparedStatement {
	const day = (job.created_at || "").slice(0, 10);
	return env.DB.prepare(
		`INSERT INTO usage_daily (day, jobs, completed, failed, canceled, silence_removal, noise_removal, enhancement, transcription, email_opt_in, input_bytes)
		 VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		 ON CONFLICT(day) DO UPDATE SET
			jobs = jobs + 1,
			completed = completed + excluded.completed,
			failed = failed + excluded.failed,
			canceled = canceled + excluded.canceled,
			silence_removal = silence_removal + excluded.silence_removal,
			noise_removal = noise_removal + excluded.noise_removal,
			enhancement = enhancement + excluded.enhancement,
			transcription = transcription + excluded.transcription,
			email_opt_in = email_opt_in + excluded.email_opt_in,
			input_bytes = input_bytes + excluded.input_bytes`,
	).bind(
		day,
		job.status === "completed" ? 1 : 0,
		job.status === "failed" ? 1 : 0,
		job.status === "canceled" ? 1 : 0,
		job.silence_removal === 1 ? 1 : 0,
		job.noise_removal === 1 ? 1 : 0,
		job.enhance === 1 ? 1 : 0,
		job.transcribe === 1 ? 1 : 0,
		job.email_on_completion === 1 ? 1 : 0,
		job.input_size || 0,
	);
}

async function deleteR2Object(env: AppEnv, key: string): Promise<number> {
	await env.AUDIO_BUCKET.delete(key);
	return 1;
}

function changedRows(result: D1Result): number {
	return result.meta.changes;
}
