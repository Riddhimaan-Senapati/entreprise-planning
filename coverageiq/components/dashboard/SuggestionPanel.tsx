'use client';

import { useEffect } from 'react';
import { toast } from 'sonner';
import { CheckCircle2, Loader2, RefreshCw, Send, UserMinus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import ConfidenceRing from './ConfidenceRing';
import { useTasks, useTeamMembers } from '@/hooks/use-api';
import { Suggestion, Task, TeamMember } from '@/lib/types';
import { cn } from '@/lib/utils';
import { useAppStore } from '@/store';
import { reassignTask, sendAvailabilityPing, unassignTask } from '@/lib/api-client';

function getInitials(name: string) {
  return name.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2);
}

interface SuggestionCardProps {
  suggestion: Suggestion;
  task: Task;
  member: TeamMember;
  rank: number;
  onReassign: (taskId: string, memberId: string) => void;
}

function SuggestionCard({ suggestion, task, member, rank, onReassign }: SuggestionCardProps) {
  const { setPingSent, pingSent } = useAppStore();

  // Keyed by "taskId:memberId" — asking someone about Task A doesn't affect their button on Task B
  const pingKey = `${task.id}:${member.id}`;
  const hasPingSent = pingSent[pingKey] ?? false;

  const handleReassign = () => {
    onReassign(task.id, member.id);
    toast.success(`Task reassigned to ${member.name}`, {
      description: `${member.name} is now the owner. The task is marked covered.`,
      duration: 4000,
    });
  };

  // Sends a real Slack DM via the /ping endpoint asking the person to confirm availability
  // before committing the hard reassignment. Locks per task+person so you can't double-ping.
  const handleAskFirst = async () => {
    try {
      await sendAvailabilityPing({
        member_name: member.name,
        task_title: task.title,
        project_name: task.projectName,
        priority: task.priority,
        deadline: task.deadline instanceof Date
          ? task.deadline.toISOString()
          : String(task.deadline),
        context_reason: suggestion.contextReason,
      });
      setPingSent(task.id, member.id);
      toast.info(`Availability check sent to ${member.name}`, {
        description: `${member.name} will receive a Slack DM asking if they can cover this task.`,
        duration: 5000,
      });
    } catch {
      // Backend not running or SLACK_PING_USER_ID not set — still mark ping in local state
      // so the UI locks the button, and show an explanatory toast.
      setPingSent(task.id, member.id);
      toast.warning(`Ping saved locally — backend unreachable`, {
        description: `Start the FastAPI server and set SLACK_PING_USER_ID in .env to send real Slack DMs.`,
        duration: 6000,
      });
    }
  };

  return (
    <div className="p-5 rounded-xl bg-bg-surface border border-border space-y-4 hover:border-border/60 transition-colors">
      {/* Header */}
      <div className="flex items-center gap-3">
        <ConfidenceRing score={member.confidenceScore} size={52} strokeWidth={3} index={rank}>
          <div className="flex items-center justify-center w-[38px] h-[38px] rounded-full bg-bg-surface2 text-xs font-bold font-heading text-foreground">
            {getInitials(member.name)}
          </div>
        </ConfidenceRing>
        <div className="flex-1 min-w-0">
          <p className="text-base font-semibold font-heading truncate">{member.name}</p>
          <p className="text-xs text-muted-foreground truncate">{member.role}</p>
        </div>
        <div className="text-right flex-shrink-0">
          <p className="text-sm font-mono text-status-green">{suggestion.skillMatchPct}%</p>
          <p className="text-xs text-muted-foreground">skill match</p>
        </div>
      </div>

      {/* Skill match bar */}
      <div className="space-y-1.5">
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>Skill match</span>
          <span className="font-mono text-status-green">{suggestion.skillMatchPct}%</span>
        </div>
        <div className="h-1.5 rounded-full bg-bg-surface2 overflow-hidden">
          <div
            className="h-full rounded-full bg-status-green transition-all duration-700"
            style={{ width: `${suggestion.skillMatchPct}%` }}
          />
        </div>
      </div>

      {/* Workload bar */}
      <div className="space-y-1.5">
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>Current workload</span>
          <span className="font-mono text-status-amber">{suggestion.workloadPct}%</span>
        </div>
        <div className="h-1.5 rounded-full bg-bg-surface2 overflow-hidden">
          <div
            className="h-full rounded-full bg-status-amber transition-all duration-700"
            style={{ width: `${suggestion.workloadPct}%` }}
          />
        </div>
      </div>

      {/* Notes */}
      <div className="space-y-2.5">
        <div>
          <p className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider mb-1">AI Note</p>
          <p className="text-sm text-muted-foreground italic leading-relaxed">{suggestion.contextReason}</p>
        </div>
        {member.managerNotes && (
          <div>
            <p className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider mb-1">Manager Note</p>
            <p className="text-sm text-foreground leading-relaxed">{member.managerNotes}</p>
          </div>
        )}
      </div>

      {/* Pending ping banner */}
      {hasPingSent && (
        <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg bg-status-green/10 border border-status-green/20 text-status-green text-sm">
          <Send className="w-4 h-4 flex-shrink-0" />
          <span>
            Waiting for {member.name.split(' ')[0]} to confirm — you can still hard-reassign
            if urgent.
          </span>
        </div>
      )}

      {/* Action buttons */}
      <div className="flex gap-2 pt-1">
        <Button
          size="sm"
          onClick={handleReassign}
          className="flex-1 bg-status-green text-bg-base hover:bg-status-green/90 text-sm h-9 font-medium"
        >
          <CheckCircle2 className="w-4 h-4 mr-1.5" />
          Reassign
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={handleAskFirst}
          disabled={hasPingSent}
          className={cn(
            'flex-1 text-sm h-9 border-border',
            hasPingSent
              ? 'text-status-green border-status-green/30 opacity-60 cursor-not-allowed'
              : 'text-foreground hover:bg-bg-surface2'
          )}
          title="Sends a notification to this person asking them to confirm they can take the task — a softer step before hard-reassigning."
        >
          <Send className="w-4 h-4 mr-1.5" />
          {hasPingSent ? 'Asked ✓' : 'Check availability'}
        </Button>
      </div>
    </div>
  );
}

