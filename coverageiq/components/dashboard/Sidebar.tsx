'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LayoutGrid, Zap, Users, Settings, Sun, Moon, Mail, MessageSquare, ChevronRight } from 'lucide-react';
import { useTheme } from 'next-themes';
import { formatDistanceToNow } from 'date-fns';
import { cn } from '@/lib/utils';
import { useAppStore } from '@/store';

const navItems = [
  { href: '/overview', icon: LayoutGrid, label: 'Overview' },
  { href: '/task-command', icon: Zap, label: 'Task Command' },
  { href: '/team', icon: Users, label: 'Team Directory' },
];

function SyncPills({ expanded }: { expanded: boolean }) {
  const { gmailLastSynced, slackLastSynced } = useAppStore();

  const fmt = (d: Date | null) =>
    d ? formatDistanceToNow(d, { addSuffix: true }) : 'Never';

  if (!expanded) {
    // Collapsed: two stacked icon dots
    return (
      <div className="flex flex-col items-center gap-1.5 border-t border-border py-2.5">
        <div className="relative" title={`Email: ${fmt(gmailLastSynced)}`}>
          <Mail className="w-4 h-4 text-muted-foreground" />
          <span className={cn('absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full', gmailLastSynced ? 'bg-status-green' : 'bg-muted-foreground/30')} />
        </div>
        <div className="relative" title={`Slack: ${fmt(slackLastSynced)}`}>
          <MessageSquare className="w-4 h-4 text-muted-foreground" />
          <span className={cn('absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full', slackLastSynced ? 'bg-status-green' : 'bg-muted-foreground/30')} />
        </div>
      </div>
    );
  }

  return (
    <div className="border-t border-border px-3 py-2.5 space-y-1.5">
      <div className="flex items-center gap-2">
        <Mail className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
        <span className="text-[11px] font-mono text-muted-foreground flex-1 truncate">Email</span>
        <span className={cn('text-[10px] font-mono truncate', gmailLastSynced ? 'text-status-green' : 'text-muted-foreground/50')}>
          {fmt(gmailLastSynced)}
        </span>
      </div>
      <div className="flex items-center gap-2">
        <MessageSquare className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
        <span className="text-[11px] font-mono text-muted-foreground flex-1 truncate">Slack</span>
        <span className={cn('text-[10px] font-mono truncate', slackLastSynced ? 'text-status-green' : 'text-muted-foreground/50')}>
          {fmt(slackLastSynced)}
        </span>
      </div>
    </div>
  );
}

export default function Sidebar() {
  const pathname = usePathname();
  const [expanded, setExpanded] = useState(true);
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const isDark = theme === 'dark';

  return (
    <>
      {/* Desktop: collapsible left sidebar */}
      <aside
        className={cn(
          'hidden md:flex flex-col h-screen bg-bg-surface border-r border-border sticky top-0 flex-shrink-0 transition-[width] duration-200 overflow-hidden',
          expanded ? 'w-[220px]' : 'w-[60px]'
        )}
      >
        {/* Logo / Brand mark + toggle */}
        <div className={cn('flex items-center h-14 border-b border-border flex-shrink-0', expanded ? 'px-4 gap-3' : 'justify-center')}>
          <div className="w-7 h-7 rounded-md bg-status-green flex items-center justify-center flex-shrink-0">
            <svg viewBox="0 0 16 16" width="14" height="14" fill="none" aria-hidden="true">
              <path d="M5 3L8 13L11 3" stroke="#0b0c12" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
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
                  expanded ? 'w-[calc(100%-16px)] px-3 gap-3 truncate' : 'w-10 justify-center',
                  isActive
                    ? 'text-status-green bg-status-green/10'
                    : 'text-muted-foreground hover:text-foreground hover:bg-bg-surface2'
                )}
              >
                {isActive && (
                  <span className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 bg-status-green rounded-r-full" />
                )}
                <Icon className="w-5 h-5 flex-shrink-0" />
                {expanded && (
                  <span className="text-sm font-medium truncate">{label}</span>
                )}
                {!expanded && (
                  <span className="absolute left-full ml-2 px-2 py-1 rounded bg-bg-surface2 text-xs text-foreground whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity border border-border z-50">
                    {label}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>

        {/* Theme toggle + Settings — pinned at bottom above sync status */}
        <div className={cn('flex flex-col items-center pb-1 w-full', expanded ? 'px-2' : 'px-2')}>
          {mounted && (
            <button
              onClick={() => setTheme(isDark ? 'light' : 'dark')}
              title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
              className={cn(
                'relative flex items-center h-10 rounded-lg transition-colors group w-full text-muted-foreground hover:text-foreground hover:bg-bg-surface2',
                expanded ? 'px-3 gap-3' : 'justify-center',
              )}
            >
              {isDark
                ? <Sun className="w-5 h-5 flex-shrink-0" />
                : <Moon className="w-5 h-5 flex-shrink-0" />}
              {expanded && <span className="text-sm font-medium">{isDark ? 'Light mode' : 'Dark mode'}</span>}
              {!expanded && (
                <span className="absolute left-full ml-2 px-2 py-1 rounded bg-bg-surface2 text-xs text-foreground whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity border border-border z-50">
                  {isDark ? 'Light mode' : 'Dark mode'}
                </span>
              )}
            </button>
          )}
        </div>
        <div className={cn('flex flex-col items-center pb-1 w-full', expanded ? 'px-2' : 'px-2')}>
          {(() => {
            const isActive = pathname.startsWith('/settings');
            return (
              <Link
                href="/settings"
                title={expanded ? undefined : 'Settings'}
                className={cn(
                  'relative flex items-center h-10 rounded-lg transition-colors group w-full',
                  expanded ? 'px-3 gap-3' : 'justify-center',
                  isActive
                    ? 'text-status-green bg-status-green/10'
                    : 'text-muted-foreground hover:text-foreground hover:bg-bg-surface2'
                )}
              >
                {isActive && (
                  <span className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 bg-status-green rounded-r-full" />
                )}
                <Settings className="w-5 h-5 flex-shrink-0" />
                {expanded && <span className="text-sm font-medium">Settings</span>}
                {!expanded && (
                  <span className="absolute left-full ml-2 px-2 py-1 rounded bg-bg-surface2 text-xs text-foreground whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity border border-border z-50">
                    Settings
                  </span>
                )}
              </Link>
            );
          })()}
        </div>

        {/* Sync status */}
        <SyncPills expanded={expanded} />
      </aside>

      {/* Mobile: bottom nav */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 flex bg-bg-surface border-t border-border">
        {[...navItems, { href: '/settings', icon: Settings, label: 'Settings' }].map(({ href, icon: Icon, label }) => {
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
