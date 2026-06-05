-- Run transcription in parallel with the audio-cleaning chain.
--
-- The pipeline now has two concurrent branches:
--   * audio branch  -> silence -> noise -> enhance (tracked by replicate_prediction_id / replicate_get_url)
--   * transcribe branch -> whisper (tracked by the new columns below)
-- The job completes when both branches have finished. Transcription reads the
-- silence-removed audio when silence removal is selected (so SRT/VTT timestamps
-- line up with the downloadable file), otherwise the raw upload.
ALTER TABLE jobs ADD COLUMN transcribe_prediction_id TEXT;
ALTER TABLE jobs ADD COLUMN transcribe_get_url TEXT;
