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

interface Cue {
  start: number;
  end: number;
  text: string;
}

interface MsnClosedCaption {
  locale: string;
  href: string;
}

interface MsnContent {
  title?: string;
  body?: string;
  videoMetadata?: {
    playTime?: number;
    closedCaptions?: MsnClosedCaption[];
  };
}

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

function extractVideoId(url: string): string | null {
  const msn = url.match(/\/v[pi]-([A-Za-z0-9]+)/);
  if (msn) return msn[1];
  const yt = url.match(
    /(?:youtube\.com\/(?:watch\?[^#]*v=|shorts\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/,
  );
  if (yt) return yt[1];
  return null;
}

function extractLocale(url: string): string {
  const m = url.match(/msn\.com\/([a-z]{2}-[a-z]{2})\//i);
  return m ? m[1].toLowerCase() : "en-us";
}

function isYouTubeUrl(url: string): boolean {
  return /(?:^|\.)youtube\.com|^youtu\.be/i.test(
    url.replace(/^https?:\/\//, "").split("/")[0],
  ) || url.includes("youtube.com") || url.includes("youtu.be");
}

function unescapeXmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function stripTags(s: string): string {
  return s.replace(/<br\s*\/?>/gi, " ").replace(/<[^>]*>/g, "");
}

/**
 * Parse MSN TTML caption XML into cues.
 */
function parseTTML(xml: string): Cue[] {
  const cues: Cue[] = [];
  const cueRegex = /<p\b[^>]*\bbegin="([^"]*)"[^>]*?(?:\bend="([^"]*)")?[^>]*>([\s\S]*?)<\/p\s*>/gi;
  let match: RegExpExecArray | null;
  while ((match = cueRegex.exec(xml)) !== null) {
    const raw = stripTags(match[3]).replace(/\s+/g, " ").trim();
    if (!raw) continue;
    const start = parseTimestampToSeconds(match[1]);
    const end = match[2] ? parseTimestampToSeconds(match[2]) : start + 3;
    cues.push({ start, end, text: unescapeXmlEntities(raw) });
  }
  return cues;
}

/**
 * Convert a timestamp string (00:00:03.840 / 03.840 / 00:03.840) to seconds.
 */
function parseTimestampToSeconds(ts: string): number {
  const parts = ts.split(":").map((p) => parseFloat(p));
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parts[0] || 0;
}

/**
 * Parse YouTube json3 caption format into cues.
 */
function parseJson3(json: { events?: { tStartMs?: number; dDurationMs?: number; segs?: { utf8?: string }[] }[] }): Cue[] {
  const cues: Cue[] = [];
  for (const ev of json.events || []) {
    if (ev.tStartMs === undefined) continue;
    const text = (ev.segs || []).map((s) => s.utf8 || "").join("").replace(/\n/g, " ").trim();
    if (!text) continue;
    cues.push({
      start: ev.tStartMs / 1000,
      end: (ev.tStartMs + (ev.dDurationMs || 3000)) / 1000,
      text,
    });
  }
  return cues;
}

/**
 * Parse YouTube srv3/xml caption format into cues (fallback).
 */
function parseSrv3(xml: string): Cue[] {
  const cues: Cue[] = [];
  const regex = /<text\b[^>]*\bstart="([\d.]+)"[^>]*?(?:\bdur="([\d.]+)")?[^>]*>([\s\S]*?)<\/text>/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(xml)) !== null) {
    const raw = unescapeXmlEntities(stripTags(match[3])).replace(/\s+/g, " ").trim();
    if (!raw) continue;
    const start = parseFloat(match[1]);
    const dur = match[2] ? parseFloat(match[2]) : 3;
    cues.push({ start, end: start + dur, text: raw });
  }
  return cues;
}

/**
 * Fetch and parse YouTube captions. Datacenter IPs are often blocked by
 * YouTube's bot detection; returns null so the caller can surface guidance.
 */
async function fetchYouTubeCues(
  videoId: string,
): Promise<{ cues: Cue[]; title: string | null } | null> {
  try {
    const resp = await fetch(
      `https://www.youtube.com/watch?v=${videoId}&hl=en`,
      {
        headers: {
          "User-Agent": UA,
          "Accept-Language": "en-US,en;q=0.9",
          "Cookie": "CONSENT=YES+cb.20210328-17-p0-0+FX+410; SOCS=CAI",
        },
      },
    );
    if (!resp.ok) return null;
    const html = await resp.text();
    const titleMatch = html.match(/<meta\s+name="title"\s+content="([^"]*)"/) ||
      html.match(/<title>([^<]*)<\/title>/);
    const title = titleMatch
      ? unescapeXmlEntities(titleMatch[1]).trim()
      : null;

    const tracksMatch = html.match(/"captionTracks":(\[.*?\])/s);
    if (!tracksMatch) return null;
    let tracks: { baseUrl: string; languageCode: string; kind?: string }[];
    try {
      tracks = JSON.parse(tracksMatch[1]);
    } catch {
      return null;
    }
    if (!tracks.length) return null;

    const track = tracks.find((t) => t.languageCode?.startsWith("en")) ||
      tracks[0];

    // Try json3 first (cleanest format), then raw XML as fallback
    for (const fmt of ["&fmt=json3", ""]) {
      try {
        const cr = await fetch(track.baseUrl + fmt, {
          headers: { "User-Agent": UA },
        });
        if (!cr.ok) continue;
        const body = await cr.text();
        const cues = fmt
          ? parseJson3(JSON.parse(body))
          : parseSrv3(body);
        if (cues.length > 0) return { cues, title };
      } catch {
        // try next format
      }
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Fetch the MSN content API for a video ID.
 */
async function fetchMsnContent(
  videoId: string,
  locale: string,
): Promise<MsnContent | null> {
  const urls = [
    `https://assets.msn.com/content/view/v2/detail/${locale}/AA${videoId.replace(/^AA/, "")}`,
    `https://assets.msn.com/content/view/v2/detail/${locale}/${videoId}`,
    `https://assets.msn.com/content/view/v2/detail/${locale}/vi-${videoId}`,
    `https://assets.msn.com/content/view/v2/detail/${locale}/vp-${videoId}`,
  ];
  for (const u of urls) {
    try {
      const resp = await fetch(u, {
        headers: { "Accept": "application/json", "User-Agent": UA },
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

async function fetchUrlText(url: string): Promise<string | null> {
  try {
    const resp = await fetch(url, { headers: { "User-Agent": UA } });
    if (!resp.ok) return null;
    return await resp.text();
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

    const youtube = isYouTubeUrl(url);
    if (!youtube && !url.includes("msn.com")) {
      return new Response(
        JSON.stringify({ error: "Only MSN and YouTube URLs are supported" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const videoId = extractVideoId(url);
    if (!videoId) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "Could not find a video ID in that URL.",
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    let cues: Cue[] = [];
    let title: string | null = null;
    let durationSeconds: number | null = null;
    let trackLabel = "";

    if (youtube) {
      const yt = await fetchYouTubeCues(videoId);
      if (yt) {
        cues = yt.cues;
        title = yt.title;
        trackLabel = "youtube";
      } else {
        return new Response(
          JSON.stringify({
            success: false,
            error:
              "YouTube blocked this request (bot detection) or the video has no captions. Use the browser extension on the YouTube page instead — it extracts captions directly in your browser.",
          }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
    } else {
      const locale = extractLocale(url);
      const content = await fetchMsnContent(videoId, locale);
      if (!content) {
        return new Response(
          JSON.stringify({
            success: false,
            error: "Could not reach the MSN video API for this video. It may have been removed.",
          }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      title = content.title || null;
      durationSeconds = content.videoMetadata?.playTime ?? null;

      const captions = content.videoMetadata?.closedCaptions || [];
      const preferred =
        captions.find((c) => c.locale.toLowerCase() === locale) ??
        captions[0];
      if (preferred) {
        const xml = await fetchUrlText(preferred.href);
        if (xml) {
          cues = parseTTML(xml);
          trackLabel = preferred.locale;
        }
      }

      // Fallback: transcript embedded in the API body field (no timing)
      if (cues.length === 0 && content.body) {
        const text = content.body.trim();
        const sentences = text.split(/(?<=[.!?])\s+/).filter(Boolean);
        let t = 0;
        cues = sentences.map((s) => {
          const cue = { start: t, end: t + 4, text: s };
          t += 4;
          return cue;
        });
        trackLabel = "transcript";
      }
    }

    if (cues.length === 0) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "This video has no closed captions or transcript available.",
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Derived formats
    const plainText = dedupeRolling(cues).map((c) => c.text).join("\n").trim();
    const timestamped = cues
      .map((c) => `[${fmtMmss(c.start)}] ${c.text}`)
      .join("\n");

    let savedRecord = null;
    if (save) {
      const { data, error } = await supabase
        .from("transcripts")
        .insert({
          video_url: url,
          video_id: videoId,
          title,
          transcript_text: plainText,
          transcript_timestamped: timestamped,
          cue_count: cues.length,
          duration_seconds: durationSeconds,
          cue_data: cues,
          source: "web",
        })
        .select()
        .single();
      if (!error) savedRecord = data;
    }

    return new Response(
      JSON.stringify({
        success: true,
        title,
        videoId,
        transcript: plainText,
        timestamped,
        cues: cues.length,
        cueCount: cues.length,
        cueData: cues,
        trackLabel,
        durationSeconds,
        saved: !!savedRecord,
        record: savedRecord,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});

function dedupeRolling(cues: Cue[]): Cue[] {
  const seen = new Set<string>();
  return cues.filter((c) => {
    if (seen.has(c.text)) return false;
    seen.add(c.text);
    return true;
  });
}

function fmtMmss(seconds: number): string {
  const total = Math.floor(seconds);
  const mm = Math.floor(total / 60);
  const ss = total % 60;
  return `${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
}
