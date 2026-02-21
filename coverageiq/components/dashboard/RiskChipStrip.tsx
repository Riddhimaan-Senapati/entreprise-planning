'use client';

import { differenceInHours, formatDistanceToNow } from 'date-fns';
import { useRouter } from 'next/navigation';
import { useTasks, useTeamMembers } from '@/hooks/use-api';
import { Task } from '@/lib/types';
import { cn } from '@/lib/utils';
import { useAppStore } from '@/store';

const PRIORITY_LEFT_BORDER: Record<Task['priority'], string> = {
  P0: 'border-l-2 border-l-status-red',
  P1: 'border-l-2 border-l-status-amber',
  P2: 'border-l-2 border-l-status-yellow',
};

function PriorityBadge({ priority }: { priority: Task['priority'] }) {
  const colors = {
    P0: 'bg-status-red/20 text-status-red border-status-red/40',
    P1: 'bg-status-amber/20 text-status-amber border-status-amber/40',
    P2: 'bg-status-yellow/20 text-status-yellow border-status-yellow/40',
  };
  return (
    <span
      className={cn(
        'text-[10px] font-mono font-medium px-1.5 py-0.5 rounded border leading-none flex-shrink-0',
        colors[priority]
      )}
    >
      {priority}
    </span>
  );
}

function DeadlineText({ deadline }: { deadline: Date }) {
  const hours = differenceInHours(deadline, new Date());
  const label = formatDistanceToNow(deadline, { addSuffix: true });
  const isUrgent = hours >= 0 && hours < 48;
  const isPast = hours < 0;
  return (
    <span className={cn('text-xs font-mono', isPast || isUrgent ? 'text-status-red' : 'text-muted-foreground')}>
      due {label}
    </span>
  );
}

interface RiskCardProps {
  task: Task;
  assigneeName?: string;
  onClick: () => void;
}

function RiskCard({ task, assigneeName, onClick }: RiskCardProps) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'text-left p-4 rounded-xl bg-bg-surface border border-border transition-colors',
        'hover:bg-bg-surface2 hover:border-status-green',
        PRIORITY_LEFT_BORDER[task.priority],
        task.priority === 'P0' && 'animate-pulse-p0'
      )}
    >
      {/* Top row: priority badge + title */}
      <div className="flex items-start gap-2 mb-2">
        <PriorityBadge priority={task.priority} />
        <p className="text-base font-heading font-semibold text-foreground leading-tight">
          {task.title}
        </p>
      </div>

      {/* Project name */}
      <p className="text-xs font-mono text-muted-foreground mb-2 truncate">
        {task.projectName}
        {assigneeName && (
          <span className="text-muted-foreground/60"> · {assigneeName}</span>
        )}
      </p>

      {/* Bottom row: deadline + suggestion count */}
      <div className="flex items-center gap-3">
        <DeadlineText deadline={task.deadline} />
        {task.suggestions.length > 0 && (
          <span className="text-xs text-muted-foreground">
            {task.suggestions.length} suggestion{task.suggestions.length !== 1 ? 's' : ''}
          </span>
        )}
      </div>
    </button>
  );
}

export default function RiskChipStrip() {
  const { taskStatusOverrides } = useAppStore();
  const { data: tasks } = useTasks();
  const { data: members } = useTeamMembers();
  const router = useRouter();

  const visibleTasks = (tasks ?? [])
    .filter((t) => (taskStatusOverrides[t.id] ?? t.status) !== 'covered')
    .sort((a, b) => a.deadline.getTime() - b.deadline.getTime());

  if (visibleTasks.length === 0) return null;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
      {visibleTasks.map((task) => {
        const assignee = (members ?? []).find((m) => m.id === task.assigneeId);
        return (
          <RiskCard
            key={task.id}
            task={task}
            assigneeName={assignee?.name.split(' ')[0]}
            onClick={() => router.push(`/task-command?taskId=${task.id}`)}
          />
        );
      })}
    </div>
  );
}
