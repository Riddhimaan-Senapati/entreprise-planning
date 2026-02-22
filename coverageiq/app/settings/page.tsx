'use client';

import { useRef, useState } from 'react';
import {
  AlertTriangle,
  CalendarOff,
  CheckCircle,
  ChevronDown,
  Clock,
  FileText,
  Loader2,
  RefreshCw,
  Upload,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useSlackSync } from '@/hooks/use-api';
import type { TimeOffSyncResult } from '@/lib/types';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000';

// ── ICS upload types ───────────────────────────────────────────────────────────

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

// ── ICS Upload Section ─────────────────────────────────────────────────────────

function IcsUploadSection() {
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

  return (
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
  );
}

// ── Slack Sync Section ─────────────────────────────────────────────────────────

const HOURS_OPTIONS = [
  { label: 'Last 24 hours', value: 24 },
  { label: 'Last 48 hours', value: 48 },
  { label: 'Last 7 days',   value: 168 },
  { label: 'Last 30 days',  value: 720 },
] as const;

function SyncResultCard({ result }: { result: TimeOffSyncResult }) {
  const hasChanges = result.changes.length > 0;

  return (
    <div className="rounded-xl border border-border overflow-hidden">
      {/* Summary row */}
      <div className="px-4 py-3 bg-bg-surface border-b border-border flex items-center gap-4 flex-wrap">
        <span className="text-sm font-semibold text-foreground">Sync Results</span>
        <div className="flex items-center gap-3 ml-auto flex-wrap">
          <Stat
            label="detected"
            value={result.detected}
            color="text-foreground"
          />
          <Stat
            label="applied"
            value={result.applied}
            color={result.applied > 0 ? 'text-status-green' : 'text-muted-foreground'}
          />
          {result.pending > 0 && (
            <Stat
              label="pending"
              value={result.pending}
              color="text-status-amber"
            />
          )}
          {result.skipped > 0 && (
            <Stat
              label="skipped"
              value={result.skipped}
              color="text-muted-foreground"
            />
          )}
        </div>
      </div>

      {hasChanges ? (
        <ul className="divide-y divide-border">
          {result.changes.map((change, i) => (
            <li key={`${change.memberId}-${i}`} className="px-4 py-3 space-y-1">
              <div className="flex items-start gap-2">
                {change.pending ? (
                  <Clock className="w-4 h-4 text-status-amber flex-shrink-0 mt-0.5" />
                ) : (
                  <CalendarOff className="w-4 h-4 text-status-red flex-shrink-0 mt-0.5" />
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium text-foreground">{change.memberName}</span>
                    {change.pending ? (
                      <span className="text-[10px] font-mono px-1.5 py-0.5 rounded-full bg-status-amber/10 text-status-amber border border-status-amber/30">
                        Scheduled
                      </span>
                    ) : (
                      <span className="text-[10px] font-mono px-1.5 py-0.5 rounded-full bg-status-red/10 text-status-red border border-status-red/30">
                        OOO now
                      </span>
                    )}
                    {change.personUsername && change.personUsername !== change.memberName && (
                      <span className="text-xs text-muted-foreground font-mono">
                        ← @{change.personUsername}
                      </span>
                    )}
                  </div>

                  {/* Date range */}
                  {(change.startDate || change.endDate) && (
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {change.startDate ?? '?'}
                      {change.endDate ? ` → ${change.endDate}` : ' (open-ended)'}
                    </p>
                  )}

                  {/* Reason */}
                  {change.reason && (
                    <p className="text-xs text-muted-foreground/70 italic mt-0.5 truncate">
                      {change.reason}
                    </p>
                  )}

                  {/* Coverage */}
                  {change.coverageBy && (
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Coverage: <span className="text-foreground">{change.coverageBy}</span>
                    </p>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <div className="px-4 py-6 text-center text-sm text-muted-foreground">
          No time-off announcements found in this window.
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <span className="text-xs font-mono">
      <span className={cn('font-bold', color)}>{value}</span>
      <span className="text-muted-foreground ml-0.5">{label}</span>
    </span>
  );
}

function SlackSyncSection() {
  const [hours, setHours] = useState<24 | 48 | 168 | 720>(24);
  const [showDropdown, setShowDropdown] = useState(false);
  const { trigger, loading, data: result, error } = useSlackSync();

  const selectedOption = HOURS_OPTIONS.find((o) => o.value === hours) ?? HOURS_OPTIONS[0];

  const handleSync = async () => {
    try {
      await trigger(hours);
    } catch {
      // error is captured in hook state
    }
  };

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-base font-semibold text-foreground">Sync from Slack</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Scan a Slack channel for time-off announcements and automatically update team
          member availability. Gemini AI reads each message and extracts who is OOO, when,
          and why. Future OOOs are stored and activate automatically — no action needed
          when the date arrives.
        </p>
      </div>

      {/* Action row */}
      <div className="flex items-center gap-2 flex-wrap">
        {/* Hours dropdown */}
        <div className="relative">
          <button
            onClick={() => setShowDropdown((v) => !v)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-bg-surface border border-border text-sm text-foreground hover:bg-bg-surface2 transition-colors"
          >
            {selectedOption.label}
            <ChevronDown className={cn('w-3.5 h-3.5 text-muted-foreground transition-transform', showDropdown && 'rotate-180')} />
          </button>
          {showDropdown && (
            <div className="absolute top-full mt-1 left-0 z-10 bg-bg-surface2 border border-border rounded-lg shadow-lg overflow-hidden min-w-[160px]">
              {HOURS_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => { setHours(opt.value as typeof hours); setShowDropdown(false); }}
                  className={cn(
                    'w-full text-left px-3 py-2 text-sm transition-colors hover:bg-bg-surface',
                    opt.value === hours ? 'text-status-green' : 'text-foreground'
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Sync button */}
        <button
          onClick={handleSync}
          disabled={loading}
          className={cn(
            'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors',
            loading
              ? 'bg-bg-surface2 text-muted-foreground cursor-not-allowed'
              : 'bg-status-green text-bg-base hover:opacity-90'
          )}
        >
          {loading ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <RefreshCw className="w-4 h-4" />
          )}
          {loading ? 'Scanning Slack…' : 'Sync now'}
        </button>
      </div>

      {/* Loading note */}
      {loading && (
        <p className="text-xs text-muted-foreground font-mono">
          Fetching Slack messages and running Gemini AI — this may take up to 30s…
        </p>
      )}

      {/* Error */}
      {error && (
        <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg bg-status-red/10 border border-status-red/20 text-status-red text-sm">
          <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <span>{error.message}</span>
        </div>
      )}

      {/* Results */}
      {result && !loading && <SyncResultCard result={result} />}

      {/* Info note */}
      <div className="rounded-lg border border-border bg-bg-surface px-3 py-2.5 space-y-1">
        <p className="text-xs text-muted-foreground">
          <span className="font-medium text-foreground">How it works</span>{' '}
          — Slack channel messages are scanned for time-off announcements. Each detected
          message is sent to Gemini AI which extracts the person, dates, reason, and
          coverage. Results are fuzzy-matched to your team roster.
        </p>
        <p className="text-xs text-muted-foreground">
          <span className="font-medium text-foreground">Future OOO</span>{' '}
          — If a member posts "OOO next week" today, their status updates automatically
          when the date arrives. No re-sync needed.
        </p>
        <p className="text-xs text-muted-foreground">
          <span className="font-medium text-foreground">Manual overrides win</span>{' '}
          — Members with a manual override (set via the Team Directory) are never
          modified by Slack sync.
        </p>
      </div>
    </section>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function SettingsPage() {
  return (
    <div className="p-6 max-w-2xl mx-auto space-y-8">
      <div>
        <h1 className="text-xl font-heading font-bold text-foreground">Settings</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Admin controls and calendar management</p>
      </div>

      <IcsUploadSection />

      <hr className="border-border" />

      <SlackSyncSection />
    </div>
  );
}
