'use client';

import { useEffect } from 'react';
import { toast } from 'sonner';
import { Calendar, CheckCircle2, Loader2, RefreshCw, Send, UserMinus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useTasks, useTeamMembers } from '@/hooks/use-api';
import { Suggestion, Task, TeamMember } from '@/lib/types';
import { cn } from '@/lib/utils';
import { useAppStore } from '@/store';
import { reassignTask, sendAvailabilityPing, unassignTask } from '@/lib/api-client';

function getInitials(name: string) {
  return name.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2);
}

/** Combined score: 70% calendar availability + 30% skill match */
function getCombinedScore(skillMatchPct: number, calendarPct: number): number {
  return calendarPct * 0.7 + skillMatchPct * 0.3;
}

// ── Suggestion row (compact list style) ────────────────────────────────────────

interface SuggestionRowProps {
  suggestion: Suggestion;
  task: Task;
  member: TeamMember;
  rank: number;
  onReassign: (taskId: string, memberId: string) => void;
}

function SuggestionRow({ suggestion, task, member, rank, onReassign }: SuggestionRowProps) {
  const { setPingSent, pingSent } = useAppStore();
  const pingKey = `${task.id}:${member.id}`;
  const hasPingSent = pingSent[pingKey] ?? false;

  const calPct = member.dataSources.calendarPct;
  const freeHours = Math.round((calPct / 100) * 40);
  const combinedScore = getCombinedScore(suggestion.skillMatchPct, calPct);

  const calTextClass =
    calPct > 70 ? 'text-status-green' : calPct > 40 ? 'text-status-yellow' : 'text-status-red';
  const calBarColor =
    calPct > 70 ? '#818cf8' : calPct > 40 ? '#f5c842' : '#ff4d6a';

  const handleReassign = () => {
    onReassign(task.id, member.id);
    toast.success(`Task reassigned to ${member.name}`, {
      description: `${member.name} is now the owner. The task is marked covered.`,
      duration: 4000,
    });
  };

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
      setPingSent(task.id, member.id);
      toast.warning(`Ping saved locally — backend unreachable`, {
        description: `Start the FastAPI server and set SLACK_PING_USER_ID in .env to send real Slack DMs.`,
        duration: 6000,
      });
    }
  };

  return (
    <div className="p-4 border-b border-border last:border-b-0 hover:bg-bg-surface2/40 transition-colors">
      {/* Header: rank + avatar + name + skill number */}
      <div className="flex items-start gap-3 mb-3">
        {/* Rank */}
        <div className="w-5 h-5 rounded-full bg-bg-surface2 border border-border text-[10px] font-mono flex items-center justify-center text-muted-foreground flex-shrink-0 mt-1">
          {rank + 1}
        </div>

        {/* Avatar */}
        <div className="w-8 h-8 rounded-full bg-bg-surface2 border border-border text-xs font-bold font-heading flex items-center justify-center flex-shrink-0 text-foreground">
          {getInitials(member.name)}
        </div>

        {/* Name + role */}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold font-heading text-foreground leading-tight truncate">
            {member.name}
          </p>
          <p className="text-xs text-muted-foreground truncate">{member.role}</p>
        </div>

        {/* Skill match — number only */}
        <div className="text-right flex-shrink-0">
          <p className="text-sm font-mono font-bold text-status-green">{suggestion.skillMatchPct}%</p>
          <p className="text-[10px] text-muted-foreground">skill</p>
        </div>
      </div>

      {/* Calendar availability — PROMINENT */}
      <div className="mb-3 pl-8">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-xs text-muted-foreground flex items-center gap-1.5">
            <Calendar className="w-3 h-3" />
            Calendar free this week
          </span>
          <span className={cn('text-sm font-mono font-bold', calTextClass)}>
            {calPct}% <span className="text-xs font-normal text-muted-foreground">~{freeHours}h</span>
          </span>
        </div>
        <div className="h-2.5 rounded-full bg-bg-base overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-700"
            style={{ width: `${calPct}%`, backgroundColor: calBarColor }}
          />
        </div>
      </div>

      {/* AI note */}
      {suggestion.contextReason && (
        <p className="text-[11px] text-muted-foreground italic mb-3 pl-8 leading-relaxed">
          {suggestion.contextReason}
        </p>
      )}

      {/* Manager note */}
      {member.managerNotes && (
        <div className="pl-8 mb-3">
          <p className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider mb-0.5">
            Manager Note
          </p>
          <p className="text-xs text-foreground leading-relaxed">{member.managerNotes}</p>
        </div>
      )}

      {/* Pending ping banner */}
      {hasPingSent && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-status-green/10 border border-status-green/20 text-status-green text-xs mb-3 ml-8">
          <Send className="w-3 h-3 flex-shrink-0" />
          Waiting for {member.name.split(' ')[0]} to confirm — you can still hard-reassign if urgent.
        </div>
      )}

      {/* Action buttons */}
      <div className="flex gap-2 pl-8">
        <Button
          size="sm"
          onClick={handleReassign}
          className="flex-1 bg-status-green text-bg-base hover:bg-status-green/90 text-xs h-8 font-medium"
        >
          <CheckCircle2 className="w-3.5 h-3.5 mr-1" />
          Reassign
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={handleAskFirst}
          disabled={hasPingSent}
          className={cn(
            'flex-1 text-xs h-8 border-border',
            hasPingSent
              ? 'text-status-green border-status-green/30 opacity-60 cursor-not-allowed'
              : 'text-foreground hover:bg-bg-surface2'
          )}
          title="Sends a Slack DM asking this person to confirm they can take the task."
        >
          <Send className="w-3.5 h-3.5 mr-1" />
          {hasPingSent ? 'Asked ✓' : 'Check availability'}
        </Button>
      </div>
    </div>
  );
}

// ── Panel ─────────────────────────────────────────────────────────────────────

export default function SuggestionPanel() {
  const { selectedTaskId, taskStatusOverrides, pipelineRunning, setPipelineRunning, setTaskStatus } =
    useAppStore();

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
    setTaskStatus(task.id, 'unassigned');
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

  // Sort by combined score descending (best first: highest skill + calendar availability)
  const sortedSuggestions = [...task.suggestions]
    .map((s) => {
      const member = (members ?? []).find((m) => m.id === s.memberId);
      const calPct = member?.dataSources.calendarPct ?? 0;
      return { ...s, _combined: getCombinedScore(s.skillMatchPct, calPct) };
    })
    .sort((a, b) => b._combined - a._combined);

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

      {/* Suggestions list */}
      {!isCovered && !isRunning && (
        <>
          {sortedSuggestions.length > 0 ? (
            <>
              <p className="text-sm text-muted-foreground font-medium px-1">
                Suggested coverage —{' '}
                <span className="text-foreground">ranked by skill &amp; calendar availability</span>
              </p>
              <div className="rounded-xl border border-border bg-bg-surface overflow-hidden">
                {sortedSuggestions.map((s, i) => {
                  const member = (members ?? []).find((m) => m.id === s.memberId);
                  if (!member) return null;
                  return (
                    <SuggestionRow
                      key={s.memberId}
                      suggestion={s}
                      task={task}
                      member={member}
                      rank={i}
                      onReassign={handleReassign}
                    />
                  );
                })}
              </div>
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
