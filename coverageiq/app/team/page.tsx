'use client';

import { useState, useRef, useEffect } from 'react';
import { Search, CalendarOff, Pencil, ChevronUp, ChevronDown, ChevronsUpDown, ChevronRight, Loader2 } from 'lucide-react';
import { useTeamMembers } from '@/hooks/use-api';
import { TeamMember } from '@/lib/types';
import { cn } from '@/lib/utils';
import { updateMemberNotes, updateMemberSkills, deleteOverride } from '@/lib/api-client';
import { useAppStore } from '@/store';
import { toast } from 'sonner';

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
    <div>
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
      <div>
        <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider block mb-1.5">
          Skills
        </span>
        <div className="flex flex-wrap gap-1 items-center">
          {skills.map((skill) => (
            <span
              key={skill}
              className="text-xs font-mono px-1.5 py-0.5 rounded bg-bg-surface2 text-muted-foreground border border-border/60"
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
      </div>
    );
  }

  return (
    <div>
      <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider block mb-1.5">
        Skills
      </span>
      <div className="space-y-1.5">
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
    </div>
  );
}

// ── Sort utilities ─────────────────────────────────────────────────────────────

type SortCol = 'name' | 'team' | 'calendarPct' | 'status';
type SortDir = 'asc' | 'desc';

function SortIcon({ active, dir }: { active: boolean; dir: SortDir }) {
  if (!active) return <ChevronsUpDown className="w-3 h-3 opacity-30 ml-1 inline" />;
  return dir === 'asc'
    ? <ChevronUp className="w-3 h-3 text-status-green ml-1 inline" />
    : <ChevronDown className="w-3 h-3 text-status-green ml-1 inline" />;
}

// ── Expanded row: skills + notes editing ──────────────────────────────────────

function ExpandedDetail({ member }: { member: TeamMember }) {
  return (
    <tr>
      <td colSpan={7} className="px-6 pb-5 bg-bg-surface2/30">
        <div className="pt-3 pl-12 grid grid-cols-1 md:grid-cols-2 gap-5 border-t border-border/40">
          <SkillsEditor memberId={member.id} initialSkills={member.skills} />
          <NotesField memberId={member.id} initialValue={member.managerNotes ?? ''} />
        </div>
      </td>
    </tr>
  );
}

// ── Table row ─────────────────────────────────────────────────────────────────

