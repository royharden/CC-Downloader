/**
 * Popup script for the extension.
 * Handles UI interactions, format conversions, and backend communication.
 */

(function () {
  'use strict';

  const extractBtn = document.getElementById('extractBtn');
  const actionRow = document.getElementById('actionRow');
  const copyBtn = document.getElementById('copyBtn');
  const downloadBtn = document.getElementById('downloadBtn');
  const saveBtn = document.getElementById('saveBtn');
  const statusEl = document.getElementById('status');
  const transcriptBox = document.getElementById('transcriptBox');
  const transcriptText = document.getElementById('transcriptText');
  const videoTitle = document.getElementById('videoTitle');
  const cueBadge = document.getElementById('cueBadge');
  const dashboardLink = document.getElementById('dashboardLink');

  let currentTranscript = null;

  const DASHBOARD_URL = 'http://localhost:5173';

  dashboardLink.addEventListener('click', () => {
    chrome.tabs.create({ url: DASHBOARD_URL });
  });

  function showStatus(message, type) {
    statusEl.className = 'status show ' + type;
    if (type === 'loading') {
      statusEl.innerHTML = '<span class="spinner"></span>' + message;
    } else {
      statusEl.textContent = message;
    }
  }

  /**
   * Build the display + save payload from raw cues.
   */
  function buildPayload(resp) {
    const cues = resp.cues || [];
    const seen = new Set();
    const plainLines = [];
    for (const cue of cues) {
      if (!seen.has(cue.text)) {
        seen.add(cue.text);
        plainLines.push(cue.text);
      }
    }
    const timestamped = cues
      .map((c) => `[${fmtMmss(c.start)}] ${c.text}`)
      .join('\n');
    return {
      url: resp.url,
      platform: resp.platform,
      videoId: resp.videoId,
      title: resp.title,
      trackLabel: resp.trackLabel,
      durationSeconds: resp.durationSeconds ?? null,
      cueCount: cues.length,
      transcript: plainLines.join('\n'),
      timestamped,
      cueData: cues,
    };
  }

  function fmtMmss(seconds) {
    const total = Math.floor(seconds);
    const mm = Math.floor(total / 60);
    const ss = total % 60;
    return (
      String(mm).padStart(2, '0') + ':' + String(ss).padStart(2, '0')
    );
  }

  // ---- Subtitle file formats ----

  function pad(n, width) {
    return String(n).padStart(width, '0');
  }

  function srtTime(seconds) {
    const ms = Math.round((seconds % 1) * 1000);
    const total = Math.floor(seconds);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    return `${pad(h, 2)}:${pad(m, 2)}:${pad(s, 2)},${pad(ms, 3)}`;
  }

  function vttTime(seconds) {
    return srtTime(seconds).replace(',', '.');
  }

  function toSRT(cues) {
    return (
      cues
        .map((cue, i) => {
          return `${i + 1}\n${srtTime(cue.start)} --> ${srtTime(cue.end)}\n${cue.text}\n`;
        })
        .join('\n') + '\n'
    );
  }

  function toVTT(cues) {
    return (
      'WEBVTT\n\n' +
      cues
        .map((cue, i) => {
          return `${i + 1}\n${vttTime(cue.start)} --> ${vttTime(cue.end)}\n${cue.text}\n`;
        })
        .join('\n') +
      '\n'
    );
  }

  function downloadFile(content, filename, mime) {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  function safeName(title) {
    return (title || 'transcript')
      .replace(/[^a-z0-9]/gi, '_')
      .replace(/_+/g, '_')
      .replace(/^_|_$/g, '')
      .toLowerCase();
  }

  extractBtn.addEventListener('click', async () => {
    extractBtn.disabled = true;
    showStatus('Extracting captions from video...', 'loading');
    transcriptBox.classList.remove('show');
    actionRow.style.display = 'none';
    const fr = document.getElementById('formatRow');
    if (fr) fr.style.display = 'none';

    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

      if (!tab || !tab.url ||
          !(tab.url.includes('msn.com') || tab.url.includes('youtube.com') || tab.url.includes('youtu.be'))) {
        showStatus('Please navigate to an MSN or YouTube video page first.', 'error');
        extractBtn.disabled = false;
        return;
      }

      chrome.tabs.sendMessage(tab.id, { action: 'extractTranscript' }, (response) => {
        if (chrome.runtime.lastError) {
          showStatus(
            'Could not connect to the page. Refresh the video page and click Extract again.',
            'error'
          );
          extractBtn.disabled = false;
          return;
        }

        if (response && response.success) {
          currentTranscript = buildPayload(response);
          transcriptText.textContent = currentTranscript.transcript;
          videoTitle.textContent = currentTranscript.title || 'Untitled video';
          cueBadge.textContent = currentTranscript.cueCount + ' cues';
          transcriptBox.classList.add('show');
          actionRow.style.display = 'flex';
          document.getElementById('formatRow').style.display = 'flex';
          showStatus(
            'Transcript extracted! Copy, download as TXT/SRT/VTT, or save it.',
            'success'
          );
        } else {
          showStatus(
            response && response.error ? response.error : 'No captions found on this page.',
            'error'
          );
        }
        extractBtn.disabled = false;
      });
    } catch (err) {
      showStatus('Error: ' + err.message, 'error');
      extractBtn.disabled = false;
    }
  });

  copyBtn.addEventListener('click', () => {
    if (!currentTranscript) return;
    navigator.clipboard.writeText(currentTranscript.transcript).then(() => {
      showStatus('Transcript copied to clipboard!', 'success');
    }).catch(() => {
      showStatus('Failed to copy to clipboard.', 'error');
    });
  });

  downloadBtn.addEventListener('click', () => {
    if (!currentTranscript) return;
    const name = safeName(currentTranscript.title);
    downloadFile(currentTranscript.transcript, name + '.txt', 'text/plain');
    showStatus('Transcript downloaded as .txt!', 'success');
  });

  // SRT and VTT buttons (added in popup.html)
  const srtBtn = document.getElementById('srtBtn');
  const vttBtn = document.getElementById('vttBtn');

  if (srtBtn) {
    srtBtn.addEventListener('click', () => {
      if (!currentTranscript) return;
      const name = safeName(currentTranscript.title);
      downloadFile(
        toSRT(currentTranscript.cueData),
        name + '.srt',
        'application/x-subrip'
      );
      showStatus('SRT subtitle file downloaded!', 'success');
    });
  }

  if (vttBtn) {
    vttBtn.addEventListener('click', () => {
      if (!currentTranscript) return;
      const name = safeName(currentTranscript.title);
      downloadFile(
        toVTT(currentTranscript.cueData),
        name + '.vtt',
        'text/vtt'
      );
      showStatus('WebVTT subtitle file downloaded!', 'success');
    });
  }

  saveBtn.addEventListener('click', () => {
    if (!currentTranscript) return;
    saveBtn.disabled = true;
    showStatus('Saving to cloud...', 'loading');

    chrome.runtime.sendMessage(
      {
        action: 'saveToSupabase',
        data: {
          url: currentTranscript.url,
          videoId: currentTranscript.videoId,
          title: currentTranscript.title,
          transcript: currentTranscript.transcript,
          timestamped: currentTranscript.timestamped,
          cueData: currentTranscript.cueData,
          cueCount: currentTranscript.cueCount,
          durationSeconds: currentTranscript.durationSeconds,
          source: 'extension',
        },
      },
      (response) => {
        saveBtn.disabled = false;
        if (response && response.success) {
          showStatus('Saved to cloud! You can view it in the dashboard.', 'success');
        } else {
          showStatus(
            'Failed to save: ' + (response && response.error ? response.error : 'Unknown error'),
            'error'
          );
        }
      }
    );
  });
})();
