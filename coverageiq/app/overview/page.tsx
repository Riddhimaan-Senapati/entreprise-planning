'use client';

import { formatDistanceToNow } from 'date-fns';
import { AlertTriangle } from 'lucide-react';
import SummaryBar from '@/components/dashboard/SummaryBar';
import RiskChipStrip from '@/components/dashboard/RiskChipStrip';
import TeamGrid from '@/components/dashboard/TeamGrid';
import { useSummary } from '@/hooks/use-api';

function StaleBanner() {
  const { data: summary } = useSummary();
  if (!summary) return null;

  const lastSynced = new Date(summary.lastSynced);
  const diffHours = (Date.now() - lastSynced.getTime()) / (1000 * 60 * 60);
  if (diffHours <= 2) return null;

  return (
    <div className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-status-amber/10 border border-status-amber/30 text-status-amber text-sm">
      <AlertTriangle className="w-4 h-4 flex-shrink-0" />
      <span>
        Data may be stale — last synced{' '}
        <strong>{formatDistanceToNow(lastSynced, { addSuffix: true })}</strong>. Some signals may
        not reflect current availability.
      </span>
    </div>
  );
}

export default function OverviewPage() {
  return (
    <div className="p-8 pb-20 md:pb-8 max-w-[1600px] space-y-10">
      {/* Page header */}
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-heading font-bold text-foreground tracking-tight leading-none">
            Today&apos;s Overview
          </h1>
          <p className="text-sm text-muted-foreground mt-1.5">
            {new Date().toLocaleDateString('en-US', {
              weekday: 'long',
              month: 'long',
              day: 'numeric',
            })}
          </p>
        </div>
        <StaleBanner />
      </div>

      {/* Summary stat strip */}
      <SummaryBar />

      {/* At-risk tasks */}
      <div className="space-y-3">
        <h2 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-widest">
          Tasks at Risk
        </h2>
        <RiskChipStrip />
      </div>

      {/* Team availability */}
      <div className="space-y-3">
        <h2 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-widest">
          Team Availability
        </h2>
        <TeamGrid />
      </div>
    </div>
  );
}
