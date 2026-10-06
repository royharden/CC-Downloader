/*
# Add timestamped transcript and duration columns

1. Modified Tables
- `transcripts`
  - `transcript_timestamped` (text, nullable) — transcript with [mm:ss] timestamps per caption cue
  - `duration_seconds` (integer, nullable) — video duration in seconds
2. Security
- No policy changes needed: existing anon+authenticated policies cover the new columns.
*/

ALTER TABLE transcripts ADD COLUMN IF NOT EXISTS transcript_timestamped text;
ALTER TABLE transcripts ADD COLUMN IF NOT EXISTS duration_seconds integer;
