'use client';

import { useState, useRef, useEffect } from 'react';
import { Search, CalendarOff, Pencil } from 'lucide-react';
import { useTeamMembers } from '@/hooks/use-api';
import ConfidenceRing from '@/components/dashboard/ConfidenceRing';
import { TeamMember } from '@/lib/types';
import { cn, getConfidenceTextClass } from '@/lib/utils';
import { updateMemberNotes, updateMemberSkills } from '@/lib/api-client';
import { useAppStore } from '@/store';

// ── Notes field with debounced auto-save ──────────────────────────────────────

function NotesField({ memberId, initialValue }: { memberId: string; initialValue: string }) {
  const [value, setValue] = useState(initialValue);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const next = e.target.value;
    setValue(next);
    setSaveStatus('idle');
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(async () => {
      setSaveStatus('saving');
      try {
        await updateMemberNotes(memberId, next);
        setSaveStatus('saved');
      } catch {
        setSaveStatus('idle');
      }
    }, 700);
  };

  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  return (
    <div className="mt-3 pt-3 border-t border-border">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">
          Manager Notes
        </span>
        {saveStatus === 'saving' && (
          <span className="text-[10px] font-mono text-muted-foreground">saving…</span>
        )}
        {saveStatus === 'saved' && (
          <span className="text-[10px] font-mono text-status-green">saved</span>
        )}
      </div>
      <textarea
        value={value}
        onChange={handleChange}
        placeholder="Add private notes…"
        rows={2}
        className="w-full bg-bg-base border border-border rounded-lg px-2.5 py-2 text-xs text-foreground placeholder:text-muted-foreground/40 resize-none focus:outline-none focus:border-status-green/40 transition-colors font-mono leading-relaxed"
      />
    </div>
  );
}

// ── Skills editor ─────────────────────────────────────────────────────────────

