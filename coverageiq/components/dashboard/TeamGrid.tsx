'use client';

import { useState } from 'react';
import { useTeamMembers, useTasks } from '@/hooks/use-api';
import PersonCard from './PersonCard';
import { cn } from '@/lib/utils';
import { useAppStore } from '@/store';
import type { TeamMember } from '@/lib/types';

const FILTER_OPTIONS = [
  { key: 'all', label: 'All Teams' },
  { key: 'risks', label: 'Risks Only' },
  { key: 'availability', label: 'By Availability' },
  { key: 'calendar', label: 'By Calendar' },
  { key: 'leave', label: 'On Leave' },
] as const;

type FilterKey = (typeof FILTER_OPTIONS)[number]['key'];

export default function TeamGrid() {
  const [filter, setFilter] = useState<FilterKey>('all');
  const { overrides } = useAppStore();
  const { data: members } = useTeamMembers();
  const { data: tasks } = useTasks();

  const atRiskMemberIds = new Set((tasks ?? []).map((t) => t.assigneeId));

  // Compute the effective leave status for a member, respecting manual overrides.
  // Falls back to member.dataSources.leaveStatus so persisted 'ooo' values
  // survive page reloads (leaveStatus in DB already reflects the last override or ICS sync).
  function effectiveLeaveStatus(member: TeamMember) {
    const override = overrides.find((o) => o.memberId === member.id);
    if (override) return override.status;
    return member.dataSources.leaveStatus;
  }

  // Availability score used for sorting: 'ooo' → 0, otherwise use confidence score directly
  function effectiveSortScore(member: TeamMember) {
    if (effectiveLeaveStatus(member) === 'ooo') return 0;
    return member.confidenceScore;
  }

  const displayed = (() => {
    let list = [...(members ?? [])];

    if (filter === 'risks') {
      list = list.filter(
        (m) =>
          atRiskMemberIds.has(m.id) ||
          effectiveLeaveStatus(m) === 'ooo'
      );
    }

    if (filter === 'availability') {
      list = list.sort(
        (a, b) => effectiveSortScore(b) - effectiveSortScore(a)
      );
    }

    if (filter === 'calendar') {
      list = list.sort(
        (a, b) => b.dataSources.calendarPct - a.dataSources.calendarPct
      );
    }

    if (filter === 'leave') {
      list = list.filter(
        (m) => effectiveLeaveStatus(m) !== 'available'
      );
    }

    return list;
  })();

  return (
    <div className="space-y-4">
      {/* Filter buttons */}
      <div className="flex gap-2 flex-wrap">
        {FILTER_OPTIONS.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setFilter(key)}
            className={cn(
              'px-3 py-1.5 rounded-lg text-xs font-medium transition-colors border',
              filter === key
                ? 'bg-status-green/10 text-status-green border-status-green/30'
                : 'bg-bg-surface text-muted-foreground border-border hover:text-foreground hover:border-border/60'
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
        {displayed.map((member, i) => (
          <PersonCard key={member.id} member={member} index={i} />
        ))}
      </div>

      {displayed.length === 0 && (
        <div className="text-center py-12 text-muted-foreground text-sm">
          No team members match this filter.
        </div>
      )}
    </div>
  );
}
