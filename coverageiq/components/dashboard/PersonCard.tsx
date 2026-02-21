'use client';

import { CalendarOff, Pencil } from 'lucide-react';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import ConfidenceRing from './ConfidenceRing';
import { TeamMember } from '@/lib/types';
import { cn } from '@/lib/utils';
import { useAppStore } from '@/store';

interface PersonCardProps {
  member: TeamMember;
  index: number;
}

function getInitials(name: string): string {
  return name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

function DataSourceDot({ active }: { active: boolean }) {
  return (
    <span
      className={cn(
        'w-1.5 h-1.5 rounded-full',
        active ? 'bg-status-green' : 'bg-muted-foreground/30'
      )}
    />
  );
}

export default function PersonCard({ member, index }: PersonCardProps) {
  const { overrides, setOverride, clearOverride } = useAppStore();
  const override = overrides.find((o) => o.memberId === member.id);
  const hasOverride = !!override;

  // Effective status respects manual overrides; falls back to raw data
  const effectiveStatus =
    override?.status ?? (member.isOOO ? 'ooo' : member.dataSources.leaveStatus);
  const effectiveIsOOO = effectiveStatus === 'ooo';

  const dataSourceCount = [
    member.dataSources.calendarPct > 0,
    member.dataSources.taskLoadHours > 0,
    !effectiveIsOOO,
  ].filter(Boolean).length;

  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <div
              className={cn(
                'relative flex flex-col items-center gap-2 p-3 rounded-xl bg-bg-surface border border-border',
                'cursor-pointer select-none transition-all duration-200',
                'hover:border-status-green/30 hover:bg-bg-surface2',
                effectiveIsOOO && 'grayscale opacity-70'
              )}
            >
              {/* OOO overlay icon */}
              {effectiveIsOOO && (
                <div className="absolute top-2 right-2 z-10">
                  <CalendarOff className="w-3.5 h-3.5 text-muted-foreground" />
                </div>
              )}

              {/* Override indicator */}
              {hasOverride && (
                <div className="absolute top-2 left-2 z-10">
                  <Pencil className="w-3 h-3 text-status-yellow" />
                </div>
              )}

              {/* Confidence ring with avatar */}
              <ConfidenceRing score={member.confidenceScore} size={60} strokeWidth={4} index={index}>
                <div
                  className="flex items-center justify-center w-[44px] h-[44px] rounded-full text-xs font-bold font-heading"
                  style={{
                    background: 'linear-gradient(135deg, #1a1a24 0%, #2a2a38 100%)',
                    color: '#e8e8f0',
                  }}
                >
                  {getInitials(member.name)}
                </div>
              </ConfidenceRing>

              {/* Name */}
              <div className="text-center w-full">
                <p className="text-xs font-medium text-foreground leading-tight truncate">
                  {member.name.split(' ')[0]}
                </p>
                <p className="text-[10px] text-muted-foreground truncate leading-tight">
                  {member.role.split(' ').slice(-1)[0]}
                </p>
              </div>

              {/* Data source dots */}
              <div className="flex items-center gap-1">
                <DataSourceDot active={member.dataSources.calendarPct > 0} />
                <DataSourceDot active={member.dataSources.taskLoadHours > 0} />
                <DataSourceDot active={!effectiveIsOOO} />
              </div>
            </div>
          </DropdownMenuTrigger>
        </TooltipTrigger>

        {/* Tooltip: data source breakdown */}
        <TooltipContent
          side="top"
          className="bg-bg-surface2 border border-border text-foreground p-3 max-w-[220px]"
        >
          <p className="font-semibold text-xs mb-2">{member.name}</p>
          {hasOverride && (
            <p className="text-[10px] text-status-yellow mb-2 flex items-center gap-1">
              <Pencil className="w-3 h-3 flex-shrink-0" />
              Overridden to{' '}
              <span className="capitalize font-semibold">&nbsp;{override?.status}</span>
            </p>
          )}
          <div className="space-y-1.5">
            <div className="flex items-center gap-2 text-xs">
              <span
                className={cn(
                  'w-2 h-2 rounded-full flex-shrink-0',
                  member.dataSources.calendarPct > 70
                    ? 'bg-status-green'
                    : member.dataSources.calendarPct > 40
                    ? 'bg-status-yellow'
                    : 'bg-status-red'
                )}
              />
              <span className="text-muted-foreground">Calendar</span>
              <span className="ml-auto font-mono">{member.dataSources.calendarPct}%</span>
            </div>
            <div className="flex items-center gap-2 text-xs">
              <span
                className={cn(
                  'w-2 h-2 rounded-full flex-shrink-0',
                  member.dataSources.taskLoadHours < 20
                    ? 'bg-status-green'
                    : member.dataSources.taskLoadHours < 35
                    ? 'bg-status-yellow'
                    : 'bg-status-red'
                )}
              />
              <span className="text-muted-foreground">Task load</span>
              <span className="ml-auto font-mono">{member.dataSources.taskLoadHours}h</span>
            </div>
            <div className="flex items-center gap-2 text-xs">
              <span
                className={cn(
                  'w-2 h-2 rounded-full flex-shrink-0',
                  effectiveStatus === 'available'
                    ? 'bg-status-green'
                    : effectiveStatus === 'partial'
                    ? 'bg-status-yellow'
                    : 'bg-status-red'
                )}
              />
              <span className="text-muted-foreground">Leave</span>
              <span className="ml-auto capitalize">{effectiveStatus}</span>
            </div>
          </div>
          <p className="text-[10px] text-muted-foreground mt-2 pt-2 border-t border-border">
            {dataSourceCount}/3 sources synced
          </p>
        </TooltipContent>
      </Tooltip>

      {/* Context menu */}
      <DropdownMenuContent className="bg-bg-surface2 border-border" align="center">
        <DropdownMenuLabel className="text-xs text-muted-foreground">
          Override — {member.name.split(' ')[0]}
        </DropdownMenuLabel>
        <DropdownMenuSeparator className="bg-border" />
        <DropdownMenuItem
          className="text-status-green cursor-pointer text-xs"
          onClick={() => setOverride(member.id, 'available')}
        >
          Mark as Available
        </DropdownMenuItem>
        <DropdownMenuItem
          className="text-status-yellow cursor-pointer text-xs"
          onClick={() => setOverride(member.id, 'partial')}
        >
          Mark as Partially Available
        </DropdownMenuItem>
        <DropdownMenuItem
          className="text-status-red cursor-pointer text-xs"
          onClick={() => setOverride(member.id, 'ooo')}
        >
          Mark as OOO
        </DropdownMenuItem>
        {hasOverride && (
          <>
            <DropdownMenuSeparator className="bg-border" />
            <DropdownMenuItem
              className="text-muted-foreground cursor-pointer text-xs"
              onClick={() => clearOverride(member.id)}
            >
              Clear override
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
