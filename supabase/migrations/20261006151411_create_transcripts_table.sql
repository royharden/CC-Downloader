/*
# Create transcripts table (single-tenant, no auth)

1. New Tables
- `transcripts`
  - `id` (uuid, primary key)
  - `video_url` (text, not null) — the original MSN video page URL
  - `video_id` (text) — extracted video identifier from the URL (e.g. AA2dv84G)
  - `title` (text) — the video page title
  - `transcript_text` (text, not null) — the full plain-text transcript
  - `cue_count` (integer) — number of caption cues extracted
  - `source` (text) — 'extension' or 'web' indicating where it was captured
  - `created_at` (timestamptz, default now())
2. Security
- Enable RLS on `transcripts`.
- Allow anon + authenticated CRUD because the data is intentionally shared/public (no sign-in).
*/

CREATE TABLE IF NOT EXISTS transcripts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  video_url text NOT NULL,
  video_id text,
  title text,
  transcript_text text NOT NULL,
  cue_count integer DEFAULT 0,
  source text DEFAULT 'extension',
  created_at timestamptz DEFAULT now()
);

ALTER TABLE transcripts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_transcripts" ON transcripts;
CREATE POLICY "anon_select_transcripts" ON transcripts FOR SELECT
TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_insert_transcripts" ON transcripts;
CREATE POLICY "anon_insert_transcripts" ON transcripts FOR INSERT
TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "anon_update_transcripts" ON transcripts;
CREATE POLICY "anon_update_transcripts" ON transcripts FOR UPDATE
TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "anon_delete_transcripts" ON transcripts;
CREATE POLICY "anon_delete_transcripts" ON transcripts FOR DELETE
TO anon, authenticated USING (true);

CREATE INDEX IF NOT EXISTS idx_transcripts_video_id ON transcripts(video_id);
CREATE INDEX IF NOT EXISTS idx_transcripts_created_at ON transcripts(created_at DESC);
