export type TeamName = 'Engineering' | 'Design' | 'Product';
export type Priority = 'P0' | 'P1' | 'P2';
export type TaskStatus = 'at-risk' | 'unassigned' | 'covered';

export interface Suggestion {
  memberId: string;
  skillMatchPct: number;
  workloadPct: number;
  contextReason: string;
}

export interface Task {
  id: string;
  title: string;
  priority: Priority;
  assigneeId: string | null;
  deadline: Date;
  projectName: string;
  status: TaskStatus;
  suggestions: Suggestion[];
}

export interface DataSourceSignal {
  calendarPct: number;       // 0-100, percentage of work week that is free
  taskLoadHours?: number;    // retained for backend compat, not displayed
  leaveStatus: 'available' | 'ooo';
}

export interface WeekAvailability {
  monday: number;    // 0-100 availability score
  tuesday: number;
  wednesday: number;
  thursday: number;
  friday: number;
}

export interface TeamMember {
  id: string;
  name: string;
  role: string;
  team: TeamName;
  confidenceScore: number;   // 0-100
  skills: string[];
  dataSources: DataSourceSignal;
  currentTasks: Task[];
  isOOO: boolean;
  lastSynced: Date;
  weekAvailability: WeekAvailability;
  manuallyOverridden?: boolean;  // true when leave status was manually set via override
  managerNotes?: string;
  slackOooStart?: Date | null;   // Slack-sourced OOO start (may be future)
  slackOooUntil?: Date | null;   // Slack-sourced OOO end
}

// ── Slack time-off sync ────────────────────────────────────────────────────────

export interface MemberOOOChange {
  memberId:       string;
  memberName:     string;
  personUsername: string;
  startDate:      string | null;
  endDate:        string | null;
  reason:         string | null;
  coverageBy:     string | null;
  pending:        boolean;  // true when start_date is still in the future
}

export interface TimeOffSyncResult {
  detected: number;  // Slack messages classified as time-off
  applied:  number;  // matched to a known team member
  pending:  number;  // applied but start_date is in the future
  skipped:  number;  // detected but couldn't match or already passed
  changes:  MemberOOOChange[];
}

export interface TimeOffEntry {
  sentAt:           string;
  sender:           string;
  message:          string;
  personUsername:   string;
  startDate:        string | null;
  endDate:          string | null;
  reason:           string | null;
  coverageUsername: string | null;
  notes:            string | null;
}
