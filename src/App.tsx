import { useState, useEffect, useCallback } from 'react';
import { supabase, type Transcript } from '@/lib/supabase';
import { fetchTranscriptFromUrl } from '@/lib/fetchTranscript';
import {
  FileText,
  Search,
  Copy,
  Download,
  Trash2,
  ExternalLink,
  Clock,
  Captions,
  RefreshCw,
  Video,
  Link2,
  Loader2,
} from 'lucide-react';

export default function App() {
  const [transcripts, setTranscripts] = useState<Transcript[]>([]);
  const [selected, setSelected] = useState<Transcript | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [copied, setCopied] = useState(false);
  const [urlInput, setUrlInput] = useState('');
  const [urlFetching, setUrlFetching] = useState(false);
  const [urlMessage, setUrlMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [showTimestamps, setShowTimestamps] = useState(false);

  const fetchTranscripts = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error } = await supabase
      .from('transcripts')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(100);

    if (error) {
      setError('Failed to load transcripts. Please try again.');
      setLoading(false);
      return;
    }

    setTranscripts((data as Transcript[]) || []);
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchTranscripts();
  }, [fetchTranscripts]);

  const handleCopy = async (text: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = (transcript: Transcript) => {
    const title = (transcript.title || 'transcript')
      .replace(/[^a-z0-9]/gi, '_')
      .toLowerCase();
    const blob = new Blob([transcript.transcript_text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = title + '.txt';
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleDelete = async (id: string) => {
    const { error } = await supabase.from('transcripts').delete().eq('id', id);
    if (error) {
      setError('Failed to delete transcript.');
      return;
    }
    setTranscripts((prev) => prev.filter((t) => t.id !== id));
    if (selected?.id === id) setSelected(null);
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  };

  const filtered = transcripts.filter((t) => {
    const q = searchQuery.toLowerCase();
    return (
      t.title?.toLowerCase().includes(q) ||
      t.transcript_text.toLowerCase().includes(q) ||
      t.video_url.toLowerCase().includes(q)
    );
  });

  const wordCount = (text: string) =>
    text.split(/\s+/).filter(Boolean).length;

  const formatDuration = (seconds: number | null) => {
    if (!seconds) return null;
    const mm = Math.floor(seconds / 60);
    const ss = seconds % 60;
    const hh = Math.floor(mm / 60);
    if (hh > 0) {
      return `${hh}:${String(mm % 60).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
    }
    return `${mm}:${String(ss).padStart(2, '0')}`;
  };

  const handleFetchFromUrl = async () => {
    if (!urlInput.trim()) return;
    if (!urlInput.includes('msn.com')) {
      setUrlMessage({ type: 'error', text: 'Please enter an MSN video URL.' });
      return;
    }
    setUrlFetching(true);
    setUrlMessage(null);
    try {
      const result = await fetchTranscriptFromUrl(urlInput.trim(), true);
      if (result.success) {
        setUrlMessage({
          type: 'success',
          text: `Extracted ${result.cueCount} captions${result.trackLabel ? ' (' + result.trackLabel + ')' : ''} and saved to your library.`,
        });
        setUrlInput('');
        fetchTranscripts();
      } else {
        setUrlMessage({
          type: 'error',
          text: result.error || 'No captions found for this video.',
        });
      }
    } catch (err) {
      setUrlMessage({
        type: 'error',
        text: 'Failed to fetch transcript. Please try the browser extension instead.',
      });
    }
    setUrlFetching(false);
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      {/* Header */}
      <header className="border-b border-slate-800 bg-slate-900/80 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-sky-500 to-sky-700 flex items-center justify-center">
              <Captions className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-lg font-semibold text-white">
                MSN Transcript Extractor
              </h1>
              <p className="text-xs text-slate-400">
                Video caption transcripts from MSN
              </p>
            </div>
          </div>
          <button
            onClick={fetchTranscripts}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white text-sm font-medium transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {/* URL fetch section */}
        <div className="mb-6 p-5 rounded-xl bg-slate-900 border border-slate-800">
          <div className="flex items-center gap-2 mb-3">
            <Link2 className="w-4 h-4 text-sky-400" />
            <h2 className="text-sm font-semibold text-slate-200">
              Extract from MSN video URL
            </h2>
          </div>
          <div className="flex gap-3">
            <input
              type="url"
              placeholder="Paste an MSN video URL (e.g. https://www.msn.com/en-us/.../vi-...)"
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && !urlFetching && handleFetchFromUrl()}
              className="flex-1 px-4 py-2.5 bg-slate-950 border border-slate-700 rounded-lg text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-transparent transition-all"
            />
            <button
              onClick={handleFetchFromUrl}
              disabled={urlFetching || !urlInput.trim()}
              className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-gradient-to-r from-sky-500 to-sky-700 hover:from-sky-400 hover:to-sky-600 text-white text-sm font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed flex-shrink-0"
            >
              {urlFetching ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Fetching...
                </>
              ) : (
                <>
                  <Captions className="w-4 h-4" />
                  Extract
                </>
              )}
            </button>
          </div>
          {urlMessage && (
            <div
              className={`mt-3 p-3 rounded-lg text-sm flex items-start gap-2 ${
                urlMessage.type === 'success'
                  ? 'bg-green-500/10 border border-green-500/30 text-green-400'
                  : 'bg-red-500/10 border border-red-500/30 text-red-400'
              }`}
            >
              {urlMessage.text}
            </div>
          )}
        </div>

        {/* Search bar */}
        <div className="relative mb-6">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-500" />
          <input
            type="text"
            placeholder="Search transcripts by title, content, or URL..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-3 bg-slate-900 border border-slate-700 rounded-xl text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-transparent transition-all"
          />
        </div>

        {error && (
          <div className="mb-6 p-4 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400 text-sm">
            {error}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
          {/* Transcript list */}
          <div className="lg:col-span-2 space-y-3">
            {loading && transcripts.length === 0 ? (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => (
                  <div
                    key={i}
                    className="p-4 rounded-xl bg-slate-900 border border-slate-800 animate-pulse"
                  >
                    <div className="h-4 bg-slate-800 rounded w-3/4 mb-2" />
                    <div className="h-3 bg-slate-800 rounded w-1/2" />
                  </div>
                ))}
              </div>
            ) : filtered.length === 0 ? (
              <div className="p-12 rounded-xl bg-slate-900 border border-slate-800 text-center">
                <FileText className="w-12 h-12 text-slate-700 mx-auto mb-4" />
                <p className="text-slate-400 font-medium mb-1">
                  {transcripts.length === 0
                    ? 'No transcripts yet'
                    : 'No matches found'}
                </p>
                <p className="text-sm text-slate-500">
                  {transcripts.length === 0
                    ? 'Use the browser extension to extract captions from MSN videos. They will appear here.'
                    : 'Try a different search term.'}
                </p>
              </div>
            ) : (
              filtered.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setSelected(t)}
                  className={`w-full text-left p-4 rounded-xl border transition-all ${
                    selected?.id === t.id
                      ? 'bg-sky-500/10 border-sky-500/50'
                      : 'bg-slate-900 border-slate-800 hover:border-slate-700'
                  }`}
                >
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <h3 className="font-medium text-slate-100 text-sm line-clamp-2 flex-1">
                      {t.title || 'Untitled video'}
                    </h3>
                    <span className="flex-shrink-0 text-xs px-2 py-0.5 rounded-md bg-slate-800 text-slate-400">
                      {t.cue_count} cues
                    </span>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-slate-500">
                    <span className="flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {formatDate(t.created_at)}
                    </span>
                    <span className="flex items-center gap-1">
                      <FileText className="w-3 h-3" />
                      {wordCount(t.transcript_text)} words
                    </span>
                    {t.source === 'extension' && (
                      <span className="flex items-center gap-1 text-sky-400">
                        <Video className="w-3 h-3" />
                        Extension
                      </span>
                    )}
                  </div>
                </button>
              ))
            )}
          </div>

          {/* Detail panel */}
          <div className="lg:col-span-3">
            {selected ? (
              <div className="rounded-xl bg-slate-900 border border-slate-800 overflow-hidden">
                {/* Detail header */}
                <div className="p-5 border-b border-slate-800">
                  <div className="flex items-start justify-between gap-4 mb-4">
                    <h2 className="text-lg font-semibold text-white flex-1">
                      {selected.title || 'Untitled video'}
                    </h2>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <button
                        onClick={() => handleCopy(selected.transcript_text)}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white text-xs font-medium transition-colors"
                      >
                        {copied ? (
                          <>
                            <span className="text-green-400">Copied!</span>
                          </>
                        ) : (
                          <>
                            <Copy className="w-3.5 h-3.5" />
                            Copy
                          </>
                        )}
                      </button>
                      <button
                        onClick={() => handleDownload(selected)}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white text-xs font-medium transition-colors"
                      >
                        <Download className="w-3.5 h-3.5" />
                        Download
                      </button>
                      <button
                        onClick={() => handleDelete(selected.id)}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-400 text-xs font-medium transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        Delete
                      </button>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-4 text-xs text-slate-400">
                    <a
                      href={selected.video_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1.5 text-sky-400 hover:text-sky-300 transition-colors"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                      Open original video
                    </a>
                    <span className="flex items-center gap-1.5">
                      <Clock className="w-3.5 h-3.5" />
                      {formatDate(selected.created_at)}
                    </span>
                    <span className="flex items-center gap-1.5">
                      <FileText className="w-3.5 h-3.5" />
                      {selected.cue_count} cues
                    </span>
                    <span>{wordCount(selected.transcript_text)} words</span>
                    {formatDuration(selected.duration_seconds) && (
                      <span>{formatDuration(selected.duration_seconds)} long</span>
                    )}
                  </div>
                </div>

                {/* Timestamp toggle */}
                {selected.transcript_timestamped && (
                  <div className="px-5 py-3 border-b border-slate-800 flex items-center justify-between">
                    <span className="text-xs text-slate-500">
                      {showTimestamps ? 'Showing timestamps' : 'Plain text'}
                    </span>
                    <button
                      onClick={() => setShowTimestamps(!showTimestamps)}
                      className={`flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-medium transition-colors ${
                        showTimestamps
                          ? 'bg-sky-500/20 text-sky-300'
                          : 'bg-slate-800 text-slate-400 hover:text-white'
                      }`}
                    >
                      <Clock className="w-3.5 h-3.5" />
                      {showTimestamps ? 'Hide timestamps' : 'Show timestamps'}
                    </button>
                  </div>
                )}

                {/* Transcript text */}
                <div className="p-5 max-h-[calc(100vh-320px)] overflow-y-auto">
                  <p className="text-sm text-slate-300 leading-relaxed whitespace-pre-wrap">
                    {showTimestamps && selected.transcript_timestamped
                      ? selected.transcript_timestamped
                      : selected.transcript_text}
                  </p>
                </div>
              </div>
            ) : (
              <div className="rounded-xl bg-slate-900 border border-slate-800 p-16 text-center">
                <div className="w-16 h-16 rounded-2xl bg-slate-800 flex items-center justify-center mx-auto mb-4">
                  <FileText className="w-8 h-8 text-slate-600" />
                </div>
                <p className="text-slate-400 font-medium mb-1">
                  Select a transcript to read
                </p>
                <p className="text-sm text-slate-500">
                  Choose one from the list, or extract a new one using the browser extension.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
