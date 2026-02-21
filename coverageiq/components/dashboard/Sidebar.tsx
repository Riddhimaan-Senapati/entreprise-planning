'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LayoutGrid, Calendar, Zap, Users, Wifi, WifiOff, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useSummary } from '@/hooks/use-api';
import { formatDistanceToNow } from 'date-fns';

const navItems = [
  { href: '/overview', icon: LayoutGrid, label: 'Overview' },
  { href: '/week-ahead', icon: Calendar, label: 'Week Ahead' },
  { href: '/task-command', icon: Zap, label: 'Task Command' },
  { href: '/team', icon: Users, label: 'Team Directory' },
];

function SyncStatus({ expanded }: { expanded: boolean }) {
  const { data: summary } = useSummary();
  const lastSynced = summary ? new Date(summary.lastSynced) : null;

  if (!lastSynced) {
    return (
      <div className={cn('flex items-center gap-2 pb-4', expanded ? 'px-4' : 'flex-col px-2')}>
        <Wifi className="w-4 h-4 text-muted-foreground flex-shrink-0" />
        <span className={cn('font-mono text-muted-foreground leading-none', expanded ? 'text-xs' : 'text-[9px]')}>—</span>
      </div>
    );
  }

  const diffHours = (Date.now() - lastSynced.getTime()) / (1000 * 60 * 60);
  const isStale = diffHours > 2;

  return (
    <div className={cn('flex items-center gap-2 pb-4', expanded ? 'px-4' : 'flex-col px-2')}>
      {isStale ? (
        <>
          <WifiOff className="w-4 h-4 text-status-amber flex-shrink-0" />
          <span className={cn('font-mono text-status-amber leading-none', expanded ? 'text-xs' : 'text-[9px]')}>
            Stale
          </span>
        </>
      ) : (
        <>
          <Wifi className="w-4 h-4 text-status-green flex-shrink-0" />
          <span className={cn('font-mono text-status-green leading-none', expanded ? 'text-xs' : 'text-[9px]')}>
            Synced
          </span>
        </>
      )}
    </div>
  );
}

export default function Sidebar() {
  const pathname = usePathname();
  const [expanded, setExpanded] = useState(false);

  return (
    <>
      {/* Desktop: collapsible left sidebar */}
      <aside
        className={cn(
          'hidden md:flex flex-col h-screen bg-bg-surface border-r border-border sticky top-0 flex-shrink-0 transition-[width] duration-200 overflow-hidden',
          expanded ? 'w-[180px]' : 'w-[60px]'
        )}
      >
        {/* Logo / Brand mark + toggle */}
        <div className={cn('flex items-center h-14 border-b border-border flex-shrink-0', expanded ? 'px-3 gap-2' : 'justify-center')}>
          <div className="w-7 h-7 rounded-md bg-status-green flex items-center justify-center flex-shrink-0">
            <span className="text-bg-base font-bold text-xs font-heading">IQ</span>
          </div>
          {expanded && (
            <span className="flex-1 text-sm font-heading font-bold text-foreground truncate">Vantage</span>
          )}
          <button
            onClick={() => setExpanded((v) => !v)}
            title={expanded ? 'Collapse sidebar' : 'Expand sidebar'}
            className={cn(
              'flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-bg-surface2 transition-colors flex-shrink-0',
              expanded ? 'w-7 h-7' : 'w-7 h-7 -mr-1'
            )}
          >
            <ChevronRight className={cn('w-4 h-4 transition-transform duration-200', expanded && 'rotate-180')} />
          </button>
        </div>

        {/* Nav items */}
        <nav className="flex-1 flex flex-col items-center gap-1 py-3 w-full">
          {navItems.map(({ href, icon: Icon, label }) => {
            const isActive = pathname.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                title={expanded ? undefined : label}
                className={cn(
                  'relative flex items-center h-10 rounded-lg transition-colors group',
                  expanded ? 'w-[calc(100%-16px)] px-3 gap-3' : 'w-10 justify-center',
                  isActive
                    ? 'text-status-green bg-status-green/10'
                    : 'text-muted-foreground hover:text-foreground hover:bg-bg-surface2'
                )}
              >
                {/* Active left border accent */}
                {isActive && (
                  <span className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 bg-status-green rounded-r-full" />
                )}
                <Icon className="w-5 h-5 flex-shrink-0" />
                {expanded && (
                  <span className="text-sm font-medium truncate">{label}</span>
                )}
                {/* Tooltip — only shown when collapsed */}
                {!expanded && (
                  <span className="absolute left-full ml-2 px-2 py-1 rounded bg-bg-surface2 text-xs text-foreground whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity border border-border z-50">
                    {label}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>

        {/* Sync status */}
        <SyncStatus expanded={expanded} />
      </aside>

      {/* Mobile: bottom nav (unchanged) */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 flex bg-bg-surface border-t border-border">
        {navItems.map(({ href, icon: Icon, label }) => {
          const isActive = pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                'flex-1 flex flex-col items-center justify-center py-2 gap-0.5 text-[10px] transition-colors',
                isActive
                  ? 'text-status-green'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              <Icon className="w-5 h-5" />
              <span>{label}</span>
            </Link>
          );
        })}
      </nav>
    </>
  );
}
