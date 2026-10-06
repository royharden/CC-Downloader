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
  cue_count: number;
  source: string;
  created_at: string;
}
