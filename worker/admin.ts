import { json } from "./http";
import { RATE_LIMIT } from "./rate-limiter";
import type { AppEnv } from "./types";

// Admin usage dashboard data, behind a shared passphrase (auth.md Part B). A
// single-operator scheme: the passphrase IS the credential, re-sent on every
// request in the `X-Admin-Passphrase` header. No sessions.
//
// Usage stats are kept forever. Historical totals live in usage_daily (a
// permanent rollup written by the cron cleanup as it deletes expired jobs), and
// the live `jobs` table holds only the current ~24h window before those rows are
// archived. All-time figures combine both; a job is counted in exactly one place
// at a time, so there is no double counting.
export async function getAdminStats(request: Request, env: AppEnv): Promise<Response> {
	const supplied = request.headers.get("x-admin-passphrase") ?? "";
	if (!env.ADMIN_PASSPHRASE || !safeStringEqual(supplied, env.ADMIN_PASSPHRASE)) {
		// Fixed delay on the 401 path throttles brute-force guessing (~1 try / 0.5s)
		// without annoying the real operator (who unlocks once).
		await sleep(500);
		return json({ error: "Unauthorized" }, 401, { "cache-control": "no-store" });
	}

	const now = new Date();
	const nowIso = now.toISOString();

	const uploadsRow = await env.DB.prepare("SELECT COUNT(*) AS pending FROM upload_intents WHERE upload_expires_at > ?")
		.bind(nowIso)
		.first<{ pending: number }>();

	// Permanent history (jobs already cleaned up).
	const histRow = await env.DB.prepare(
		`SELECT
			COALESCE(SUM(jobs), 0) AS jobs,
			COALESCE(SUM(completed), 0) AS completed,
			COALESCE(SUM(failed), 0) AS failed,
			COALESCE(SUM(canceled), 0) AS canceled,
			COALESCE(SUM(silence_removal), 0) AS silence_removal,
			COALESCE(SUM(noise_removal), 0) AS noise_removal,
			COALESCE(SUM(enhancement), 0) AS enhancement,
			COALESCE(SUM(transcription), 0) AS transcription,
			COALESCE(SUM(email_opt_in), 0) AS email_opt_in,
			COALESCE(SUM(input_bytes), 0) AS input_bytes,
			MIN(day) AS since
		 FROM usage_daily`,
	).first<Record<string, number | string | null>>();

	// Live jobs not yet archived (the current ~24h window).
	const liveRow = await env.DB.prepare(
		`SELECT
			COUNT(*) AS total,
			SUM(CASE WHEN status = 'queued' THEN 1 ELSE 0 END) AS queued,
			SUM(CASE WHEN status = 'processing' THEN 1 ELSE 0 END) AS processing,
			SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed,
			SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed,
			SUM(CASE WHEN status = 'canceled' THEN 1 ELSE 0 END) AS canceled,
			SUM(CASE WHEN silence_removal = 1 THEN 1 ELSE 0 END) AS silence_removal,
			SUM(CASE WHEN noise_removal = 1 THEN 1 ELSE 0 END) AS noise_removal,
			SUM(CASE WHEN enhance = 1 THEN 1 ELSE 0 END) AS enhancement,
			SUM(CASE WHEN transcribe = 1 THEN 1 ELSE 0 END) AS transcription,
			SUM(CASE WHEN email_on_completion = 1 THEN 1 ELSE 0 END) AS email_opt_in,
			COALESCE(SUM(input_size), 0) AS input_bytes,
			MIN(created_at) AS since
		 FROM jobs
		 WHERE expires_at > ?`,
	)
		.bind(nowIso)
		.first<Record<string, number | string | null>>();

	const liveTotal = num(liveRow?.total);
	const allTimeJobs = num(histRow?.jobs) + liveTotal;
	const allTimeBytes = num(histRow?.input_bytes) + num(liveRow?.input_bytes);

	const histSince = typeof histRow?.since === "string" ? histRow.since : null;
	const liveSince = typeof liveRow?.since === "string" ? liveRow.since.slice(0, 10) : null;

	return json(
		{
			generatedAt: nowIso,
			dailyJobLimit: RATE_LIMIT,
			statsSince: histSince ?? liveSince,
			uploads: {
				pending: num(uploadsRow?.pending),
			},
			live: {
				jobs: liveTotal,
				byStatus: {
					queued: num(liveRow?.queued),
					processing: num(liveRow?.processing),
					completed: num(liveRow?.completed),
					failed: num(liveRow?.failed),
					canceled: num(liveRow?.canceled),
				},
			},
			allTime: {
				jobs: allTimeJobs,
				completed: num(histRow?.completed) + num(liveRow?.completed),
				failed: num(histRow?.failed) + num(liveRow?.failed),
				canceled: num(histRow?.canceled) + num(liveRow?.canceled),
				steps: {
					silenceRemoval: num(histRow?.silence_removal) + num(liveRow?.silence_removal),
					noiseRemoval: num(histRow?.noise_removal) + num(liveRow?.noise_removal),
					enhancement: num(histRow?.enhancement) + num(liveRow?.enhancement),
					transcription: num(histRow?.transcription) + num(liveRow?.transcription),
				},
				emailOptIn: num(histRow?.email_opt_in) + num(liveRow?.email_opt_in),
				inputBytes: allTimeBytes,
				avgInputBytes: allTimeJobs > 0 ? Math.round(allTimeBytes / allTimeJobs) : 0,
			},
		},
		200,
		{ "cache-control": "no-store" },
	);
}

function num(value: number | string | null | undefined): number {
	return Number(value ?? 0);
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

// Constant-time compare so response timing can't leak how many leading
// characters of the passphrase are correct.
function safeStringEqual(a: string, b: string): boolean {
	if (a.length !== b.length) {
		return false;
	}

	let result = 0;
	for (let i = 0; i < a.length; i++) {
		result |= a.charCodeAt(i) ^ b.charCodeAt(i);
	}

	return result === 0;
}
