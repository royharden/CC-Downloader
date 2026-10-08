/**
 * Content script that runs on MSN and YouTube video pages.
 *
 * MSN: page state / content API exposes videoMetadata.closedCaptions
 * (TTML file) plus a full transcript in the `body` field.
 *
 * YouTube: the watch page's ytInitialPlayerResponse contains captionTracks
 * with timedtext URLs; json3 format gives per-word timing. We also watch the
 * player's <track> elements and live TextTracks as fallbacks.
 */

(function () {
  'use strict';

  const CONTENT_API = 'https://assets.msn.com/content/view/v2/detail';
  const UA = navigator.userAgent;

  function extractMsnVideoId() {
    const match = window.location.href.match(/\/v[pi]-([A-Za-z0-9]+)/);
    return match ? match[1] : null;
  }

  function extractYouTubeId() {
    if (window.location.hostname.includes('youtu.be')) {
      return window.location.pathname.slice(1, 12) || null;
    }
    const url = new URL(window.location.href);
    const v = url.searchParams.get('v');
    if (v && v.length === 11) return v;
    if (url.pathname.startsWith('/shorts/')) {
      return url.pathname.slice(8, 19) || null;
    }
    return null;
  }

  function extractLocale() {
    const m = window.location.pathname.match(/^\/([a-z]{2}-[a-z]{2})\//i);
    return m ? m[1].toLowerCase() : 'en-us';
  }

  function unescapeXmlEntities(s) {
    return s
      .replace(/&amp;/g, '&')
      .replace(/&#39;/g, "'")
      .replace(/&apos;/g, "'")
      .replace(/&quot;/g, '"')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>');
  }

  function stripTags(s) {
    return s.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]*>/g, '');
  }

  function tsToSeconds(ts) {
    const parts = ts.split(':').map(parseFloat);
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    return parts[0] || 0;
  }

  function parseTTML(xml) {
    const cues = [];
    const cueRegex = /<p\b[^>]*\bbegin="([^"]*)"[^>]*?(?:\bend="([^"]*)")?[^>]*>([\s\S]*?)<\/p\s*>/gi;
    let match;
    while ((match = cueRegex.exec(xml)) !== null) {
      const raw = stripTags(match[3]).replace(/\s+/g, ' ').trim();
      if (!raw) continue;
      const start = tsToSeconds(match[1]);
      const end = match[2] ? tsToSeconds(match[2]) : start + 3;
      cues.push({ start, end, text: unescapeXmlEntities(raw) });
    }
    return cues;
  }

  function parseJson3(json) {
    const cues = [];
    for (const ev of json.events || []) {
      if (ev.tStartMs === undefined) continue;
      const text = (ev.segs || []).map((s) => s.utf8 || '').join('').replace(/\n/g, ' ').trim();
      if (!text) continue;
      cues.push({
        start: ev.tStartMs / 1000,
        end: (ev.tStartMs + (ev.dDurationMs || 3000)) / 1000,
        text,
      });
    }
    return cues;
  }

  function parseSrv3(xml) {
    const cues = [];
    const regex = /<text\b[^>]*\bstart="([\d.]+)"[^>]*?(?:\bdur="([\d.]+)")?[^>]*>([\s\S]*?)<\/text>/gi;
    let match;
    while ((match = regex.exec(xml)) !== null) {
      const raw = unescapeXmlEntities(stripTags(match[3])).replace(/\s+/g, ' ').trim();
      if (!raw) continue;
      const start = parseFloat(match[1]);
      const dur = match[2] ? parseFloat(match[2]) : 3;
      cues.push({ start, end: start + dur, text: raw });
    }
    return cues;
  }

  /**
   * YouTube: pull caption track URLs from the page's player response.
   */
  function getYtPlayerResponse() {
    try {
      if (window.ytInitialPlayerResponse?.captions) {
        return window.ytInitialPlayerResponse;
      }
    } catch (e) { /* cross-realm access */ }
    // The page embeds the player response JSON twice; scrape it from HTML
    const scripts = document.querySelectorAll('script');
    for (const script of scripts) {
      const text = script.textContent || '';
      const idx = text.indexOf('"captionTracks":');
      if (idx === -1) continue;
      const start = text.lastIndexOf('{', text.indexOf('"playerCaptionsTracklistRenderer"') !== -1
        ? text.indexOf('"playerCaptionsTracklistRenderer"')
        : idx);
      // Simpler: extract from ytInitialPlayerResponse assignment
      const m = text.match(/ytInitialPlayerResponse\s*=\s*(\{[\s\S]*?\});\s*(?:var|<\/script>)/);
      if (m) {
        try { return JSON.parse(m[1]); } catch (e) { /* fall through */ }
      }
    }
    return null;
  }

  async function extractYouTube() {
    const videoId = extractYouTubeId();
    if (!videoId) {
      return { success: false, error: 'Could not find a YouTube video ID in this URL.' };
    }

    let player = getYtPlayerResponse();
    let title = document.title.replace(/ - YouTube$/, '') || null;

    // Player response may not be reachable cross-realm; re-fetch page as fallback
    let tracks = [];
    if (player?.captions?.playerCaptionsTracklistRenderer?.captionTracks) {
      tracks = player.captions.playerCaptionsTracklistRenderer.captionTracks;
    } else {
      try {
        const resp = await fetch(
          `https://www.youtube.com/watch?v=${videoId}&hl=en`,
          { credentials: 'include' }
        );
        const html = await resp.text();
        const m = html.match(/"captionTracks":(\[.*?\])/s);
        if (m) tracks = JSON.parse(m[1]);
      } catch (e) { /* ignore */ }
    }

    if (!tracks.length) {
      return {
        success: false,
        error: 'No captions found for this YouTube video. The uploader may not have added captions.',
      };
    }

    // Prefer manual English captions over auto-generated, then any English
    const manual = tracks.filter((t) => t.kind !== 'asr');
    const track =
      manual.find((t) => t.languageCode?.startsWith('en')) ||
      tracks.find((t) => t.languageCode?.startsWith('en') && t.kind !== 'asr') ||
      manual[0] ||
      tracks[0];

    for (const fmt of ['&fmt=json3', '']) {
      try {
        const cr = await fetch(track.baseUrl + fmt, { credentials: 'include' });
        if (!cr.ok) continue;
        const body = await cr.text();
        const cues = fmt ? parseJson3(JSON.parse(body)) : parseSrv3(body);
        if (cues.length > 0) {
          return {
            success: true,
            platform: 'youtube',
            videoId,
            title,
            trackLabel: track.languageCode || 'youtube',
            cues,
            url: window.location.href,
          };
        }
      } catch (e) { /* try next format */ }
    }

    return { success: false, error: 'Found a caption track but could not download it. Try reloading the page.' };
  }

  /**
   * MSN: page state first, then content API.
   */
  function readFromPageState() {
    try {
      const state = window.__PRENDERED_STATE__;
      if (!state) return null;
      const candidates = [];
      const dive = (obj, depth) => {
        if (!obj || typeof obj !== 'object' || depth > 6) return;
        if (obj.videoMetadata && (obj.videoMetadata.closedCaptions || obj.body)) {
          candidates.push(obj);
          return;
        }
        for (const key of Object.keys(obj)) {
          dive(obj[key], depth + 1);
        }
      };
      dive(state, 0);
      return candidates[0] || null;
    } catch (e) {
      return null;
    }
  }

  async function fetchContent(videoId, locale) {
    const urls = [
      `${CONTENT_API}/${locale}/${videoId}`,
      `${CONTENT_API}/${locale}/vi-${videoId}`,
      `${CONTENT_API}/${locale}/vp-${videoId}`,
    ];
    for (const u of urls) {
      try {
        const resp = await fetch(u, { headers: { Accept: 'application/json' } });
        if (!resp.ok) continue;
        const data = await resp.json();
        if (data && (data.videoMetadata || data.body)) return data;
      } catch (e) { /* try next */ }
    }
    return null;
  }

  async function extractMsn() {
    const videoId = extractMsnVideoId();
    if (!videoId) {
      return {
        success: false,
        error: 'No video ID found in this page URL. Please use a full MSN video page URL.',
      };
    }
    const locale = extractLocale();

    let content = readFromPageState();
    if (!content) {
      content = await fetchContent(videoId, locale);
    }
    if (!content) {
      return {
        success: false,
        error: 'Could not reach the MSN video API for this video. It may have been removed.',
      };
    }

    const title =
      (content.title || document.title.replace(/ \| Microsoft Network.*$/i, '') || '').trim() || null;
    const durationSeconds = content.videoMetadata?.playTime ?? null;

    let cues = [];
    let trackLabel = '';

    const captions = content.videoMetadata?.closedCaptions || [];
    const preferred =
      captions.find((c) => (c.locale || '').toLowerCase() === locale) || captions[0];

    if (preferred && preferred.href) {
      try {
        const resp = await fetch(preferred.href);
        if (resp.ok) {
          const xml = await resp.text();
          cues = parseTTML(xml);
          trackLabel = preferred.locale || 'captions';
        }
      } catch (e) { /* fall through to body transcript */ }
    }

    // Fallback: transcript in the body field (no timing)
    if (cues.length === 0 && content.body) {
      const text = content.body.trim();
      const sentences = text.split(/(?<=[.!?])\s+/).filter(Boolean);
      let t = 0;
      cues = sentences.map((s) => {
        const cue = { start: t, end: t + 4, text: s };
        t += 4;
        return cue;
      });
      trackLabel = 'transcript';
    }

    if (cues.length === 0) {
      return { success: false, error: 'This video has no closed captions or transcript available.' };
    }

    return {
      success: true,
      platform: 'msn',
      videoId,
      title,
      trackLabel,
      durationSeconds,
      cues,
      url: window.location.href,
    };
  }

  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'extractTranscript') {
      const isYouTube =
        window.location.hostname.includes('youtube.com') ||
        window.location.hostname.includes('youtu.be');
      const task = isYouTube ? extractYouTube() : extractMsn();
      task.then(sendResponse);
      return true; // async response
    }
  });
})();
