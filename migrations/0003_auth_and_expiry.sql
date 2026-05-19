CREATE TABLE IF NOT EXISTS users (
	id TEXT PRIMARY KEY,
	email TEXT NOT NULL UNIQUE,
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS otp_codes (
	id TEXT PRIMARY KEY,
	email TEXT NOT NULL,
	code_hash TEXT NOT NULL,
	attempts INTEGER NOT NULL DEFAULT 0,
	expires_at TEXT NOT NULL,
	consumed_at TEXT,
	created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS otp_codes_email_idx ON otp_codes (email, created_at);

CREATE TABLE IF NOT EXISTS sessions (
	id TEXT PRIMARY KEY,
	user_id TEXT NOT NULL REFERENCES users (id),
	token_hash TEXT NOT NULL UNIQUE,
	expires_at TEXT NOT NULL,
	created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS sessions_token_hash_idx ON sessions (token_hash);
CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON sessions (user_id);

ALTER TABLE jobs ADD COLUMN user_id TEXT REFERENCES users (id);
ALTER TABLE jobs ADD COLUMN expires_at TEXT NOT NULL DEFAULT '';
ALTER TABLE jobs ADD COLUMN deleted_at TEXT;

UPDATE jobs
SET expires_at = strftime('%Y-%m-%dT%H:%M:%fZ', created_at, '+24 hours')
WHERE expires_at = '';

CREATE INDEX IF NOT EXISTS jobs_user_active_idx ON jobs (user_id, deleted_at, expires_at);
CREATE INDEX IF NOT EXISTS jobs_expiry_idx ON jobs (deleted_at, expires_at);
