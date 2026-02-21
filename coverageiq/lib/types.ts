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
  calendarPct: number;       // 0-100, calendar integration fill %
  taskLoadHours: number;     // current task load in hours
  leaveStatus: 'available' | 'partial' | 'ooo';
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
}
