'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LayoutGrid, Calendar, Zap, Users, Wifi, WifiOff } from 'lucide-react';
import { cn } from '@/lib/utils';
import { lastSynced } from '@/lib/mock-data';
import { formatDistanceToNow } from 'date-fns';

const navItems = [
  { href: '/overview', icon: LayoutGrid, label: 'Overview' },
  { href: '/week-ahead', icon: Calendar, label: 'Week Ahead' },
  { href: '/task-command', icon: Zap, label: 'Task Command' },
  { href: '/team', icon: Users, label: 'Team Directory' },
];

function SyncStatus() {
  const diffMs = Date.now() - lastSynced.getTime();
  const diffHours = diffMs / (1000 * 60 * 60);
  const isStale = diffHours > 2;
  const timeAgo = formatDistanceToNow(lastSynced, { addSuffix: true });

  return (
    <div className="flex flex-col items-center gap-1 px-2 pb-4">
      {isStale ? (
        <>
          <WifiOff className="w-4 h-4 text-status-amber" />
          <span className="text-[9px] text-status-amber font-mono leading-none">Stale</span>
        </>
      ) : (
        <>
          <Wifi className="w-4 h-4 text-status-green" />
          <span className="text-[9px] text-status-green font-mono leading-none">Synced</span>
        </>
      )}
      <span className="text-[8px] text-muted-foreground text-center leading-tight hidden">
        {timeAgo}
      </span>
    </div>
  );
}

export default function Sidebar() {
  const pathname = usePathname();

  return (
    <>
      {/* Desktop: fixed left sidebar */}
      <aside className="hidden md:flex flex-col w-[60px] h-screen bg-bg-surface border-r border-border sticky top-0 flex-shrink-0">
        {/* Logo / Brand mark */}
        <div className="flex items-center justify-center h-14 border-b border-border">
          <div className="w-7 h-7 rounded-md bg-status-green flex items-center justify-center">
            <span className="text-bg-base font-bold text-xs font-heading">IQ</span>
          </div>
        </div>

        {/* Nav items */}
        <nav className="flex-1 flex flex-col items-center gap-1 py-3">
          {navItems.map(({ href, icon: Icon, label }) => {
            const isActive = pathname.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                title={label}
                className={cn(
                  'relative flex items-center justify-center w-10 h-10 rounded-lg transition-colors group',
                  isActive
                    ? 'text-status-green bg-status-green/10'
                    : 'text-muted-foreground hover:text-foreground hover:bg-bg-surface2'
                )}
              >
                {/* Active left border accent */}
                {isActive && (
                  <span className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 bg-status-green rounded-r-full -ml-[2px]" />
                )}
                <Icon className="w-5 h-5" />
                {/* Tooltip on hover */}
                <span className="absolute left-full ml-2 px-2 py-1 rounded bg-bg-surface2 text-xs text-foreground whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity border border-border z-50">
                  {label}
                </span>
              </Link>
            );
          })}
        </nav>

        {/* Sync status at bottom */}
        <SyncStatus />
      </aside>

      {/* Mobile: bottom nav */}
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
