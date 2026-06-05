-- New processing step: silence removal (nikitalokhmachev-ai/silero-vad), which
-- trims silent gaps out of the audio. It runs first in the chain, before noise
-- removal / enhancement / transcription. Defaults to 0 so existing rows are
-- unaffected. The usage_daily rollup gets a matching column for the admin stats.
ALTER TABLE upload_intents ADD COLUMN silence_removal INTEGER NOT NULL DEFAULT 0;
ALTER TABLE jobs ADD COLUMN silence_removal INTEGER NOT NULL DEFAULT 0;
ALTER TABLE usage_daily ADD COLUMN silence_removal INTEGER NOT NULL DEFAULT 0;