function MemberRow({
  member,
  expanded,
  onToggle,
  effectiveStatus,
  onClearOoo,
}: {
  member: TeamMember;
  expanded: boolean;
  onToggle: () => void;
  effectiveStatus: string;
  onClearOoo: () => Promise<void>;
}) {
  const isOOO = effectiveStatus === 'ooo';
  const hasOverride = member.manuallyOverridden === true;
  const [clearing, setClearing] = useState(false);
  const initials = member.name.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase();
  const calPct = member.dataSources.calendarPct;

  const calTextClass =
    calPct > 70 ? 'text-status-green' : calPct > 40 ? 'text-status-yellow' : 'text-status-red';
  const calBarClass =
    calPct > 70 ? 'bg-status-green' : calPct > 40 ? 'bg-status-yellow' : 'bg-status-red';

  return (
    <>
      <tr
        onClick={onToggle}
        className={cn(
          'border-b border-border cursor-pointer transition-colors group',
          'hover:bg-bg-surface2/60',
          expanded && 'bg-bg-surface2/40',
          isOOO && 'opacity-60'
        )}
      >
        {/* Status dot */}
        <td className="px-4 py-3 w-10">
          <div className="flex items-center gap-1.5">
            <span
              className={cn(
                'w-2.5 h-2.5 rounded-full flex-shrink-0',
                isOOO ? 'bg-status-red' : 'bg-status-green'
              )}
            />
            {hasOverride && <Pencil className="w-3 h-3 text-status-yellow" />}
          </div>
        </td>

        {/* Member: avatar + name + role */}
        <td className="px-4 py-3">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-full bg-bg-surface2 border border-border text-xs font-bold font-heading flex items-center justify-center flex-shrink-0 text-foreground">
              {initials}
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <p className="text-sm font-medium font-heading text-foreground leading-tight">
                  {member.name}
                </p>
                {isOOO && <CalendarOff className="w-3 h-3 text-muted-foreground flex-shrink-0" />}
              </div>
              <p className="text-xs text-muted-foreground truncate max-w-[200px]">{member.role}</p>
            </div>
          </div>
        </td>

        {/* Team */}
        <td className="px-4 py-3">
          <span className="text-xs font-mono px-1.5 py-0.5 rounded border border-border bg-bg-surface2 text-muted-foreground">
            {member.team}
          </span>
        </td>

        {/* Calendar availability */}
        <td className="px-4 py-3">
          <div className="flex items-center gap-2.5">
            <div className="w-20 h-1.5 rounded-full bg-bg-base overflow-hidden flex-shrink-0">
              <div
                className={cn('h-full rounded-full transition-all', calBarClass)}
                style={{ width: `${calPct}%` }}
              />
            </div>
            <span className={cn('text-xs font-mono tabular-nums font-medium', calTextClass)}>
              {calPct}%
            </span>
          </div>
        </td>

        {/* Status badge */}
        <td className="px-4 py-3">
          <div className="flex items-center gap-1.5">
            <span
              className={cn(
                'text-xs font-mono px-1.5 py-0.5 rounded border',
                isOOO
                  ? 'bg-status-red/10 text-status-red border-status-red/30'
                  : 'bg-status-green/10 text-status-green border-status-green/30'
              )}
            >
              {isOOO ? 'OOO' : 'Available'}
            </span>
            {isOOO && (
              <button
                title="Override to Available & clear all OOO flags"
                disabled={clearing}
                onClick={async (e) => {
                  e.stopPropagation();
                  setClearing(true);
                  try {
                    await onClearOoo();
                  } finally {
                    setClearing(false);
                  }
                }}
                className="text-muted-foreground/50 hover:text-status-green transition-colors disabled:opacity-40"
              >
                {clearing
                  ? <Loader2 className="w-3 h-3 animate-spin" />
                  : <Pencil className="w-3 h-3" />}
              </button>
            )}
          </div>
        </td>

        {/* Skills (compact) */}
        <td className="px-4 py-3">
          <div className="flex items-center gap-1 flex-wrap">
            {member.skills.slice(0, 3).map((s) => (
              <span
                key={s}
                className="text-xs font-mono px-1.5 py-0.5 rounded bg-bg-surface2 text-muted-foreground border border-border/60"
              >
                {s}
              </span>
            ))}
            {member.skills.length > 3 && (
              <span className="text-xs font-mono text-muted-foreground/60">
                +{member.skills.length - 3}
              </span>
            )}
            {member.skills.length === 0 && (
              <span className="text-xs font-mono text-muted-foreground/40">—</span>
            )}
          </div>
        </td>

        {/* Expand chevron */}
        <td className="px-3 py-3 w-8">
          <ChevronRight
            className={cn(
              'w-3.5 h-3.5 text-muted-foreground/40 transition-transform duration-200',
              expanded && 'rotate-90'
            )}
          />
        </td>
      </tr>

      {expanded && <ExpandedDetail member={member} />}
    </>
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

type HeaderCol = {
  key: SortCol | null;
  label: string;
};

const HEADERS: HeaderCol[] = [
  { key: null,           label: '' },
  { key: 'name',         label: 'Member' },
  { key: 'team',         label: 'Team' },
  { key: 'calendarPct',  label: 'Availability' },
  { key: 'status',       label: 'Status' },
  { key: null,           label: 'Skills' },
  { key: null,           label: '' },
];

export default function TeamPage() {
  const { data: members, loading, refetch } = useTeamMembers();
  const { overrides } = useAppStore();
  const [teamFilter, setTeamFilter] = useState<TabKey>('All');
  const [availFilter, setAvailFilter] = useState<AvailKey>('All');
  const [search, setSearch] = useState('');
  const [sortCol, setSortCol] = useState<SortCol>('name');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  function getEffectiveStatus(memberId: string, dbStatus: string) {
    return overrides.find((o) => o.memberId === memberId)?.status ?? dbStatus;
  }

  const all = members ?? [];

  const counts = TEAM_TABS.reduce<Record<TabKey, number>>(
    (acc, t) => {
      acc[t] = t === 'All' ? all.length : all.filter((m) => m.team === t).length;
      return acc;
    },
    { All: 0, Engineering: 0, Design: 0, Product: 0 }
  );

  const availCounts: Record<AvailKey, number> = {
    All:       all.length,
    Available: all.filter((m) => getEffectiveStatus(m.id, m.dataSources.leaveStatus) === 'available').length,
    OOO:       all.filter((m) => getEffectiveStatus(m.id, m.dataSources.leaveStatus) === 'ooo').length,
  };

  const filtered = all.filter((m) => {
    const matchesTeam = teamFilter === 'All' || m.team === teamFilter;
    const status = getEffectiveStatus(m.id, m.dataSources.leaveStatus);
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

  const sorted = [...filtered].sort((a, b) => {
    const statusA = getEffectiveStatus(a.id, a.dataSources.leaveStatus);
    const statusB = getEffectiveStatus(b.id, b.dataSources.leaveStatus);

    let valA: string | number;
    let valB: string | number;

    switch (sortCol) {
      case 'name':         valA = a.name;                    valB = b.name;                    break;
      case 'team':         valA = a.team;                    valB = b.team;                    break;
      case 'calendarPct':  valA = a.dataSources.calendarPct; valB = b.dataSources.calendarPct; break;
      case 'status':       valA = statusA;                   valB = statusB;                   break;
      default:             valA = a.name;                    valB = b.name;
    }

    if (typeof valA === 'string' && typeof valB === 'string') {
      return sortDir === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA);
    }
    return sortDir === 'asc'
      ? (valA as number) - (valB as number)
      : (valB as number) - (valA as number);
  });

  async function handleClearOoo(memberId: string, memberName: string) {
    await deleteOverride(memberId);
    refetch();
    toast.success(`${memberName} marked as Available`, {
      description: 'All OOO flags have been cleared.',
    });
  }

  const handleSort = (col: SortCol) => {
    if (sortCol === col) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortCol(col); setSortDir('asc'); }
  };

  if (loading && !members) {
    return (
      <div className="flex items-center justify-center h-full min-h-[60vh]">
        <div className="flex flex-col items-center gap-3 text-muted-foreground">
          <div className="w-8 h-8 rounded-full border-2 border-border border-t-status-green animate-spin" />
          <span className="text-sm font-mono">Loading team…</span>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-heading font-bold text-foreground">Team Directory</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {all.length} member{all.length !== 1 ? 's' : ''}
            {filtered.length !== all.length && (
              <span className="ml-1 text-muted-foreground/60">· {filtered.length} shown</span>
            )}
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
              <span
                className={cn(
                  'font-mono text-[10px]',
                  teamFilter === t ? 'text-status-green/70' : 'text-muted-foreground/50'
                )}
              >
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
              <span
                className={cn(
                  'font-mono text-[10px]',
                  availFilter === a ? 'opacity-70' : 'text-muted-foreground/50'
                )}
              >
                {availCounts[a]}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      {sorted.length > 0 ? (
        <div className="rounded-xl border border-border overflow-hidden">
          <table className="w-full text-left">
            <thead className="bg-bg-surface2 border-b border-border">
              <tr>
                {HEADERS.map((col, i) => (
                  <th key={i} className="px-4 py-2.5">
                    {col.key ? (
                      <button
                        onClick={() => col.key && handleSort(col.key)}
                        className="flex items-center text-xs font-mono text-muted-foreground uppercase tracking-wider hover:text-foreground transition-colors"
                      >
                        {col.label}
                        <SortIcon active={sortCol === col.key} dir={sortDir} />
                      </button>
                    ) : (
                      <span className="text-xs font-mono text-muted-foreground uppercase tracking-wider">
                        {col.label}
                      </span>
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="bg-bg-surface divide-y divide-border">
              {sorted.map((member) => (
                <MemberRow
                  key={member.id}
                  member={member}
                  expanded={expandedId === member.id}
                  onToggle={() =>
                    setExpandedId(expandedId === member.id ? null : member.id)
                  }
                  effectiveStatus={getEffectiveStatus(
                    member.id,
                    member.dataSources.leaveStatus
                  )}
                  onClearOoo={() => handleClearOoo(member.id, member.name)}
                />
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="text-center py-16 text-muted-foreground text-sm">
          No team members match your search.
        </div>
      )}
    </div>
  );
}
