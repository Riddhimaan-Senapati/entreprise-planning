'use client';

import { useEffect, useState, useRef } from 'react';
import { toast } from 'sonner';
import { formatDistanceToNow, differenceInHours } from 'date-fns';
import { useTasks, useTeamMembers } from '@/hooks/use-api';
import { Task } from '@/lib/types';
import { cn, getPriorityColor } from '@/lib/utils';
import { useAppStore } from '@/store';
import { createTask, deleteTask } from '@/lib/api-client';
import { Clock, Plus, Trash2, X } from 'lucide-react';

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
        isPast || isUrgent ? 'text-status-red' : 'text-muted-foreground'
      )}
    >
      due {label}
    </span>
  );
}

const PRIORITIES = ['P0', 'P1', 'P2'] as const;
type Priority = (typeof PRIORITIES)[number];

const PRIORITY_ACTIVE: Record<Priority, string> = {
  P0: 'bg-status-red/20 text-status-red border-status-red/40',
  P1: 'bg-status-amber/20 text-status-amber border-status-amber/40',
  P2: 'bg-status-yellow/20 text-status-yellow border-status-yellow/40',
};

interface AddTaskFormProps {
  memberOptions: { id: string; name: string }[];
  onCreated: (task: Task) => void;
  onCancel: () => void;
}

