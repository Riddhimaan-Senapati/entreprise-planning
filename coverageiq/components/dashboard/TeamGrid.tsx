'use client';

import { useState } from 'react';
import { teamMembers, atRiskTasks } from '@/lib/mock-data';
import PersonCard from './PersonCard';
import { cn } from '@/lib/utils';
import { useAppStore } from '@/store';

const FILTER_OPTIONS = [
  { key: 'all', label: 'All Teams' },
  { key: 'risks', label: 'Risks Only' },
  { key: 'availability', label: 'Sort by Availability' },
] as const;

type FilterKey = (typeof FILTER_OPTIONS)[number]['key'];

export default function TeamGrid() {
  const [filter, setFilter] = useState<FilterKey>('all');
  const { overrides } = useAppStore();

  const atRiskMemberIds = new Set(atRiskTasks.map((t) => t.assigneeId));

  // Compute the effective leave status for a member, respecting manual overrides
  function effectiveLeaveStatus(memberId: string, baseIsOOO: boolean) {
    const override = overrides.find((o) => o.memberId === memberId);
    if (override) return override.status;
    return baseIsOOO ? 'ooo' : 'available';
  }

  // Availability score used for sorting: overrides to 'ooo' → 0, 'partial' → 50% penalty
  function effectiveSortScore(memberId: string, confidenceScore: number, baseIsOOO: boolean) {
    const status = effectiveLeaveStatus(memberId, baseIsOOO);
    if (status === 'ooo') return 0;
    if (status === 'partial') return Math.round(confidenceScore * 0.5);
    return confidenceScore;
  }

  const displayed = (() => {
    let members = [...teamMembers];

    if (filter === 'risks') {
      // Show members assigned to at-risk tasks, or effectively OOO after overrides
      members = members.filter(
        (m) =>
          atRiskMemberIds.has(m.id) ||
          effectiveLeaveStatus(m.id, m.isOOO) === 'ooo'
      );
    }

    if (filter === 'availability') {
      members = members.sort(
        (a, b) =>
          effectiveSortScore(b.id, b.confidenceScore, b.isOOO) -
          effectiveSortScore(a.id, a.confidenceScore, a.isOOO)
      );
    }

    return members;
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
