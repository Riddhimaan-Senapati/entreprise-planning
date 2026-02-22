'use client';

import { useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  Upload, CheckCircle, AlertTriangle, X, FileText,
  Mail, Loader2, UserX, Clock, CheckCircle2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { triggerGmailScan } from '@/lib/api-client';
import type { TimeOffSyncResult, MemberOOOChange } from '@/lib/types';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000';

interface ProcessedResult {
  memberId: string;
  memberName: string;
  calendarPct?: number;
  status: 'ok' | 'error';
  detail?: string;
}

interface UploadResult {
  processed: ProcessedResult[];
  unmatched: string[];
}

// ── Gmail scan result row ──────────────────────────────────────────────────────

function OOOChangeRow({ change }: { change: MemberOOOChange }) {
  const dates = change.startDate
    ? `${change.startDate}${change.endDate ? ` → ${change.endDate}` : ' (open-ended)'}`
    : '—';

  return (
    <li className="flex items-start gap-3 px-4 py-3">
      {change.pending ? (
        <Clock className="w-4 h-4 text-status-amber flex-shrink-0 mt-0.5" />
      ) : (
        <UserX className="w-4 h-4 text-status-red flex-shrink-0 mt-0.5" />
      )}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-foreground">{change.memberName}</p>
        <p className="text-xs text-muted-foreground mt-0.5">
          {dates}
          {change.reason ? ` · ${change.reason}` : ''}
        </p>
      </div>
      <span
        className={cn(
          'flex-shrink-0 text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full',
          change.pending
            ? 'bg-status-amber/10 text-status-amber'
            : 'bg-status-red/10 text-status-red',
        )}
      >
        {change.pending ? 'Pending' : 'OOO Now'}
      </span>
    </li>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default function SettingsPage() {
  // ── ICS upload state ────────────────────────────────────────────────────────
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [results, setResults] = useState<UploadResult | null>(null);
  const [dragging, setDragging] = useState(false);

  function addFiles(incoming: FileList | null) {
    if (!incoming) return;
    const valid = Array.from(incoming).filter(
      (f) => f.name.endsWith('.ics') || f.name.endsWith('.zip')
    );
    setFiles((prev) => {
      const names = new Set(prev.map((f) => f.name));
      return [...prev, ...valid.filter((f) => !names.has(f.name))];
    });
    setResults(null);
  }

  function removeFile(name: string) {
    setFiles((prev) => prev.filter((f) => f.name !== name));
    setResults(null);
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    addFiles(e.dataTransfer.files);
  }

  async function handleUpload() {
    if (!files.length) return;
    setUploading(true);
    setResults(null);
    try {
      const form = new FormData();
      files.forEach((f) => form.append('files', f));
      const res = await fetch(`${API_URL}/calendar/upload`, {
        method: 'POST',
        body: form,
      });
      if (!res.ok) throw new Error(`Server error ${res.status}`);
      const data: UploadResult = await res.json();
      setResults(data);
      setFiles([]);
    } catch (err) {
      setResults({
        processed: [],
        unmatched: [],
        // @ts-expect-error quick error passthrough
        error: String(err),
      });
    } finally {
      setUploading(false);
    }
  }

  // ── Gmail scan state ────────────────────────────────────────────────────────
  const [scanning, setScanning] = useState(false);
  const [gmailResults, setGmailResults] = useState<TimeOffSyncResult | null>(null);
  const [gmailError, setGmailError] = useState<string | null>(null);

  async function handleGmailScan() {
    setScanning(true);
    setGmailResults(null);
    setGmailError(null);

    try {
      const result = await triggerGmailScan(100);
      setGmailResults(result);

      if (result.applied === 0) {
        toast.success('Gmail scan complete', {
          description: `Checked ${result.detected} email(s) — no new OOO signals found.`,
        });
      } else {
        // One toast per detected OOO member so managers see each alert individually
        result.changes.forEach((change) => {
          const dates = change.startDate
            ? `${change.startDate}${change.endDate ? ` → ${change.endDate}` : ''}`
            : 'dates unknown';
          toast(
            change.pending ? `${change.memberName} will be OOO` : `${change.memberName} is OOO`,
            {
              description: `${dates}${change.reason ? ` · ${change.reason}` : ''}`,
              icon: change.pending ? '🕐' : '🚫',
              duration: 10000,
            },
          );
        });
        toast.success('Gmail scan complete', {
          description: `${result.applied} member(s) updated · ${result.pending} pending · ${result.skipped} skipped`,
          duration: 6000,
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setGmailError(msg);
      toast.error('Gmail scan failed', { description: msg });
    } finally {
      setScanning(false);
    }
  }

  return (
    <div className="p-6 max-w-2xl mx-auto space-y-8">
      <div>
        <h1 className="text-xl font-heading font-bold text-foreground">Settings</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Admin controls and calendar management</p>
      </div>

      {/* ── Gmail OOO Scanner ─────────────────────────────────────────────── */}
      <section className="space-y-4">
        <div>
          <h2 className="text-base font-semibold text-foreground">Gmail OOO Scanner</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Scans up to 100 inbox emails for out-of-office signals using Gemini AI.
            Gmail pre-filters by OOO keywords so only relevant emails reach the AI.
            Detected members are updated immediately; future OOOs are held as pending
            and activate automatically on their start date.
          </p>
        </div>

        <button
          onClick={handleGmailScan}
          disabled={scanning}
          className={cn(
            'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors',
            scanning
              ? 'bg-bg-surface2 text-muted-foreground cursor-not-allowed'
              : 'bg-status-amber text-bg-base hover:opacity-90',
          )}
        >
          {scanning ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Mail className="w-4 h-4" />
          )}
          {scanning ? 'Scanning inbox…' : 'Scan Gmail for OOO'}
        </button>

        {/* Error */}
        {gmailError && (
          <div className="flex items-start gap-2 px-4 py-3 rounded-lg bg-status-red/10 border border-status-red/30 text-status-red text-sm">
            <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <span>{gmailError}</span>
          </div>
        )}

        {/* Results card */}
        {gmailResults && (
          <div className="rounded-xl border border-border overflow-hidden">
            <div className="px-4 py-2.5 bg-bg-surface border-b border-border flex items-center justify-between gap-2">
              <span className="text-sm font-semibold text-foreground">Scan Results</span>
              <div className="flex items-center gap-3 text-xs text-muted-foreground font-mono">
                <span>{gmailResults.detected} detected</span>
                <span className="text-status-green">{gmailResults.applied} applied</span>
                {gmailResults.pending > 0 && (
                  <span className="text-status-amber">{gmailResults.pending} pending</span>
                )}
                <span>{gmailResults.skipped} skipped</span>
              </div>
            </div>

            {gmailResults.changes.length === 0 ? (
              <div className="flex items-center gap-2 px-4 py-4 text-sm text-muted-foreground">
                <CheckCircle2 className="w-4 h-4 text-status-green flex-shrink-0" />
                No OOO signals matched to team members.
              </div>
            ) : (
              <ul className="divide-y divide-border">
                {gmailResults.changes.map((change) => (
                  <OOOChangeRow key={change.memberId} change={change} />
                ))}
              </ul>
            )}
          </div>
        )}
      </section>

      {/* ── Import Team Calendars ─────────────────────────────────────────── */}
      <section className="space-y-4">
        <div>
          <h2 className="text-base font-semibold text-foreground">Import Team Calendars</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Upload individual <code className="font-mono text-xs bg-bg-surface2 px-1 py-0.5 rounded">.ics</code> files
            named after member IDs (e.g.{' '}
            <code className="font-mono text-xs bg-bg-surface2 px-1 py-0.5 rounded">mem-001.ics</code>) or a single{' '}
            <code className="font-mono text-xs bg-bg-surface2 px-1 py-0.5 rounded">.zip</code> archive containing them.
            Each file is matched to a team member and their availability is recalculated immediately.
          </p>
        </div>

        {/* Drop zone */}
        <div
          role="button"
          tabIndex={0}
          onClick={() => fileInputRef.current?.click()}
          onKeyDown={(e) => e.key === 'Enter' && fileInputRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          className={cn(
            'flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed p-10 cursor-pointer transition-colors',
            dragging
              ? 'border-status-green bg-status-green/5'
              : 'border-border hover:border-muted-foreground/40 hover:bg-bg-surface2/50'
          )}
        >
          <Upload className="w-8 h-8 text-muted-foreground" />
          <p className="text-sm font-medium text-foreground">Drop files here or click to browse</p>
          <p className="text-xs text-muted-foreground">Accepts .ics files or a .zip archive</p>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept=".ics,.zip"
          multiple
          hidden
          onChange={(e) => addFiles(e.target.files)}
        />

        {/* Selected file chips */}
        {files.length > 0 && (
          <ul className="flex flex-wrap gap-2">
            {files.map((f) => (
              <li
                key={f.name}
                className="flex items-center gap-1.5 pl-2.5 pr-1.5 py-1 rounded-full bg-bg-surface2 border border-border text-xs text-foreground"
              >
                <FileText className="w-3 h-3 text-muted-foreground flex-shrink-0" />
                {f.name}
                <button
                  onClick={() => removeFile(f.name)}
                  className="ml-0.5 rounded-full hover:bg-bg-surface p-0.5 text-muted-foreground hover:text-foreground transition-colors"
                >
                  <X className="w-3 h-3" />
                </button>
              </li>
            ))}
          </ul>
        )}

        <button
          onClick={handleUpload}
          disabled={uploading || files.length === 0}
          className={cn(
            'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors',
            uploading || files.length === 0
              ? 'bg-bg-surface2 text-muted-foreground cursor-not-allowed'
              : 'bg-status-green text-bg-base hover:opacity-90'
          )}
        >
          <Upload className="w-4 h-4" />
          {uploading ? 'Uploading…' : 'Upload & Sync'}
        </button>

        {/* Results */}
        {results && (
          <div className="rounded-xl border border-border overflow-hidden">
            <div className="px-4 py-2.5 bg-bg-surface border-b border-border">
              <span className="text-sm font-semibold text-foreground">Upload Results</span>
            </div>
            <ul className="divide-y divide-border">
              {results.processed.map((r) => (
                <li key={r.memberId} className="flex items-center gap-3 px-4 py-3">
                  {r.status === 'ok' ? (
                    <CheckCircle className="w-4 h-4 text-status-green flex-shrink-0" />
                  ) : (
                    <AlertTriangle className="w-4 h-4 text-status-amber flex-shrink-0" />
                  )}
                  <span className="flex-1 text-sm text-foreground">{r.memberName}</span>
                  {r.status === 'ok' && r.calendarPct !== undefined && (
                    <span className="font-mono text-xs text-muted-foreground">
                      cal={r.calendarPct.toFixed(1)}%
                    </span>
                  )}
                  {r.status === 'error' && (
                    <span className="text-xs text-status-red">{r.detail}</span>
                  )}
                </li>
              ))}
              {results.unmatched.map((f) => (
                <li key={f} className="flex items-center gap-3 px-4 py-3">
                  <AlertTriangle className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                  <span className="flex-1 text-sm text-muted-foreground">{f}</span>
                  <span className="text-xs text-muted-foreground">no matching member</span>
                </li>
              ))}
              {results.processed.length === 0 && results.unmatched.length === 0 && (
                <li className="px-4 py-3 text-sm text-muted-foreground">No files processed.</li>
              )}
            </ul>
          </div>
        )}
      </section>
    </div>
  );
}
