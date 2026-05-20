CREATE INDEX IF NOT EXISTS otp_codes_expiry_idx ON otp_codes (expires_at);
CREATE INDEX IF NOT EXISTS otp_codes_consumed_idx ON otp_codes (consumed_at);
CREATE INDEX IF NOT EXISTS sessions_expiry_idx ON sessions (expires_at);
CREATE INDEX IF NOT EXISTS jobs_expires_at_idx ON jobs (expires_at);
