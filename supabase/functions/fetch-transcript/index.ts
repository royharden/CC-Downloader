import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Client-Info, Apikey",
};

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

/**
 * Parse WebVTT content into plain text.
 */
function parseVTT(vtt: string): { text: string; cues: number } {
  const lines = vtt.split("\n");
  let text = "";
  let cueCount = 0;
  let inCue = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (
      trimmed.startsWith("WEBVTT") ||
      trimmed.startsWith("NOTE") ||
      trimmed.match(/^\d{2}:\d{2}/) ||
      trimmed.match(/^\d+$/)
    ) {
      if (trimmed.match(/^\d{2}:\d{2}/) || trimmed.match(/^\d+$/)) {
        inCue = true;
      }
      continue;
    }
    if (trimmed === "") {
      inCue = false;
      continue;
    }
    if (inCue) {
      const clean = trimmed.replace(/<[^>]*>/g, "").trim();
      if (clean && !text.endsWith(clean + "\n")) {
        text += clean + "\n";
        cueCount++;
      }
    }
  }

  return { text: text.trim(), cues: cueCount };
}

/**
 * Parse TTML/DFXP XML content into plain text.
 */
function parseTTML(xml: string): { text: string; cues: number } {
  try {
    const doc = new DOMParser().parseFromString(xml, "text/xml");
    const textEls = doc.getElementsByTagName("p");
    let text = "";
    let cueCount = 0;
    for (let i = 0; i < textEls.length; i++) {
      const clean = textEls[i].textContent.replace(/<[^>]*>/g, "").trim();
      if (clean) {
        text += clean + "\n";
        cueCount++;
      }
    }
    return { text: text.trim(), cues: cueCount };
  } catch {
    return { text: "", cues: 0 };
  }
}

/**
 * Extract video ID from MSN URL.
 */
function extractVideoId(url: string): string | null {
  const match = url.match(/\/vi-([A-Za-z0-9]+)/);
  return match ? match[1] : null;
}

/**
 * Fetch MSN video page and attempt to extract caption track URLs.
 */
async function fetchTranscriptFromUrl(url: string): Promise<{
  title: string | null;
  videoId: string | null;
  transcript: string;
  cueCount: number;
} | null> {
  try {
    const resp = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml",
        "Accept-Language": "en-US,en;q=0.9",
      },
    });

    if (!resp.ok) {
      return null;
    }

    const html = await resp.text();

    // Extract title
    let title: string | null = null;
    const ogTitleMatch = html.match(
      /<meta\s+property="og:title"\s+content="([^"]*)"/i,
    );
    if (ogTitleMatch) {
      title = ogTitleMatch[1];
    }
    if (!title) {
      const titleMatch = html.match(/<title>([^<]*)<\/title>/i);
      if (titleMatch) {
        title = titleMatch[1].trim();
      }
    }

    const videoId = extractVideoId(url);

    // Look for WebVTT or TTML caption URLs in the HTML
    // MSN may embed caption URLs in JSON config or as track sources
    const vttUrlMatches = html.match(/https?:\/\/[^\s"']+\.vtt[^\s"']*/gi) ||
      [];
    const ttmlUrlMatches = html.match(
      /https?:\/\/[^\s"']+\.(?:ttml|dfxp|xml)[^\s"']*/gi,
    ) || [];

    // Also search for caption URLs in JSON-like patterns
    const captionUrlMatches = html.match(
      /["'(](https?:\/\/[^\s"')]+(?:captions|subtitles|tracks|texttrack)[^\s"')]*)["')]/gi,
    ) || [];

    const allUrls = [
      ...vttUrlMatches,
      ...ttmlUrlMatches,
      ...captionUrlMatches.map((s) =>
        s.replace(/^["'(]/, "").replace(/["')]$/, "")
      ),
    ];

    for (const captionUrl of allUrls) {
      try {
        const captionResp = await fetch(captionUrl, {
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          },
        });
        if (!captionResp.ok) continue;
        const captionText = await captionResp.text();

        let parsed: { text: string; cues: number };
        if (captionUrl.match(/\.vtt/i) || captionText.startsWith("WEBVTT")) {
          parsed = parseVTT(captionText);
        } else {
          parsed = parseTTML(captionText);
        }

        if (parsed.cues > 0) {
          return {
            title,
            videoId,
            transcript: parsed.text,
            cueCount: parsed.cues,
          };
        }
      } catch {
        // skip this URL
      }
    }

    // If no direct caption URLs found, check if transcript text is embedded in page data
    // Some MSN pages embed transcript data in JSON-LD or page config
    const transcriptMatch = html.match(
      /"transcript"\s*:\s*"((?:[^"\\]|\\.)*)"/i,
    );
    if (transcriptMatch) {
      const transcriptText = transcriptMatch[1]
        .replace(/\\n/g, "\n")
        .replace(/\\r/g, "")
        .replace(/\\"/g, '"')
        .replace(/<[^>]*>/g, "")
        .trim();
      if (transcriptText.length > 0) {
        const cues = transcriptText.split("\n").filter((l) => l.trim()).length;
        return { title, videoId, transcript: transcriptText, cueCount: cues };
      }
    }

    return null;
  } catch {
    return null;
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    if (req.method !== "POST") {
      return new Response(
        JSON.stringify({ error: "Method not allowed" }),
        { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const body = await req.json();
    const { url, save } = body;

    if (!url || typeof url !== "string") {
      return new Response(
        JSON.stringify({ error: "URL is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (!url.includes("msn.com")) {
      return new Response(
        JSON.stringify({ error: "Only MSN video URLs are supported" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const result = await fetchTranscriptFromUrl(url);

    if (!result || result.cueCount === 0) {
      return new Response(
        JSON.stringify({
          success: false,
          error:
            "No captions found for this video. The video may not have closed captions, or captions may only be available during playback (use the browser extension in that case).",
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    let savedRecord = null;
    if (save) {
      const { data, error } = await supabase
        .from("transcripts")
        .insert({
          video_url: url,
          video_id: result.videoId,
          title: result.title,
          transcript_text: result.transcript,
          cue_count: result.cueCount,
          source: "web",
        })
        .select()
        .single();

      if (!error) {
        savedRecord = data;
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        title: result.title,
        videoId: result.videoId,
        transcript: result.transcript,
        cueCount: result.cueCount,
        saved: !!savedRecord,
        record: savedRecord,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
