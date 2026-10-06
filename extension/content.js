/**
 * Content script that runs on MSN video pages.
 * MSN does not expose captions via the HTML5 <track> element or TextTracks API.
 * Instead, the page data (available at runtime in window.__PRENDERED_STATE__
 * or via the assets.msn.com content API) contains a videoMetadata.closedCaptions
 * link to a TTML caption file, plus a full transcript in the `body` field.
 */

(function () {
  'use strict';

  const CONTENT_API = 'https://assets.msn.com/content/view/v2/detail';

  function extractVideoId() {
    const match = window.location.href.match(/\/v[pi]-([A-Za-z0-9]+)/);
    return match ? match[1] : null;
  }

  function extractLocale() {
    const m = window.location.pathname.match(/^\/([a-z]{2}-[a-z]{2})\//i);
    return m ? m[1].toLowerCase() : 'en-us';
  }

  /**
   * Parse TTML caption XML into plain + timestamped text.
   */
  function parseTTML(xml) {
    const cues = [];
    const cueRegex = /<p\b[^>]*\bbegin="([^"]*)"[^>]*>([\s\S]*?)<\/p\s*>/gi;
    let match;
    while ((match = cueRegex.exec(xml)) !== null) {
      const raw = match[2]
        .replace(/<br\s*\/?>/gi, ' ')
        .replace(/<[^>]*>/g, '')
        .replace(/&amp;/g, '&')
        .replace(/&#39;/g, "'")
        .replace(/&quot;/g, '"')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/\s+/g, ' ')
        .trim();
      if (raw) cues.push({ begin: match[1], text: raw });
    }

    // Dedupe rolling-caption repeats for the plain transcript
    const seen = new Set();
    const lines = [];
    for (const cue of cues) {
      if (!seen.has(cue.text)) {
        seen.add(cue.text);
        lines.push(cue.text);
      }
    }

    const stampLines = cues.map((c) => `[${fmt(c.begin)}] ${c.text}`);
    return {
      text: lines.join('\n').trim(),
      timestamped: stampLines.join('\n').trim(),
      cues: cues.length,
    };
  }

  function fmt(ts) {
    const parts = ts.split(':').map(parseFloat);
    let s = 0;
    if (parts.length === 3) s = parts[0] * 3600 + parts[1] * 60 + parts[2];
    else if (parts.length === 2) s = parts[0] * 60 + parts[1];
    else if (parts.length === 1) s = parts[0];
    const total = Math.floor(s);
    return (
      String(Math.floor(total / 60)).padStart(2, '0') +
      ':' +
      String(total % 60).padStart(2, '0')
    );
  }

  /**
   * Try to read video data from the page's pre-rendered state,
   * which MSN embeds as window.__PRENDERED_STATE__ JSON.
   */
  function readFromPageState() {
    try {
      const state = window.__PRENDERED_STATE__;
      if (!state) return null;
      // MSN nests content under _data > ... > contentMap
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
    } catch {
      return null;
    }
  }

  /**
   * Fetch the content API for this video ID.
   */
  async function fetchContent(videoId, locale) {
    const urls = [
      `${CONTENT_API}/${locale}/${videoId}`,
      `${CONTENT_API}/${locale}/vi-${videoId}`,
      `${CONTENT_API}/${locale}/vp-${videoId}`,
    ];
    for (const u of urls) {
      try {
        const resp = await fetch(u, {
          headers: { Accept: 'application/json' },
        });
        if (!resp.ok) continue;
        const data = await resp.json();
        if (data && (data.videoMetadata || data.body)) return data;
      } catch (e) {
        // try next
      }
    }
    return null;
  }

  async function extractTranscript() {
    const videoId = extractVideoId();
    if (!videoId) {
      return {
        success: false,
        error: 'No video ID found in this page URL. Please use a full MSN video page URL.',
      };
    }
    const locale = extractLocale();

    // Preferred source: page state (no network needed, same-origin)
    let content = readFromPageState();
    if (!content) {
      content = await fetchContent(videoId, locale);
    }
    if (!content) {
      return {
        success: false,
        error:
          'Could not reach the MSN video API for this video. It may have been removed.',
      };
    }

    const title =
      content.title || document.title.replace(/ \| Microsoft Network.*$/i, '') || '';
    const durationSeconds = content.videoMetadata?.playTime ?? null;

    let text = '';
    let timestamped = '';
    let cueCount = 0;
    let trackLabel = '';

    // Preferred: real closed-caption TTML file with timestamps
    const captions = content.videoMetadata?.closedCaptions || [];
    const preferred =
      captions.find((c) => (c.locale || '').toLowerCase() === locale) || captions[0];

    if (preferred && preferred.href) {
      try {
        const resp = await fetch(preferred.href);
        if (resp.ok) {
          const xml = await resp.text();
          const parsed = parseTTML(xml);
          if (parsed.cues > 0) {
            text = parsed.text;
            timestamped = parsed.timestamped;
            cueCount = parsed.cues;
            trackLabel = preferred.locale || 'captions';
          }
        }
      } catch (e) {
        // fall through to body transcript
      }
    }

    // Fallback: transcript in the body field
    if (cueCount === 0 && content.body) {
      text = content.body.trim();
      cueCount = text.split(/[.!?]\s/).filter(Boolean).length;
      trackLabel = 'transcript';
    }

    if (cueCount === 0 || !text) {
      return {
        success: false,
        error: 'This video has no closed captions or transcript available.',
      };
    }

    return {
      success: true,
      transcript: text,
      timestamped,
      cueCount,
      trackLabel,
      title,
      durationSeconds,
      videoId,
      url: window.location.href,
    };
  }

  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'extractTranscript') {
      extractTranscript().then(sendResponse);
      return true; // async response
    }
  });
})();