export default function SuggestionPanel() {
  const { selectedTaskId, taskStatusOverrides, pipelineRunning, setPipelineRunning, setTaskStatus } = useAppStore();

  const { data: tasks, refetch: refetchTasks } = useTasks();
  const { data: members } = useTeamMembers();

  const task = (tasks ?? []).find((t) => t.id === selectedTaskId);
  const taskSuggestionsLength = task?.suggestions.length ?? 0;

  // Auto-poll every 4s while the pipeline is running for this task
  useEffect(() => {
    if (!selectedTaskId || !(pipelineRunning[selectedTaskId] ?? false)) return;
    const id = setInterval(() => refetchTasks(), 4000);
    return () => clearInterval(id);
  }, [selectedTaskId, pipelineRunning, refetchTasks]);

  // Auto-clear pipelineRunning when suggestions arrive
  useEffect(() => {
    if (!selectedTaskId || taskSuggestionsLength === 0) return;
    if (pipelineRunning[selectedTaskId] ?? false) {
      setPipelineRunning(selectedTaskId, false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTaskId, taskSuggestionsLength]);

  if (!selectedTaskId) {
    return (
      <div className="flex flex-col items-center justify-center h-full min-h-[400px] text-center px-8">
        <div className="w-16 h-16 rounded-2xl bg-bg-surface border border-border flex items-center justify-center mb-4">
          <span className="text-2xl">⚡</span>
        </div>
        <p className="text-base font-heading font-semibold text-foreground mb-2">
          Select a task to triage
        </p>
        <p className="text-sm text-muted-foreground leading-relaxed">
          Choose a task from the list to see AI-ranked coverage suggestions based on skills and
          availability.
        </p>
      </div>
    );
  }

  // selectedTaskId is set but tasks haven't loaded the new task yet — show spinner
  if (!task) {
    return (
      <div className="flex items-center justify-center h-full min-h-[400px]">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const currentStatus = taskStatusOverrides[selectedTaskId] ?? task.status;
  const isCovered = currentStatus === 'covered';
  const isRunning = pipelineRunning[selectedTaskId] ?? false;

  const handleReassign = async (taskId: string, memberId: string) => {
    setTaskStatus(taskId, 'covered');
    try {
      await reassignTask(taskId, memberId);
      refetchTasks();
    } catch {
      toast.error('Failed to reassign task.');
    }
  };

  const handleUnassign = async () => {
    setTaskStatus(task.id, 'unassigned');    // optimistic
    setPipelineRunning(task.id, true);
    try {
      await unassignTask(task.id);
      toast.info('Assignee removed — scoring candidates…', {
        description: 'The skill pipeline is running in the background. Refresh in ~30s to see suggestions.',
        duration: 6000,
      });
    } catch {
      toast.error('Failed to unassign task.');
      setPipelineRunning(task.id, false);
    }
  };

  const handleRefreshSuggestions = () => {
    setPipelineRunning(task.id, false);
    refetchTasks();
  };

  const sortedSuggestions = [...task.suggestions].sort(
    (a, b) => b.skillMatchPct - a.skillMatchPct
  );

  return (
    <div className="flex flex-col gap-5">
      {/* Panel header */}
      <div className="p-5 rounded-xl bg-bg-surface border border-border">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <p className="text-sm text-muted-foreground font-mono mb-1 truncate">{task.projectName}</p>
            <h3 className="text-lg font-heading font-bold text-foreground leading-tight">
              {task.title}
            </h3>
            {task.assigneeId && (
              <p className="text-xs text-muted-foreground mt-1">
                Assigned to{' '}
                <span className="text-foreground font-medium">
                  {(members ?? []).find((m) => m.id === task.assigneeId)?.name ?? task.assigneeId}
                </span>
              </p>
            )}
          </div>
          <div className="flex flex-col items-end gap-2 flex-shrink-0">
            {isCovered ? (
              <span className="text-xs font-mono px-2.5 py-1 rounded-full bg-status-green/10 text-status-green border border-status-green/30">
                Covered ✓
              </span>
            ) : (
              <span className="text-xs font-mono px-2.5 py-1 rounded-full bg-status-red/10 text-status-red border border-status-red/30">
                {task.priority} · {currentStatus === 'unassigned' ? 'Unassigned' : 'At Risk'}
              </span>
            )}
            {/* Unassign button — shown when there is an assignee */}
            {task.assigneeId && (
              <button
                onClick={handleUnassign}
                className="flex items-center gap-1 text-[10px] font-mono text-muted-foreground hover:text-status-amber transition-colors"
                title="Remove assignee and re-score candidates"
              >
                <UserMinus className="w-3 h-3" />
                Unassign
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Pipeline running banner */}
      {isRunning && (
        <div className="flex items-center justify-between gap-3 px-4 py-3 rounded-xl bg-bg-surface border border-border">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin flex-shrink-0" />
            Scoring candidates with Gemini AI…
          </div>
          <button
            onClick={handleRefreshSuggestions}
            className="flex items-center gap-1 text-xs font-mono text-status-green hover:text-status-green/80 transition-colors flex-shrink-0"
          >
            <RefreshCw className="w-3 h-3" />
            Refresh
          </button>
        </div>
      )}

      {/* Suggestions */}
      {!isCovered && !isRunning && (
        <>
          {sortedSuggestions.length > 0 ? (
            <>
              <p className="text-sm text-muted-foreground font-medium px-1">
                Suggested coverage — sorted by skill match
              </p>
              {sortedSuggestions.map((s, i) => {
                const member = (members ?? []).find((m) => m.id === s.memberId);
                if (!member) return null;
                return (
                  <SuggestionCard key={s.memberId} suggestion={s} task={task} member={member} rank={i} onReassign={handleReassign} />
                );
              })}
            </>
          ) : (
            <div className="flex flex-col items-center justify-center py-10 text-center">
              <Loader2 className="w-8 h-8 text-muted-foreground mb-3 animate-spin" />
              <p className="text-sm font-heading font-semibold text-foreground">
                Scoring candidates…
              </p>
              <p className="text-xs text-muted-foreground mt-1 mb-4">
                The skill pipeline is running in the background.
              </p>
              <button
                onClick={() => refetchTasks()}
                className="flex items-center gap-1.5 text-xs font-mono text-status-green hover:text-status-green/80 transition-colors"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                Refresh suggestions
              </button>
            </div>
          )}
        </>
      )}

      {isCovered && (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <CheckCircle2 className="w-12 h-12 text-status-green mb-3" />
          <p className="text-base font-heading font-semibold text-foreground">Task covered!</p>
          <p className="text-sm text-muted-foreground mt-1">
            This task has been successfully reassigned.
          </p>
        </div>
      )}
    </div>
  );
}
