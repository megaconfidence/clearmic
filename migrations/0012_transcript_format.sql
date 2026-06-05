-- Let the user choose the transcription output format.
--
-- Stored as a short code: 'txt' (plain text) | 'srt' | 'vtt'. Defaults to 'txt'
-- so any existing rows keep the previous plain-text behavior.
ALTER TABLE upload_intents ADD COLUMN transcript_format TEXT NOT NULL DEFAULT 'txt';
ALTER TABLE jobs ADD COLUMN transcript_format TEXT NOT NULL DEFAULT 'txt';
