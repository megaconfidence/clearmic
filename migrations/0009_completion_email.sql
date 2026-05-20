ALTER TABLE upload_intents ADD COLUMN email_on_completion INTEGER NOT NULL DEFAULT 0;
ALTER TABLE jobs ADD COLUMN email_on_completion INTEGER NOT NULL DEFAULT 0;
ALTER TABLE jobs ADD COLUMN completion_email_sent_at TEXT;
