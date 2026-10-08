/**
 * Background service worker for the extension.
 * Handles communication between popup and content script,
 * and saves transcripts to Supabase.
 */

// Supabase configuration — these are public anon-key values
const SUPABASE_URL = 'https://0ec90b57d6e95fcbda19832f.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJib2x0IiwicmVmIjoiMGVjOTBiNTdkNmU5NWZjYmRhMTk4MzJmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTg4ODE1NzQsImV4cCI6MTc1ODg4MTU3NH0.9I8-U0x86Ak8t2DGaIk0HfvTSLsAyzdnz-Nw00mMkKw';

/**
 * Save transcript to Supabase.
 * @param {{url: string, videoId: string, title: string, transcript: string, timestamped: string, cueData: Array, cueCount: number, durationSeconds: number, source: string}} data
 * @returns {Promise<{success: boolean, error?: string, data?: any}>}
 */
async function saveToSupabase(data) {
  try {
    const resp = await fetch(`${SUPABASE_URL}/rest/v1/transcripts`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        'Prefer': 'return=representation',
      },
      body: JSON.stringify({
        video_url: data.url,
        video_id: data.videoId,
        title: data.title,
        transcript_text: data.transcript,
        transcript_timestamped: data.timestamped || null,
        cue_data: Array.isArray(data.cueData) ? data.cueData : null,
        cue_count: data.cueCount,
        duration_seconds: data.durationSeconds ?? null,
        source: data.source || 'extension',
      }),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      return { success: false, error: `Failed to save: ${resp.status} ${errText}` };
    }

    const result = await resp.json();
    return { success: true, data: result };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * Fetch transcript history from Supabase.
 * @returns {Promise<{success: boolean, error?: string, data?: any}>}
 */
async function fetchHistory() {
  try {
    const resp = await fetch(`${SUPABASE_URL}/rest/v1/transcripts?order=created_at.desc&limit=50`, {
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
      },
    });

    if (!resp.ok) {
      return { success: false, error: `Failed to fetch: ${resp.status}` };
    }

    const data = await resp.json();
    return { success: true, data };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'saveToSupabase') {
    saveToSupabase(request.data).then(sendResponse);
    return true;
  }

  if (request.action === 'fetchHistory') {
    fetchHistory().then(sendResponse);
    return true;
  }
});
