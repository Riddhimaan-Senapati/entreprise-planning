import WeekChart from '@/components/dashboard/WeekChart';
import ConfidenceRing from '@/components/dashboard/ConfidenceRing';
import { teamMembers } from '@/lib/mock-data';
import { getConfidenceColor } from '@/lib/utils';
import { TeamMember } from '@/lib/types';

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'] as const;
type DayKey = keyof TeamMember['weekAvailability'];

const DAY_KEYS: DayKey[] = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'];

function DayCell({ score }: { score: number }) {
  const color = getConfidenceColor(score);
  const opacity = score === 0 ? 0.15 : 0.15 + (score / 100) * 0.7;

  return (
    <div
      className="w-7 h-7 rounded flex items-center justify-center text-[9px] font-mono"
      style={{ backgroundColor: `${color}${Math.round(opacity * 255).toString(16).padStart(2, '0')}`, color }}
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
          <p className="text-xs font-medium text-foreground truncate">{member.name}</p>
          <p className="text-[10px] text-muted-foreground truncate">{member.role.split(' ').slice(-1)[0]}</p>
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

export default function WeekAheadPage() {
  const sorted = [...teamMembers].sort((a, b) => b.confidenceScore - a.confidenceScore);

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
        <WeekChart />
      </div>

      {/* Day header row */}
      <div className="flex items-center gap-4">
        <div className="w-48 flex-shrink-0" />
        <div className="flex gap-2">
          {DAYS.map((d) => (
            <div key={d} className="w-7 text-center text-[10px] font-mono text-muted-foreground">
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