function SkillsEditor({ memberId, initialSkills }: { memberId: string; initialSkills: string[] }) {
  const [skills, setSkills] = useState(initialSkills);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<string[]>([]);
  const [input, setInput] = useState('');
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const commitInput = (raw: string) => {
    const trimmed = raw.trim();
    if (trimmed && !draft.includes(trimmed)) {
      setDraft((prev) => [...prev, trimmed]);
    }
    setInput('');
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      commitInput(input);
    } else if (e.key === 'Backspace' && input === '' && draft.length > 0) {
      setDraft((prev) => prev.slice(0, -1));
    }
  };

  const startEditing = () => {
    setDraft(skills);
    setInput('');
    setEditing(true);
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const handleSave = async () => {
    const finalSkills = input.trim() ? [...draft, input.trim()] : draft;
    setSaving(true);
    try {
      await updateMemberSkills(memberId, finalSkills);
      setSkills(finalSkills);
      setEditing(false);
    } catch {
      // keep edit mode open on error
    } finally {
      setSaving(false);
      setInput('');
    }
  };

  if (!editing) {
    return (
      <div className="flex flex-wrap gap-1 mt-3 items-center">
        {skills.map((skill) => (
          <span
            key={skill}
            className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-bg-surface2 text-muted-foreground border border-border/60"
          >
            {skill}
          </span>
        ))}
        <button
          onClick={startEditing}
          className="text-[10px] font-mono px-1.5 py-0.5 rounded border border-dashed border-border text-muted-foreground hover:text-foreground hover:border-status-green/40 transition-colors"
        >
          {skills.length === 0 ? '+ Add skills' : '+ Edit'}
        </button>
      </div>
    );
  }

  return (
    <div className="mt-3 space-y-1.5">
      <div className="flex flex-wrap gap-1 p-2 bg-bg-base border border-status-green/30 rounded-lg min-h-[34px] items-center">
        {draft.map((skill) => (
          <span
            key={skill}
            className="flex items-center gap-0.5 text-[10px] font-mono px-1.5 py-0.5 rounded bg-bg-surface2 text-muted-foreground border border-border/60"
          >
            {skill}
            <button
              type="button"
              onClick={() => setDraft((prev) => prev.filter((s) => s !== skill))}
              className="ml-0.5 leading-none text-muted-foreground/50 hover:text-status-red transition-colors"
            >
              ×
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={() => { if (input.trim()) commitInput(input); }}
          placeholder={draft.length === 0 ? 'Add skill, press Enter…' : 'Add more…'}
          className="bg-transparent text-[10px] font-mono text-foreground placeholder:text-muted-foreground/40 focus:outline-none flex-1 min-w-[80px]"
        />
      </div>
      <p className="text-[9px] font-mono text-muted-foreground/50">Enter or comma to add · Backspace to remove last</p>
      <div className="flex gap-2">
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex-1 py-1 rounded-lg bg-status-green text-bg-base text-[10px] font-mono font-medium hover:bg-status-green/90 transition-colors disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button
          onClick={() => setEditing(false)}
          className="px-3 py-1 rounded-lg border border-border text-[10px] font-mono text-muted-foreground hover:text-foreground transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

// ── Member card ────────────────────────────────────────────────────────────────

const STATUS_STYLES = {
  available: 'bg-status-green/10 text-status-green border-status-green/30',
  ooo:       'bg-status-red/10 text-status-red border-status-red/30',
} as const;

function MemberCard({ member, index }: { member: TeamMember; index: number }) {
  const { overrides } = useAppStore();
  const override = overrides.find((o) => o.memberId === member.id);
  const effectiveStatus = (override?.status ?? member.dataSources.leaveStatus) as keyof typeof STATUS_STYLES;
  const isOOO = effectiveStatus === 'ooo';
  const hasOverride = !!override || member.manuallyOverridden === true;

  return (
    <div
      className={cn(
        'flex flex-col p-4 rounded-xl bg-bg-surface border border-border transition-colors',
        'hover:border-border/60',
        isOOO && 'opacity-60'
      )}
    >
      {/* Top: ring + name/role/badges */}
      <div className="flex items-start gap-3">
        <div className="flex-shrink-0">
          <ConfidenceRing score={member.confidenceScore} size={52} strokeWidth={4} index={index}>
            <span className="text-xs font-bold font-heading text-foreground">
              {member.name.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase()}
            </span>
          </ConfidenceRing>
        </div>

        <div className="flex-1 min-w-0 mt-0.5">
          <div className="flex items-start gap-1.5">
            <p className="text-sm font-heading font-semibold text-foreground leading-tight truncate flex-1">
              {member.name}
            </p>
            {isOOO && <CalendarOff className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0 mt-0.5" />}
            {hasOverride && !isOOO && <Pencil className="w-3 h-3 text-status-yellow flex-shrink-0 mt-0.5" />}
          </div>
          <p className="text-xs text-muted-foreground truncate mt-0.5">{member.role}</p>
          <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded border border-border bg-bg-surface2 text-muted-foreground">
              {member.team}
            </span>
            <span className={cn('text-[10px] font-mono px-1.5 py-0.5 rounded border capitalize', STATUS_STYLES[effectiveStatus])}>
              {effectiveStatus === 'ooo' ? 'OOO' : effectiveStatus}
            </span>
          </div>
        </div>
      </div>

      {/* Stats row */}
      <div className="flex items-center gap-4 mt-3 text-xs font-mono text-muted-foreground">
        <span>
          <span className="text-foreground">{member.dataSources.calendarPct}%</span>
          {' '}cal
        </span>
        <span>
          <span className="text-foreground">{member.dataSources.taskLoadHours}h</span>
          {' '}tasks
        </span>
        <span className={cn('ml-auto font-semibold tabular-nums', getConfidenceTextClass(member.confidenceScore))}>
          {Math.round(member.confidenceScore)}
        </span>
      </div>

      {/* Skills */}
      <SkillsEditor memberId={member.id} initialSkills={member.skills} />

      {/* Manager notes */}
      <NotesField memberId={member.id} initialValue={member.managerNotes ?? ''} />
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

const TEAM_TABS = ['All', 'Engineering', 'Design', 'Product'] as const;
type TabKey = (typeof TEAM_TABS)[number];

const AVAIL_TABS = ['All', 'Available', 'OOO'] as const;
type AvailKey = (typeof AVAIL_TABS)[number];

const AVAIL_ACTIVE: Record<AvailKey, string> = {
  All:       'bg-status-green/10 text-status-green border-status-green/30',
  Available: 'bg-status-green/10 text-status-green border-status-green/30',
  OOO:       'bg-status-red/10 text-status-red border-status-red/30',
};

export default function TeamPage() {
  const { data: members } = useTeamMembers();
  const { overrides } = useAppStore();
  const [teamFilter, setTeamFilter] = useState<TabKey>('All');
  const [availFilter, setAvailFilter] = useState<AvailKey>('All');
  const [search, setSearch] = useState('');

  const all = members ?? [];

  // Compute effective status respecting Zustand overrides (same logic as MemberCard)
  function effectiveStatus(memberId: string, dbStatus: string) {
    return overrides.find((o) => o.memberId === memberId)?.status ?? dbStatus;
  }

  const counts = TEAM_TABS.reduce<Record<TabKey, number>>((acc, t) => {
    acc[t] = t === 'All' ? all.length : all.filter((m) => m.team === t).length;
    return acc;
  }, { All: 0, Engineering: 0, Design: 0, Product: 0 });

  const availCounts: Record<AvailKey, number> = {
    All:       all.length,
    Available: all.filter((m) => effectiveStatus(m.id, m.dataSources.leaveStatus) === 'available').length,
    OOO:       all.filter((m) => effectiveStatus(m.id, m.dataSources.leaveStatus) === 'ooo').length,
  };

  const displayed = all.filter((m) => {
    const matchesTeam = teamFilter === 'All' || m.team === teamFilter;
    const status = effectiveStatus(m.id, m.dataSources.leaveStatus);
    const matchesAvail =
      availFilter === 'All' ||
      (availFilter === 'Available' && status === 'available') ||
      (availFilter === 'OOO' && status === 'ooo');
    const q = search.toLowerCase();
    const matchesSearch =
      !q ||
      m.name.toLowerCase().includes(q) ||
      m.role.toLowerCase().includes(q) ||
      m.skills.some((s) => s.toLowerCase().includes(q));
    return matchesTeam && matchesAvail && matchesSearch;
  });

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-heading font-bold text-foreground">Team Directory</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {all.length} member{all.length !== 1 ? 's' : ''}
          </p>
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, role, skill…"
            className="bg-bg-surface border border-border rounded-lg pl-9 pr-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:border-status-green/40 transition-colors w-64"
          />
        </div>
      </div>

      {/* Filters */}
      <div className="space-y-2">
        {/* Team filter */}
        <div className="flex gap-2 flex-wrap">
          {TEAM_TABS.map((t) => (
            <button
              key={t}
              onClick={() => setTeamFilter(t)}
              className={cn(
                'px-3 py-1.5 rounded-lg text-xs font-medium transition-colors border flex items-center gap-1.5',
                teamFilter === t
                  ? 'bg-status-green/10 text-status-green border-status-green/30'
                  : 'bg-bg-surface text-muted-foreground border-border hover:text-foreground hover:border-border/60'
              )}
            >
              {t}
              <span className={cn('font-mono text-[10px]', teamFilter === t ? 'text-status-green/70' : 'text-muted-foreground/50')}>
                {counts[t]}
              </span>
            </button>
          ))}
        </div>

        {/* Availability filter */}
        <div className="flex gap-2 flex-wrap">
          {AVAIL_TABS.map((a) => (
            <button
              key={a}
              onClick={() => setAvailFilter(a)}
              className={cn(
                'px-3 py-1.5 rounded-lg text-xs font-medium transition-colors border flex items-center gap-1.5',
                availFilter === a
                  ? AVAIL_ACTIVE[a]
                  : 'bg-bg-surface text-muted-foreground border-border hover:text-foreground hover:border-border/60'
              )}
            >
              {a}
              <span className={cn('font-mono text-[10px]', availFilter === a ? 'opacity-70' : 'text-muted-foreground/50')}>
                {availCounts[a]}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Member grid */}
      {displayed.length > 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {displayed.map((member, i) => (
            <MemberCard key={member.id} member={member} index={i} />
          ))}
        </div>
      ) : (
        <div className="text-center py-16 text-muted-foreground text-sm">
          No team members match your search.
        </div>
      )}
    </div>
  );
}
