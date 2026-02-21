'use client';

import { toast } from 'sonner';
import { CheckCircle2, Clock, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import ConfidenceRing from './ConfidenceRing';
import { useTasks, useTeamMembers } from '@/hooks/use-api';
import { Suggestion, Task, TeamMember } from '@/lib/types';
import { cn } from '@/lib/utils';
import { useAppStore } from '@/store';
import { sendAvailabilityPing, updateTaskStatus } from '@/lib/api-client';

function getInitials(name: string) {
  return name.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2);
}

interface SuggestionCardProps {
  suggestion: Suggestion;
  task: Task;
  member: TeamMember;
  rank: number;
}

function SuggestionCard({ suggestion, task, member, rank }: SuggestionCardProps) {
  const { setTaskStatus, setPingSent, setScheduled, pingSent, scheduledTasks } = useAppStore();

  // Keyed by "taskId:memberId" — asking someone about Task A doesn't affect their button on Task B
  const pingKey = `${task.id}:${member.id}`;
  const hasPingSent = pingSent[pingKey] ?? false;
  const isTaskScheduled = scheduledTasks[task.id];

  const handleReassign = () => {
    setTaskStatus(task.id, 'covered');                    // optimistic
    updateTaskStatus(task.id, 'covered').catch(() => {}); // persist
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

  const handleSchedule = () => {
    setScheduled(task.id);
    toast(`Deferred to tomorrow`, {
      description: "This task moves to tomorrow's queue and is dimmed in the list.",
      duration: 3000,
    });
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

      {/* Context reason */}
      <p className="text-sm text-muted-foreground italic leading-relaxed">
        {suggestion.contextReason}
      </p>

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
        <Button
          size="sm"
          variant="ghost"
          onClick={handleSchedule}
          disabled={isTaskScheduled}
          className="flex-1 text-sm h-9 text-muted-foreground hover:text-foreground"
          title="Defer this task to tomorrow's queue."
        >
          <Clock className="w-4 h-4 mr-1.5" />
          Tomorrow
        </Button>
      </div>
    </div>
  );
}

export default function SuggestionPanel() {
  const { selectedTaskId, taskStatusOverrides } = useAppStore();
  const { data: tasks } = useTasks();
  const { data: members } = useTeamMembers();

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

  const task = (tasks ?? []).find((t) => t.id === selectedTaskId);
  if (!task) return null;

  const currentStatus = taskStatusOverrides[selectedTaskId] ?? task.status;
  const isCovered = currentStatus === 'covered';

  const sortedSuggestions = [...task.suggestions].sort(
    (a, b) => b.skillMatchPct - a.skillMatchPct
  );

  return (
    <div className="flex flex-col gap-5">
      {/* Panel header */}
      <div className="p-5 rounded-xl bg-bg-surface border border-border">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm text-muted-foreground font-mono mb-1">{task.projectName}</p>
            <h3 className="text-lg font-heading font-bold text-foreground leading-tight">
              {task.title}
            </h3>
          </div>
          {isCovered ? (
            <span className="flex-shrink-0 text-xs font-mono px-2.5 py-1 rounded-full bg-status-green/10 text-status-green border border-status-green/30">
              Covered ✓
            </span>
          ) : (
            <span className="flex-shrink-0 text-xs font-mono px-2.5 py-1 rounded-full bg-status-red/10 text-status-red border border-status-red/30">
              {task.priority} · At Risk
            </span>
          )}
        </div>
      </div>

      {/* Suggestions */}
      {!isCovered && (
        <>
          <p className="text-sm text-muted-foreground font-medium px-1">
            Suggested coverage — sorted by skill match
          </p>
          {sortedSuggestions.map((s, i) => {
            const member = (members ?? []).find((m) => m.id === s.memberId);
            if (!member) return null;
            return (
              <SuggestionCard key={s.memberId} suggestion={s} task={task} member={member} rank={i} />
            );
          })}
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
