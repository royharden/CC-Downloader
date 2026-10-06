/**
 * Content script that runs on MSN video pages.
 * Captions on MSN videos are loaded dynamically via the HTML5 <track> element
 * or through the TextTracks API on the <video> element. This script watches for
 * video elements and their text tracks, then extracts all available cues.
 */

(function () {
  'use strict';

  /**
   * Extract transcript text from a video element's text tracks.
   * @param {HTMLVideoElement} video
   * @returns {{text: string, cues: number, trackLabel: string} | null}
   */
  function extractFromVideo(video) {
    if (!video || !video.textTracks || video.textTracks.length === 0) {
      return null;
    }

    // Enable all text tracks so cues become available
    for (let i = 0; i < video.textTracks.length; i++) {
      const track = video.textTracks[i];
      if (track.mode !== 'showing') {
        track.mode = 'hidden'; // hidden mode still loads cues
      }
    }

    // Try to find a captions or subtitles track
    let bestTrack = null;
    for (let i = 0; i < video.textTracks.length; i++) {
      const t = video.textTracks[i];
      if (t.kind === 'captions' || t.kind === 'subtitles') {
        bestTrack = t;
        break;
      }
    }
    if (!bestTrack) bestTrack = video.textTracks[0];

    const cues = bestTrack.cues;
    if (!cues || cues.length === 0) {
      return null;
    }

    let fullText = '';
    let cueCount = 0;
    for (let i = 0; i < cues.length; i++) {
      const cue = cues[i];
      if (cue.text) {
        fullText += cue.text.replace(/<[^>]*>/g, '').trim() + '\n';
        cueCount++;
      }
    }

    if (cueCount === 0) return null;

    return {
      text: fullText.trim(),
      cues: cueCount,
      trackLabel: bestTrack.label || bestTrack.language || 'unknown',
    };
  }

  /**
   * Also try fetching VTT files directly from <track> src attributes.
   * @param {HTMLVideoElement} video
   * @returns {Promise<{text: string, cues: number, trackLabel: string} | null>}
   */
  async function extractFromTrackSrc(video) {
    const trackElements = video.querySelectorAll('track');
    for (const trackEl of trackElements) {
      const src = trackEl.src;
      if (!src) continue;
      if (trackEl.kind && trackEl.kind !== 'captions' && trackEl.kind !== 'subtitles') continue;
      try {
        const resp = await fetch(src);
        if (!resp.ok) continue;
        const vttText = await resp.text();
        const parsed = parseVTT(vttText);
        if (parsed.cues > 0) {
          return {
            text: parsed.text,
            cues: parsed.cues,
            trackLabel: trackEl.label || trackEl.srclang || 'unknown',
          };
        }
      } catch (e) {
        // CORS or network error, skip
      }
    }
    return null;
  }

  /**
   * Parse WebVTT file content into plain text.
   * @param {string} vtt
   * @returns {{text: string, cues: number}}
   */
  function parseVTT(vtt) {
    const lines = vtt.split('\n');
    let text = '';
    let cueCount = 0;
    let inCue = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      // Skip header
      if (line.startsWith('WEBVTT')) continue;
      // Skip metadata lines
      if (line.startsWith('NOTE')) continue;
      // Skip timestamp lines (cue identifiers or time ranges)
      if (line.match(/^\d{2}:\d{2}/) || line.match(/^\d+$/)) {
        inCue = true;
        continue;
      }
      // Skip empty lines (cue separators)
      if (line === '') {
        inCue = false;
        continue;
      }
      if (inCue) {
        // Strip HTML tags from cue text
        const clean = line.replace(/<[^>]*>/g, '').trim();
        if (clean) {
          // Avoid duplicate consecutive lines
          if (!text.endsWith(clean + '\n')) {
            text += clean + '\n';
          }
          cueCount++;
        }
      }
    }

    return { text: text.trim(), cues: cueCount };
  }

  /**
   * Also try extracting TTML/DFXP format if present.
   * @param {string} xml
   * @returns {{text: string, cues: number}}
   */
  function parseTTML(xml) {
    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(xml, 'text/xml');
      const textEls = doc.getElementsByTagName('p');
      let text = '';
      let cueCount = 0;
      for (let i = 0; i < textEls.length; i++) {
        const clean = textEls[i].textContent.replace(/<[^>]*>/g, '').trim();
        if (clean) {
          text += clean + '\n';
          cueCount++;
        }
      }
      return { text: text.trim(), cues: cueCount };
    } catch (e) {
      return { text: '', cues: 0 };
    }
  }

  /**
   * Find all video elements on the page and try to extract captions.
   * @returns {Promise<{text: string, cues: number, trackLabel: string} | null>}
   */
  async function extractTranscript() {
    const videos = document.querySelectorAll('video');
    if (videos.length === 0) {
      return null;
    }

    for (const video of videos) {
      // Method 1: Try TextTracks API
      const fromTracks = extractFromVideo(video);
      if (fromTracks && fromTracks.cues > 0) {
        return fromTracks;
      }

      // Method 2: Try fetching VTT from <track> src
      const fromSrc = await extractFromTrackSrc(video);
      if (fromSrc && fromSrc.cues > 0) {
        return fromSrc;
      }
    }

    return null;
  }

  /**
   * Get the video page title.
   * @returns {string}
   */
  function getPageTitle() {
    const ogTitle = document.querySelector('meta[property="og:title"]');
    if (ogTitle && ogTitle.content) return ogTitle.content;
    return document.title || '';
  }

  /**
   * Extract video ID from MSN URL.
   * @returns {string | null}
   */
  function getVideoId() {
    const match = window.location.href.match(/\/vi-([A-Za-z0-9]+)/);
    return match ? match[1] : null;
  }

  // Listen for messages from popup/background
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'extractTranscript') {
      extractTranscript().then((result) => {
        if (result) {
          sendResponse({
            success: true,
            transcript: result.text,
            cueCount: result.cues,
            trackLabel: result.trackLabel,
            title: getPageTitle(),
            videoId: getVideoId(),
            url: window.location.href,
          });
        } else {
          sendResponse({
            success: false,
            error: 'No captions or subtitles were found on this video. The video may not have closed captions enabled, or captions may load after playback starts. Try playing the video briefly and then clicking Extract again.',
          });
        }
      });
      return true; // async response
    }
  });

  // Also watch for dynamically added video elements (MSN loads videos async)
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeName === 'VIDEO' || (node.querySelectorAll && node.querySelectorAll('video').length > 0)) {
          // Video element found, but we don't auto-extract; wait for popup request
          break;
        }
      }
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
})();
