'use client';

import { useRouter } from 'next/navigation';
import { atRiskTasks } from '@/lib/mock-data';
import { Task } from '@/lib/types';
import { cn } from '@/lib/utils';
import { useAppStore } from '@/store';

function PriorityBadge({ priority }: { priority: Task['priority'] }) {
  const colors = {
    P0: 'bg-status-red/20 text-status-red border-status-red/40',
    P1: 'bg-status-amber/20 text-status-amber border-status-amber/40',
    P2: 'bg-status-yellow/20 text-status-yellow border-status-yellow/40',
  };
  return (
    <span
      className={cn(
        'text-[10px] font-mono font-medium px-1.5 py-0.5 rounded border leading-none',
        colors[priority]
      )}
    >
      {priority}
    </span>
  );
}

export default function RiskChipStrip() {
  const { taskStatusOverrides } = useAppStore();
  const router = useRouter();

  const visibleTasks = atRiskTasks.filter(
    (t) => (taskStatusOverrides[t.id] ?? t.status) !== 'covered'
  );

  if (visibleTasks.length === 0) return null;

  return (
    <div className="relative">
      <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
        {visibleTasks.map((task) => (
          <button
            key={task.id}
            onClick={() => router.push(`/task-command?taskId=${task.id}`)}
            className={cn(
              'flex items-center gap-2 px-3 py-2 rounded-lg bg-bg-surface border border-border',
              'whitespace-nowrap text-sm text-foreground hover:border-status-green/50 transition-colors',
              'flex-shrink-0',
              task.priority === 'P0' && 'animate-pulse-p0'
            )}
          >
            <PriorityBadge priority={task.priority} />
            <span className="font-sans text-xs">{task.title}</span>
          </button>
        ))}
      </div>
      {/* Fade on right edge */}
      <div className="absolute right-0 top-0 bottom-1 w-8 bg-gradient-to-l from-bg-base to-transparent pointer-events-none" />
    </div>
  );
}