function AddTaskForm({ memberOptions, onCreated, onCancel }: AddTaskFormProps) {
  const [title, setTitle] = useState('');
  const [project, setProject] = useState('');
  const [priority, setPriority] = useState<Priority>('P1');
  const [deadline, setDeadline] = useState('');
  // '' = no assignee (unassigned); otherwise a member id
  const [assigneeId, setAssigneeId] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => { titleRef.current?.focus(); }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !project.trim() || !deadline) {
      setError('Title, project, and deadline are required.');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      const task = await createTask({
        title: title.trim(),
        projectName: project.trim(),
        priority,
        deadline: new Date(deadline).toISOString(),
        assigneeId: assigneeId || null,
      });
      onCreated(task);
    } catch {
      setError('Failed to create task. Is the backend running?');
      setSubmitting(false);
    }
  };

  const inputCls = 'w-full bg-bg-base border border-border rounded-lg px-2.5 py-1.5 text-xs text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:border-status-green/40 transition-colors';

  return (
    <form
      onSubmit={handleSubmit}
      className="mb-4 p-3 rounded-xl bg-bg-surface border border-status-green/20 space-y-2.5"
    >
      <p className="text-xs font-medium text-foreground">New task</p>

      <input
        ref={titleRef}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Task title"
        className={inputCls}
      />

      <input
        value={project}
        onChange={(e) => setProject(e.target.value)}
        placeholder="Project name"
        className={inputCls}
      />

      {/* Priority toggle */}
      <div className="flex items-center gap-1.5">
        <span className="text-[10px] font-mono text-muted-foreground mr-1">Priority</span>
        {PRIORITIES.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => setPriority(p)}
            className={cn(
              'px-2.5 py-1 rounded-full text-[10px] font-mono font-medium border transition-colors',
              priority === p
                ? PRIORITY_ACTIVE[p]
                : 'bg-transparent text-muted-foreground border-border hover:text-foreground'
            )}
          >
            {p}
          </button>
        ))}
      </div>

      {/* Deadline + Assignee */}
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-[10px] font-mono text-muted-foreground block mb-1">Deadline</label>
          <input
            type="date"
            value={deadline}
            onChange={(e) => setDeadline(e.target.value)}
            className={cn(inputCls, 'text-foreground [color-scheme:dark]')}
          />
        </div>
        <div>
          <label className="text-[10px] font-mono text-muted-foreground block mb-1">
            Assignee <span className="text-muted-foreground/50">(optional)</span>
          </label>
          <select
            value={assigneeId}
            onChange={(e) => setAssigneeId(e.target.value)}
            className={cn(inputCls, 'cursor-pointer')}
          >
            <option value="">— Unassigned (find candidates)</option>
            {memberOptions.map((m) => (
              <option key={m.id} value={m.id}>{m.name}</option>
            ))}
          </select>
        </div>
      </div>

      {error && <p className="text-[10px] font-mono text-status-red">{error}</p>}

      <div className="flex gap-2 pt-0.5">
        <button
          type="submit"
          disabled={submitting}
          className="flex-1 py-1.5 rounded-lg bg-status-green text-bg-base text-xs font-medium hover:bg-status-green/90 transition-colors disabled:opacity-50"
        >
          {submitting ? 'Adding…' : 'Add Task'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="px-3 py-1.5 rounded-lg border border-border text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

export default function TaskList({ initialTaskId }: TaskListProps) {
  const { selectedTaskId, setSelectedTaskId, priorityFilter, setPriorityFilter, taskStatusOverrides, scheduledTasks, setPipelineRunning } = useAppStore();
  const { data: tasks, refetch: refetchTasks } = useTasks();
  const { data: members } = useTeamMembers();
  const [showForm, setShowForm] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

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

  const memberOptions = (members ?? []).map((m) => ({ id: m.id, name: m.name }));

  const handleCreated = (task: Task) => {
    setShowForm(false);
    setSelectedTaskId(task.id);
    // If unassigned, mark pipeline as running so the loading banner + polling start immediately
    if (!task.assigneeId) {
      setPipelineRunning(task.id, true);
    }
    refetchTasks();
  };

  const handleDelete = async (e: React.MouseEvent, taskId: string) => {
    e.stopPropagation(); // don't select the task
    setDeletingId(taskId);
    try {
      await deleteTask(taskId);
      if (selectedTaskId === taskId) setSelectedTaskId(null);
      refetchTasks();
    } catch (err) {
      toast.error('Failed to delete task', {
        description: err instanceof Error ? err.message : 'Check that the backend is running.',
        duration: 4000,
      });
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Filter pills + add button */}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
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
        <button
          onClick={() => setShowForm((v) => !v)}
          title={showForm ? 'Cancel' : 'Add task'}
          className={cn(
            'ml-auto flex items-center gap-1 px-2.5 py-1.5 rounded-full text-xs font-medium border transition-colors',
            showForm
              ? 'bg-bg-surface2 text-muted-foreground border-border'
              : 'bg-status-green/10 text-status-green border-status-green/30 hover:bg-status-green/20'
          )}
        >
          {showForm ? <X className="w-3 h-3" /> : <Plus className="w-3 h-3" />}
          {showForm ? 'Cancel' : 'Add'}
        </button>
      </div>

      {/* Inline add-task form */}
      {showForm && (
        <AddTaskForm
          memberOptions={memberOptions}
          onCreated={handleCreated}
          onCancel={() => setShowForm(false)}
        />
      )}

      {/* Task cards */}
      <div className="flex flex-col gap-3 overflow-y-auto flex-1">
        {filtered.map((task) => {
          const isSelected = selectedTaskId === task.id;
          const status = taskStatusOverrides[task.id] ?? task.status;
          const isScheduled = scheduledTasks[task.id];
          const assignee = (members ?? []).find((m) => m.id === task.assigneeId);

          return (
            <div
              key={task.id}
              role="button"
              tabIndex={0}
              onClick={() => setSelectedTaskId(task.id)}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setSelectedTaskId(task.id); }}
              className={cn(
                'relative text-left w-full p-4 rounded-xl border transition-all duration-200 cursor-pointer',
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

              {/* Delete button — only on covered tasks */}
              {status === 'covered' && (
                <button
                  onClick={(e) => handleDelete(e, task.id)}
                  disabled={deletingId === task.id}
                  title="Delete task"
                  className="absolute top-2.5 right-2.5 p-1 rounded-md text-muted-foreground hover:text-status-red hover:bg-status-red/10 transition-colors disabled:opacity-40"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
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
            </div>
          );
        })}
      </div>
    </div>
  );
}
