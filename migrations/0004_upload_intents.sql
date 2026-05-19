CREATE TABLE IF NOT EXISTS upload_intents (
	id TEXT PRIMARY KEY,
	user_id TEXT NOT NULL REFERENCES users (id),
	input_key TEXT NOT NULL UNIQUE,
	input_name TEXT NOT NULL,
	input_content_type TEXT,
	input_size INTEGER NOT NULL,
	preset TEXT NOT NULL,
	solver TEXT NOT NULL,
	number_function_evaluations INTEGER NOT NULL,
	prior_temperature REAL NOT NULL,
	output_choice TEXT NOT NULL,
	input_token TEXT NOT NULL,
	download_token TEXT NOT NULL,
	webhook_token TEXT NOT NULL,
	expires_at TEXT NOT NULL,
	upload_expires_at TEXT NOT NULL,
	created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS upload_intents_user_idx ON upload_intents (user_id, created_at);
CREATE INDEX IF NOT EXISTS upload_intents_expiry_idx ON upload_intents (upload_expires_at);
CREATE INDEX IF NOT EXISTS jobs_user_created_idx ON jobs (user_id, created_at);
