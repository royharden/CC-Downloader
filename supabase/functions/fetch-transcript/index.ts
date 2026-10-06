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

interface MsnClosedCaption {
  locale: string;
  href: string;
}

interface MsnContent {
  title?: string;
  body?: string;
  sourceHref?: string;
  videoMetadata?: {
    playTime?: number;
    closedCaptions?: MsnClosedCaption[];
  };
}

/**
 * Extract the video ID from an MSN URL (vi-AA2dv84G or vp-AA2dv84G).
 */
function extractVideoId(url: string): string | null {
  const match = url.match(/\/v[pi]-([A-Za-z0-9]+)/);
  return match ? match[1] : null;
}

/**
 * Parse TTML caption XML into plain text and timestamped text.
 * MSN captions are TTML with <p begin="..." end="..."> cue elements.
 */
function parseTTML(xml: string): {
  text: string;
  timestamped: string;
  cues: number;
} {
  const cues: { begin: string; text: string }[] = [];
  // Match each cue: <p begin="00:00:03.840" ...>text</p>
  const cueRegex =
    /<p\b[^>]*\bbegin="([^"]*)"[^>]*>([\s\S]*?)<\/p\s*>/gi;
  let match: RegExpExecArray | null;
  while ((match = cueRegex.exec(xml)) !== null) {
    const begin = match[1];
    const raw = match[2]
      .replace(/<br\s*\/?>/gi, " ")
      .replace(/<[^>]*>/g, "")
      .replace(/&amp;/g, "&")
      .replace(/&#39;/g, "'")
      .replace(/&quot;/g, '"')
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/\s+/g, " ")
      .trim();
    if (raw) {
      cues.push({ begin, text: raw });
    }
  }

  // Merge overlapping/rolling cues into a flowing plain transcript:
  // consecutive cues that duplicate each other (rolling captions) are deduped.
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const cue of cues) {
    const line = cue.text;
    if (!seen.has(line)) {
      seen.add(line);
      lines.push(line);
    }
  }

  // Timestamped version: [mm:ss] before each cue
  const stampLines: string[] = [];
  for (const cue of cues) {
    const stamp = formatTimestamp(cue.begin);
    stampLines.push(`[${stamp}] ${cue.text}`);
  }

  return {
    text: lines.join("\n").trim(),
    timestamped: stampLines.join("\n").trim(),
    cues: cues.length,
  };
}

/**
 * Convert a TTML timestamp (00:00:03.840 or 03.840 or 00:03.840) to mm:ss.
 */
function formatTimestamp(ts: string): string {
  const parts = ts.split(":").map((p) => parseFloat(p));
  let seconds = 0;
  if (parts.length === 3) {
    seconds = parts[0] * 3600 + parts[1] * 60 + parts[2];
  } else if (parts.length === 2) {
    seconds = parts[0] * 60 + parts[1];
  } else if (parts.length === 1) {
    seconds = parts[0];
  }
  const total = Math.floor(seconds);
  const mm = Math.floor(total / 60);
  const ss = total % 60;
  return `${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
}

/**
 * Fetch the MSN content API for a video ID. Returns null on failure.
 */
async function fetchMsnContent(
  videoId: string,
  locale: string,
): Promise<MsnContent | null> {
  // Try both vp- and vi- prefixed IDs via the content detail endpoint.
  const urls = [
    `https://assets.msn.com/content/view/v2/detail/${locale}/AA${videoId.replace(/^AA/, "")}`,
    `https://assets.msn.com/content/view/v2/detail/${locale}/${videoId}`,
    `https://assets.msn.com/content/view/v2/detail/${locale}/vi-${videoId}`,
    `https://assets.msn.com/content/view/v2/detail/${locale}/vp-${videoId}`,
  ];

  for (const u of urls) {
    try {
      const resp = await fetch(u, {
        headers: {
          "Accept": "application/json",
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        },
      });
      if (!resp.ok) continue;
      const data = await resp.json();
      if (data && typeof data === "object" && (data.body || data.videoMetadata)) {
        return data as MsnContent;
      }
    } catch {
      // try next URL shape
    }
  }
  return null;
}

/**
 * Fetch a caption file and parse it.
 */
async function fetchCaptions(
  href: string,
): Promise<{ text: string; timestamped: string; cues: number } | null> {
  try {
    const resp = await fetch(href, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
    });
    if (!resp.ok) return null;
    const xml = await resp.text();
    const parsed = parseTTML(xml);
    if (parsed.cues > 0) return parsed;
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
        {
          status: 405,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const body = await req.json();
    const { url, save } = body;

    if (!url || typeof url !== "string") {
      return new Response(
        JSON.stringify({ error: "URL is required" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    if (!url.includes("msn.com")) {
      return new Response(
        JSON.stringify({ error: "Only MSN video URLs are supported" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // Extract locale (e.g. "en-us") from URL path
    const localeMatch = url.match(/msn\.com\/([a-z]{2}-[a-z]{2})\//i);
    const locale = localeMatch ? localeMatch[1].toLowerCase() : "en-us";
    const videoId = extractVideoId(url);

    if (!videoId) {
      return new Response(
        JSON.stringify({
          success: false,
          error:
            "Could not find a video ID in that URL. Please use a full MSN video page URL (containing /vi-AA.../).",
        }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const content = await fetchMsnContent(videoId, locale);

    if (!content) {
      return new Response(
        JSON.stringify({
          success: false,
          error:
            "Could not reach the MSN video API for this video. It may have been removed or the URL may be incorrect.",
        }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const title = content.title || null;
    const durationSeconds = content.videoMetadata?.playTime ?? null;

    // Preferred: real closed-caption file with timestamps
    let text = "";
    let timestamped = "";
    let cueCount = 0;
    let trackLabel = "";

    const captions = content.videoMetadata?.closedCaptions || [];
    // Prefer caption matching page locale, fall back to first available
    const preferred =
      captions.find((c) => c.locale.toLowerCase() === locale) ??
      captions[0];

    if (preferred) {
      const parsed = await fetchCaptions(preferred.href);
      if (parsed) {
        text = parsed.text;
        timestamped = parsed.timestamped;
        cueCount = parsed.cues;
        trackLabel = preferred.locale;
      }
    }

    // Fallback: transcript embedded in the API body field
    if (cueCount === 0 && content.body) {
      text = content.body.trim();
      timestamped = "";
      cueCount = text.split(/[.!?]\s/).filter(Boolean).length;
      trackLabel = "transcript";
    }

    if (cueCount === 0 || !text) {
      return new Response(
        JSON.stringify({
          success: false,
          error:
            "This video has no closed captions or transcript available.",
        }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    let savedRecord = null;
    if (save) {
      const { data, error } = await supabase
        .from("transcripts")
        .insert({
          video_url: url,
          video_id: videoId,
          title,
          transcript_text: text,
          transcript_timestamped: timestamped || null,
          cue_count: cueCount,
          duration_seconds: durationSeconds,
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
        title,
        videoId,
        transcript: text,
        timestamped,
        cueCount,
        trackLabel,
        durationSeconds,
        saved: !!savedRecord,
        record: savedRecord,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err.message }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
