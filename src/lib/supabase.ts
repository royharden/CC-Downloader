import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

export interface Transcript {
  id: string;
  video_url: string;
  video_id: string | null;
  title: string | null;
  transcript_text: string;
  transcript_timestamped: string | null;
  cue_count: number;
  duration_seconds: number | null;
  cue_data: Cue[] | null;
  source: string;
  created_at: string;
}

export interface Cue {
  start: number;
  end: number;
  text: string;
}
