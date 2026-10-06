/**
 * Popup script for the extension.
 * Handles UI interactions and communicates with content script + background.
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

  // Web app dashboard URL — update this to your deployed app URL
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

  function hideStatus() {
    statusEl.className = 'status';
    statusEl.innerHTML = '';
  }

  extractBtn.addEventListener('click', async () => {
    extractBtn.disabled = true;
    showStatus('Extracting captions from video...', 'loading');
    transcriptBox.classList.remove('show');
    actionRow.style.display = 'none';

    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

      if (!tab || !tab.url || !tab.url.includes('msn.com')) {
        showStatus('Please navigate to an MSN video page first.', 'error');
        extractBtn.disabled = false;
        return;
      }

      chrome.tabs.sendMessage(tab.id, { action: 'extractTranscript' }, (response) => {
        if (chrome.runtime.lastError) {
          showStatus('Could not connect to the page. Try refreshing the MSN video page and click Extract again.', 'error');
          extractBtn.disabled = false;
          return;
        }

        if (response && response.success) {
          currentTranscript = response;
          transcriptText.textContent = response.transcript;
          videoTitle.textContent = response.title || 'Untitled video';
          cueBadge.textContent = response.cueCount + ' cues';
          transcriptBox.classList.add('show');
          actionRow.style.display = 'flex';
          showStatus('Transcript extracted successfully! You can copy, download, or save it.', 'success');
        } else {
          showStatus(response && response.error
            ? response.error
            : 'No captions found on this page.', 'error');
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
    const title = (currentTranscript.title || 'transcript').replace(/[^a-z0-9]/gi, '_').toLowerCase();
    const blob = new Blob([currentTranscript.transcript], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = title + '.txt';
    a.click();
    URL.revokeObjectURL(url);
    showStatus('Transcript downloaded!', 'success');
  });

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
          cueCount: currentTranscript.cueCount,
          source: 'extension',
        },
      },
      (response) => {
        saveBtn.disabled = false;
        if (response && response.success) {
          showStatus('Saved to cloud! You can view it in the dashboard.', 'success');
        } else {
          showStatus('Failed to save: ' + (response && response.error ? response.error : 'Unknown error'), 'error');
        }
      }
    );
  });
})();
