import { formatDistanceToNow } from 'date-fns';
import { AlertTriangle } from 'lucide-react';
import SummaryBar from '@/components/dashboard/SummaryBar';
import RiskChipStrip from '@/components/dashboard/RiskChipStrip';
import TeamGrid from '@/components/dashboard/TeamGrid';
import { lastSynced } from '@/lib/mock-data';

function StaleBanner() {
  const diffMs = Date.now() - lastSynced.getTime();
  const diffHours = diffMs / (1000 * 60 * 60);
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
    <div className="p-6 pb-20 md:pb-6 space-y-6 max-w-[1600px]">
      {/* Page header */}
      <div>
        <h1 className="text-4xl md:text-5xl font-heading font-bold text-foreground tracking-tight leading-none">
          Today&apos;s Overview
        </h1>
        <p className="text-sm text-muted-foreground mt-2">
          Team coverage snapshot &middot;{' '}
          {new Date().toLocaleDateString('en-US', {
            weekday: 'long',
            month: 'long',
            day: 'numeric',
          })}
        </p>
      </div>

      {/* Stale data banner */}
      <StaleBanner />

      {/* Summary stat blocks */}
      <SummaryBar />

      {/* At-risk task chip strip */}
      <div className="space-y-2">
        <h2 className="text-xs font-semibold text-foreground/70 uppercase tracking-widest">
          Tasks at Risk
        </h2>
        <RiskChipStrip />
      </div>

      {/* Team grid */}
      <div className="space-y-3">
        <h2 className="text-xs font-semibold text-foreground/70 uppercase tracking-widest">
          Team Availability
        </h2>
        <TeamGrid />
      </div>
    </div>
  );
}
