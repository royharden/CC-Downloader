const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

export interface FetchResult {
  success: boolean;
  title: string | null;
  videoId: string | null;
  transcript: string;
  cueCount: number;
  saved: boolean;
  error?: string;
}

/**
 * Fetch transcript from an MSN video URL via the edge function.
 */
export async function fetchTranscriptFromUrl(
  url: string,
  save: boolean,
): Promise<FetchResult> {
  const apiUrl = `${SUPABASE_URL}/functions/v1/fetch-transcript`;
  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    },
    body: JSON.stringify({ url, save }),
  });

  if (!response.ok) {
    throw new Error(`Request failed (${response.status})`);
  }

  const data = await response.json();
  if (!data || typeof data !== 'object') {
    throw new Error('Invalid response from server');
  }
  return data as FetchResult;
}
