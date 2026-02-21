'use client';

import { useEffect } from 'react';
import { formatDistanceToNow, differenceInHours } from 'date-fns';
import { atRiskTasks } from '@/lib/mock-data';
import { teamMembers } from '@/lib/mock-data';
import { Task } from '@/lib/types';
import { cn, getPriorityColor } from '@/lib/utils';
import { useAppStore } from '@/store';
import { Clock } from 'lucide-react';

interface TaskListProps {
  initialTaskId?: string;
}

function getInitials(name: string) {
  return name.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2);
}

function DeadlineLabel({ deadline }: { deadline: Date }) {
  const hoursUntil = differenceInHours(deadline, new Date());
  const label = formatDistanceToNow(deadline, { addSuffix: true });
  const isUrgent = hoursUntil < 48 && hoursUntil >= 0;
  const isPast = hoursUntil < 0;

  return (
    <span
      className={cn(
        'text-[10px] font-mono',
        isPast ? 'text-status-red' : isUrgent ? 'text-status-red' : 'text-muted-foreground'
      )}
    >
      due {label}
    </span>
  );
}

export default function TaskList({ initialTaskId }: TaskListProps) {
  const { selectedTaskId, setSelectedTaskId, priorityFilter, setPriorityFilter, taskStatusOverrides, scheduledTasks } = useAppStore();

  // Auto-select from URL param on mount
  useEffect(() => {
    if (initialTaskId) {
      setSelectedTaskId(initialTaskId);
    }
  }, [initialTaskId, setSelectedTaskId]);

  const priorityOrder = { P0: 0, P1: 1, P2: 2 };
  const sorted = [...atRiskTasks].sort(
    (a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]
  );

  const filtered =
    priorityFilter === 'all'
      ? sorted
      : sorted.filter((t) => t.priority === priorityFilter);

  const PILLS = ['all', 'P0', 'P1', 'P2'] as const;

  return (
    <div className="flex flex-col h-full">
      {/* Filter pills */}
      <div className="flex gap-2 mb-4 flex-wrap">
        {PILLS.map((p) => (
          <button
            key={p}
            onClick={() => setPriorityFilter(p)}
            className={cn(
              'px-3 py-1 rounded-full text-xs font-medium border transition-colors',
              priorityFilter === p
                ? p === 'P0'
                  ? 'bg-status-red/20 text-status-red border-status-red/40'
                  : p === 'P1'
                  ? 'bg-status-amber/20 text-status-amber border-status-amber/40'
                  : p === 'P2'
                  ? 'bg-status-yellow/20 text-status-yellow border-status-yellow/40'
                  : 'bg-status-green/10 text-status-green border-status-green/30'
                : 'bg-transparent text-muted-foreground border-border hover:text-foreground'
            )}
          >
            {p === 'all' ? 'All' : p}
          </button>
        ))}
      </div>

      {/* Task cards */}
      <div className="flex flex-col gap-2 overflow-y-auto flex-1">
        {filtered.map((task) => {
          const isSelected = selectedTaskId === task.id;
          const status = taskStatusOverrides[task.id] ?? task.status;
          const isScheduled = scheduledTasks[task.id];
          const assignee = teamMembers.find((m) => m.id === task.assigneeId);

          return (
            <button
              key={task.id}
              onClick={() => setSelectedTaskId(task.id)}
              className={cn(
                'relative text-left w-full p-3 rounded-xl border transition-all duration-200',
                'bg-bg-surface hover:bg-bg-surface2',
                isSelected
                  ? 'border-l-2 border-l-status-green border-y-border border-r-border bg-bg-surface2'
                  : 'border-border',
                isScheduled && 'opacity-50',
                status === 'covered' && 'opacity-60'
              )}
            >
              {/* Scheduled clock overlay */}
              {isScheduled && (
                <div className="absolute top-2 right-2">
                  <Clock className="w-3.5 h-3.5 text-muted-foreground" />
                </div>
              )}

              <div className="flex items-start gap-2">
                {/* Priority badge */}
                <span
                  className={cn(
                    'text-[10px] font-mono font-medium px-1.5 py-0.5 rounded border flex-shrink-0 mt-0.5',
                    getPriorityColor(task.priority)
                  )}
                >
                  {task.priority}
                </span>

                <div className="flex-1 min-w-0">
                  <p
                    className={cn(
                      'text-sm font-heading font-semibold leading-tight',
                      status === 'covered' && 'line-through opacity-60'
                    )}
                  >
                    {task.title}
                  </p>

                  {/* Project breadcrumb */}
                  <p className="text-[10px] font-mono text-muted-foreground mt-0.5 truncate">
                    {task.projectName}
                  </p>

                  <div className="flex items-center gap-2 mt-1.5">
                    <DeadlineLabel deadline={task.deadline} />

                    {/* Original assignee avatar with strikethrough */}
                    {assignee && (
                      <div className="flex items-center gap-1">
                        <div className="w-4 h-4 rounded-full bg-bg-surface2 border border-border flex items-center justify-center text-[8px] font-bold opacity-50">
                          {getInitials(assignee.name)}
                        </div>
                        <span className="text-[10px] text-muted-foreground line-through opacity-50">
                          {assignee.name.split(' ')[0]}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
