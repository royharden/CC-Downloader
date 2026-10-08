/*
# Add cue_data column for timestamped caption cues

1. Modified Tables
- `transcripts`
  - `cue_data` (jsonb, nullable) — array of { start, end, text } cue objects in seconds.
    Stored so the web app and extension can generate SRT and WebVTT subtitle files
    on demand without re-fetching the source captions.
2. Security
- No policy changes needed: existing anon+authenticated policies cover the new column.
*/

ALTER TABLE transcripts ADD COLUMN IF NOT EXISTS cue_data jsonb;
