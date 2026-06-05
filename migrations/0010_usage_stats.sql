-- Persistent usage rollup. Survives the 24h cron cleanup that hard-deletes jobs
-- and their R2 objects, so aggregate usage history is kept forever. One row per
-- UTC day; counts + summed bytes only (no filenames, tokens, transcripts, or
-- per-user PII). Rows are upserted when an expired job is archived in cleanup.ts.
CREATE TABLE IF NOT EXISTS usage_daily (
	day TEXT PRIMARY KEY, -- 'YYYY-MM-DD' (UTC) of job creation
	jobs INTEGER NOT NULL DEFAULT 0,
	completed INTEGER NOT NULL DEFAULT 0,
	failed INTEGER NOT NULL DEFAULT 0,
	canceled INTEGER NOT NULL DEFAULT 0,
	noise_removal INTEGER NOT NULL DEFAULT 0,
	enhancement INTEGER NOT NULL DEFAULT 0,
	transcription INTEGER NOT NULL DEFAULT 0,
	email_opt_in INTEGER NOT NULL DEFAULT 0,
	input_bytes INTEGER NOT NULL DEFAULT 0
);
