'use client';

import WeekChart from '@/components/dashboard/WeekChart';
import ConfidenceRing from '@/components/dashboard/ConfidenceRing';
import { useTeamMembers } from '@/hooks/use-api';
import { getConfidenceColor } from '@/lib/utils';
import { TeamMember } from '@/lib/types';

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'] as const;
type DayKey = keyof TeamMember['weekAvailability'];

const DAY_KEYS: DayKey[] = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'];

function DayCell({ score }: { score: number }) {
  const color = getConfidenceColor(score);
  const bgOpacity = score === 0 ? 0.08 : 0.18 + (score / 100) * 0.32;

  return (
    <div
      className="w-9 h-9 rounded flex items-center justify-center text-xs font-mono font-semibold"
      style={{
        backgroundColor: `${color}${Math.round(bgOpacity * 255).toString(16).padStart(2, '0')}`,
        color: score === 0 ? '#9494b2' : '#e8e8f0',
      }}
      title={`${score}% available`}
    >
      {score > 0 ? score : '—'}
    </div>
  );
}

function getInitials(name: string) {
  return name.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2);
}

function WeekRow({ member, index }: { member: TeamMember; index: number }) {
  return (
    <div className="flex items-center gap-4 p-3 rounded-xl bg-bg-surface border border-border">
      {/* Person identity */}
      <div className="flex items-center gap-2 w-48 flex-shrink-0">
        <ConfidenceRing score={member.confidenceScore} size={36} strokeWidth={3} index={index}>
          <div className="flex items-center justify-center w-[24px] h-[24px] rounded-full bg-bg-surface2 text-[8px] font-bold font-heading text-foreground">
            {getInitials(member.name)}
          </div>
        </ConfidenceRing>
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground truncate">{member.name}</p>
          <p className="text-xs text-muted-foreground truncate">{member.role.split(' ').slice(-1)[0]}</p>
        </div>
      </div>

      {/* Day cells */}
      <div className="flex gap-2 flex-1">
        {DAY_KEYS.map((dayKey) => (
          <DayCell key={dayKey} score={member.weekAvailability[dayKey]} />
        ))}
      </div>
    </div>
  );
}

function buildWeekChartData(members: TeamMember[]) {
  const keys: { label: string; key: DayKey }[] = [
    { label: 'Mon', key: 'monday' },
    { label: 'Tue', key: 'tuesday' },
    { label: 'Wed', key: 'wednesday' },
    { label: 'Thu', key: 'thursday' },
    { label: 'Fri', key: 'friday' },
  ];
  return keys.map(({ label, key }) => ({
    day: label,
    available: members.filter((m) => m.weekAvailability[key] >= 50).length,
  }));
}

export default function WeekAheadPage() {
  const { data: members } = useTeamMembers();
  const sorted = [...(members ?? [])].sort((a, b) => b.confidenceScore - a.confidenceScore);
  const weekChartData = buildWeekChartData(members ?? []);

  return (
    <div className="p-6 pb-20 md:pb-6 space-y-6 max-w-[900px]">
      {/* Page header */}
      <div>
        <h1 className="text-2xl font-heading font-bold text-foreground">Week Ahead</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Availability forecast · read-only view
        </p>
      </div>

      {/* Area chart */}
      <div className="p-4 rounded-xl bg-bg-surface border border-border space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium text-foreground">Available Headcount by Day</h2>
          <span className="text-xs text-muted-foreground font-mono">Mon–Fri</span>
        </div>
        <WeekChart data={weekChartData} />
      </div>

      {/* Day header row */}
      <div className="flex items-center gap-4">
        <div className="w-48 flex-shrink-0" />
        <div className="flex gap-2">
          {DAYS.map((d) => (
            <div key={d} className="w-9 text-center text-xs font-mono text-muted-foreground">
              {d}
            </div>
          ))}
        </div>
      </div>

      {/* Member rows */}
      <div className="space-y-2">
        {sorted.map((member, i) => (
          <WeekRow key={member.id} member={member} index={i} />
        ))}
      </div>
    </div>
  );
}
