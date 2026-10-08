import type { Cue } from '@/lib/supabase';

function pad(n: number, width: number): string {
  return String(n).padStart(width, '0');
}

function srtTime(seconds: number): string {
  const ms = Math.round((seconds % 1) * 1000);
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${pad(h, 2)}:${pad(m, 2)}:${pad(s, 2)},${pad(ms, 3)}`;
}

function vttTime(seconds: number): string {
  return srtTime(seconds).replace(',', '.');
}

export function toSRT(cues: Cue[]): string {
  return (
    cues
      .map(
        (cue, i) =>
          `${i + 1}\n${srtTime(cue.start)} --> ${srtTime(cue.end)}\n${cue.text}\n`,
      )
      .join('\n') + '\n'
  );
}

export function toVTT(cues: Cue[]): string {
  return (
    'WEBVTT\n\n' +
    cues
      .map(
        (cue, i) =>
          `${i + 1}\n${vttTime(cue.start)} --> ${vttTime(cue.end)}\n${cue.text}\n`,
      )
      .join('\n') +
    '\n'
  );
}

export function downloadFile(
  content: string,
  filename: string,
  mime: string,
): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function safeFilename(title: string | null): string {
  return (title || 'transcript')
    .replace(/[^a-z0-9]/gi, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .toLowerCase();
}
