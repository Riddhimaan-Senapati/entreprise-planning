'use client';

import { toast } from 'sonner';
import { CheckCircle2, Clock, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import ConfidenceRing from './ConfidenceRing';
import { atRiskTasks, teamMembers } from '@/lib/mock-data';
import { Suggestion } from '@/lib/types';
import { cn } from '@/lib/utils';
import { useAppStore } from '@/store';

function getInitials(name: string) {
  return name.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2);
}

interface SuggestionCardProps {
  suggestion: Suggestion;
  taskId: string;
  rank: number;
}

function SuggestionCard({ suggestion, taskId, rank }: SuggestionCardProps) {
  const member = teamMembers.find((m) => m.id === suggestion.memberId);
  const { setTaskStatus, setPingSent, setScheduled, pingSent, scheduledTasks } = useAppStore();

  if (!member) return null;

  // Keyed by "taskId:memberId" — asking someone about Task A doesn't affect their button on Task B
  const pingKey = `${taskId}:${member.id}`;
  const hasPingSent = pingSent[pingKey] ?? false;
  const isTaskScheduled = scheduledTasks[taskId];

  const handleReassign = () => {
    setTaskStatus(taskId, 'covered');
    toast.success(`Task reassigned to ${member.name}`, {
      description: `${member.name} is now the owner. The task is marked covered.`,
      duration: 4000,
    });
  };

  // Simulates sending a Slack/email notification asking the person to confirm availability
  // before committing the hard reassignment. Locks per task+person so you can't double-ping.
  const handleAskFirst = () => {
    setPingSent(taskId, member.id);
    toast.info(`Availability check sent to ${member.name}`, {
      description: `${member.name} will get a notification asking if they can cover this task. You can hard-reassign once they confirm.`,
      duration: 5000,
    });
  };

  const handleSchedule = () => {
    setScheduled(taskId);
    toast(`Deferred to tomorrow`, {
      description: "This task moves to tomorrow's queue and is dimmed in the list.",
      duration: 3000,
    });
  };

  return (
    <div className="p-4 rounded-xl bg-bg-surface border border-border space-y-3 hover:border-border/60 transition-colors">
      {/* Header */}
      <div className="flex items-center gap-3">
        <ConfidenceRing score={member.confidenceScore} size={44} strokeWidth={3} index={rank}>
          <div className="flex items-center justify-center w-[32px] h-[32px] rounded-full bg-bg-surface2 text-[10px] font-bold font-heading text-foreground">
            {getInitials(member.name)}
          </div>
        </ConfidenceRing>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold font-heading truncate">{member.name}</p>
          <p className="text-[11px] text-muted-foreground truncate">{member.role}</p>
        </div>
        <div className="text-right flex-shrink-0">
          <p className="text-xs font-mono text-status-green">{suggestion.skillMatchPct}%</p>
          <p className="text-[10px] text-muted-foreground">skill match</p>
        </div>
      </div>

      {/* Skill match bar */}
      <div className="space-y-1.5">
        <div className="flex justify-between text-[10px] text-muted-foreground">
          <span>Skill match</span>
          <span className="font-mono text-status-green">{suggestion.skillMatchPct}%</span>
        </div>
        <div className="h-1 rounded-full bg-bg-surface2 overflow-hidden">
          <div
            className="h-full rounded-full bg-status-green transition-all duration-700"
            style={{ width: `${suggestion.skillMatchPct}%` }}
          />
        </div>
      </div>

      {/* Workload bar */}
      <div className="space-y-1.5">
        <div className="flex justify-between text-[10px] text-muted-foreground">
          <span>Current workload</span>
          <span className="font-mono text-status-amber">{suggestion.workloadPct}%</span>
        </div>
        <div className="h-1 rounded-full bg-bg-surface2 overflow-hidden">
          <div
            className="h-full rounded-full bg-status-amber transition-all duration-700"
            style={{ width: `${suggestion.workloadPct}%` }}
          />
        </div>
      </div>

      {/* Context reason */}
      <p className="text-xs text-muted-foreground italic leading-relaxed">
        {suggestion.contextReason}
      </p>

      {/* Pending ping banner */}
      {hasPingSent && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-status-green/10 border border-status-green/20 text-status-green text-xs">
          <Send className="w-3.5 h-3.5 flex-shrink-0" />
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
          title="Sends a notification to this person asking them to confirm they can take the task — a softer step before hard-reassigning."
        >
          <Send className="w-3.5 h-3.5 mr-1" />
          {hasPingSent ? 'Asked ✓' : 'Check availability'}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={handleSchedule}
          disabled={isTaskScheduled}
          className="flex-1 text-xs h-8 text-muted-foreground hover:text-foreground"
          title="Defer this task to tomorrow's queue."
        >
          <Clock className="w-3.5 h-3.5 mr-1" />
          Tomorrow
        </Button>
      </div>
    </div>
  );
}

export default function SuggestionPanel() {
  const { selectedTaskId, taskStatusOverrides } = useAppStore();

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

  const task = atRiskTasks.find((t) => t.id === selectedTaskId);
  if (!task) return null;

  const currentStatus = taskStatusOverrides[selectedTaskId] ?? task.status;
  const isCovered = currentStatus === 'covered';

  const sortedSuggestions = [...task.suggestions].sort(
    (a, b) => b.skillMatchPct - a.skillMatchPct
  );

  return (
    <div className="flex flex-col gap-4">
      {/* Panel header */}
      <div className="p-4 rounded-xl bg-bg-surface border border-border">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs text-muted-foreground font-mono mb-1">{task.projectName}</p>
            <h3 className="text-base font-heading font-bold text-foreground leading-tight">
              {task.title}
            </h3>
          </div>
          {isCovered ? (
            <span className="flex-shrink-0 text-[10px] font-mono px-2 py-1 rounded-full bg-status-green/10 text-status-green border border-status-green/30">
              Covered ✓
            </span>
          ) : (
            <span className="flex-shrink-0 text-[10px] font-mono px-2 py-1 rounded-full bg-status-red/10 text-status-red border border-status-red/30">
              {task.priority} · At Risk
            </span>
          )}
        </div>
      </div>

      {/* Suggestions */}
      {!isCovered && (
        <>
          <p className="text-xs text-muted-foreground font-medium px-1">
            Suggested coverage — sorted by skill match
          </p>
          {sortedSuggestions.map((s, i) => (
            <SuggestionCard key={s.memberId} suggestion={s} taskId={task.id} rank={i} />
          ))}
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
