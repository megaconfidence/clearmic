CREATE TABLE IF NOT EXISTS jobs (
	id TEXT PRIMARY KEY,
	status TEXT NOT NULL CHECK (status IN ('queued', 'processing', 'completed', 'failed', 'canceled')),
	model TEXT NOT NULL,
	input_key TEXT NOT NULL,
	input_name TEXT NOT NULL,
	input_content_type TEXT,
	input_size INTEGER NOT NULL,
	output_key TEXT,
	output_content_type TEXT,
	replicate_prediction_id TEXT,
	replicate_get_url TEXT,
	replicate_web_url TEXT,
	error TEXT,
	input_token TEXT NOT NULL,
	download_token TEXT NOT NULL,
	webhook_token TEXT NOT NULL,
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL,
	completed_at TEXT
);

CREATE INDEX IF NOT EXISTS jobs_status_idx ON jobs (status);
