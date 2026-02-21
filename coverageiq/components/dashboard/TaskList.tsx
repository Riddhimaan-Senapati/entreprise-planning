'use client';

import { useEffect } from 'react';
import { formatDistanceToNow, differenceInHours } from 'date-fns';
import { useTasks, useTeamMembers } from '@/hooks/use-api';
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
        'text-xs font-mono',
        isPast ? 'text-status-red' : isUrgent ? 'text-status-red' : 'text-muted-foreground'
      )}
    >
      due {label}
    </span>
  );
}

export default function TaskList({ initialTaskId }: TaskListProps) {
  const { selectedTaskId, setSelectedTaskId, priorityFilter, setPriorityFilter, taskStatusOverrides, scheduledTasks } = useAppStore();
  const { data: tasks } = useTasks();
  const { data: members } = useTeamMembers();

  // Auto-select from URL param on mount
  useEffect(() => {
    if (initialTaskId) {
      setSelectedTaskId(initialTaskId);
    }
  }, [initialTaskId, setSelectedTaskId]);

  const sorted = [...(tasks ?? [])].sort(
    (a, b) => a.deadline.getTime() - b.deadline.getTime()
  );

  const filtered =
    priorityFilter === 'all'
      ? sorted
      : sorted.filter((t) => t.priority === priorityFilter);

  const PILLS = ['all', 'P0', 'P1', 'P2'] as const;

  return (
    <div className="flex flex-col h-full">
      {/* Filter pills */}
      <div className="flex gap-2 mb-5 flex-wrap">
        {PILLS.map((p) => (
          <button
            key={p}
            onClick={() => setPriorityFilter(p)}
            className={cn(
              'px-4 py-1.5 rounded-full text-xs font-medium border transition-colors',
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
      <div className="flex flex-col gap-3 overflow-y-auto flex-1">
        {filtered.map((task) => {
          const isSelected = selectedTaskId === task.id;
          const status = taskStatusOverrides[task.id] ?? task.status;
          const isScheduled = scheduledTasks[task.id];
          const assignee = (members ?? []).find((m) => m.id === task.assigneeId);

          return (
            <button
              key={task.id}
              onClick={() => setSelectedTaskId(task.id)}
              className={cn(
                'relative text-left w-full p-4 rounded-xl border transition-all duration-200',
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
                <div className="absolute top-3 right-3">
                  <Clock className="w-4 h-4 text-muted-foreground" />
                </div>
              )}

              <div className="flex items-start gap-3">
                {/* Priority badge */}
                <span
                  className={cn(
                    'text-xs font-mono font-medium px-2 py-0.5 rounded border flex-shrink-0 mt-0.5',
                    getPriorityColor(task.priority)
                  )}
                >
                  {task.priority}
                </span>

                <div className="flex-1 min-w-0">
                  <p
                    className={cn(
                      'text-base font-heading font-semibold leading-tight',
                      status === 'covered' && 'line-through opacity-60'
                    )}
                  >
                    {task.title}
                  </p>

                  {/* Project breadcrumb */}
                  <p className="text-xs font-mono text-muted-foreground mt-1 truncate">
                    {task.projectName}
                  </p>

                  <div className="flex items-center gap-2 mt-2">
                    <DeadlineLabel deadline={task.deadline} />

                    {/* Original assignee avatar with strikethrough */}
                    {assignee && (
                      <div className="flex items-center gap-1">
                        <div className="w-5 h-5 rounded-full bg-bg-surface2 border border-border flex items-center justify-center text-[9px] font-bold opacity-60">
                          {getInitials(assignee.name)}
                        </div>
                        <span className="text-xs text-muted-foreground line-through opacity-65">
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
