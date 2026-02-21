import { create } from 'zustand';
import { TaskStatus } from '@/lib/types';

interface ManualOverride {
  memberId: string;
  status: 'available' | 'partial' | 'ooo';
}

interface AppStore {
  // Selected task for task-command page
  selectedTaskId: string | null;
  setSelectedTaskId: (id: string | null) => void;

  // Active filter on the overview team grid
  teamFilter: 'all' | 'risks' | 'availability';
  setTeamFilter: (filter: 'all' | 'risks' | 'availability') => void;

  // Priority filter on task-command page
  priorityFilter: 'all' | 'P0' | 'P1' | 'P2';
  setPriorityFilter: (filter: 'all' | 'P0' | 'P1' | 'P2') => void;

  // Manual overrides for person status
  overrides: ManualOverride[];
  setOverride: (memberId: string, status: 'available' | 'partial' | 'ooo') => void;
  clearOverride: (memberId: string) => void;

  // Task status overrides (after reassign / schedule)
  taskStatusOverrides: Record<string, TaskStatus>;
  setTaskStatus: (taskId: string, status: TaskStatus) => void;

  // "Ask first" pings — keyed "taskId:memberId" so each task independently tracks who was asked
  pingSent: Record<string, boolean>;
  setPingSent: (taskId: string, memberId: string) => void;

  // "Schedule tomorrow" dimmed tasks
  scheduledTasks: Record<string, boolean>;
  setScheduled: (taskId: string) => void;

  // Tracks tasks whose skill pipeline is currently running in the background
  pipelineRunning: Record<string, boolean>;
  setPipelineRunning: (taskId: string, running: boolean) => void;
}

export const useAppStore = create<AppStore>((set) => ({
  selectedTaskId: null,
  setSelectedTaskId: (id) => set({ selectedTaskId: id }),

  teamFilter: 'all',
  setTeamFilter: (filter) => set({ teamFilter: filter }),

  priorityFilter: 'all',
  setPriorityFilter: (filter) => set({ priorityFilter: filter }),

  overrides: [],
  setOverride: (memberId, status) =>
    set((state) => ({
      overrides: [
        ...state.overrides.filter((o) => o.memberId !== memberId),
        { memberId, status },
      ],
    })),
  clearOverride: (memberId) =>
    set((state) => ({
      overrides: state.overrides.filter((o) => o.memberId !== memberId),
    })),

  taskStatusOverrides: {},
  setTaskStatus: (taskId, status) =>
    set((state) => ({
      taskStatusOverrides: { ...state.taskStatusOverrides, [taskId]: status },
    })),

  pingSent: {},
  setPingSent: (taskId, memberId) =>
    set((state) => ({
      pingSent: { ...state.pingSent, [`${taskId}:${memberId}`]: true },
    })),

  scheduledTasks: {},
  setScheduled: (taskId) =>
    set((state) => ({
      scheduledTasks: { ...state.scheduledTasks, [taskId]: true },
    })),

  pipelineRunning: {},
  setPipelineRunning: (taskId, running) =>
    set((state) => ({
      pipelineRunning: { ...state.pipelineRunning, [taskId]: running },
    })),
}));
