/**
 * api-client.ts
 * Typed fetch wrappers for the Vantage FastAPI backend.
 *
 * Set NEXT_PUBLIC_API_URL in .env.local (e.g. http://localhost:8000).
 * Defaults to http://localhost:8000 when the variable is absent.
 */

import type { TeamMember, Task, TimeOffSyncResult } from './types';

const BASE_URL =
  (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000').replace(/\/$/, '');

// ── Internal fetch helper ──────────────────────────────────────────────────────

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { 'Content-Type': 'application/json', ...init?.headers },
    ...init,
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`API ${res.status} ${res.statusText}: ${body}`);
  }

  // 204 No Content (e.g. DELETE) — no body to parse
  if (res.status === 204) return undefined as T;

  return res.json() as Promise<T>;
}

// ── Response helpers ────────────────────────────────────────────────────────────
// The backend returns ISO strings for datetime fields. These helpers coerce them
// to JS Date objects so callers can use the same TeamMember / Task interfaces.

function parseMember(raw: ApiTeamMember): TeamMember {
  return {
    ...raw,
    lastSynced: new Date(raw.lastSynced),
    currentTasks: raw.currentTasks.map(parseTask),
  };
}

function parseTask(raw: ApiTask): Task {
  return {
    ...raw,
    deadline: new Date(raw.deadline),
  };
}

// ── Wire types (dates as strings from JSON) ────────────────────────────────────

type ApiTask = Omit<Task, 'deadline'> & { deadline: string };
type ApiTeamMember = Omit<TeamMember, 'lastSynced' | 'currentTasks'> & {
  lastSynced: string;
  currentTasks: ApiTask[];
  icsLinked?: boolean;
};

// ── Summary ───────────────────────────────────────────────────────────────────

export interface Summary {
  ooo: number;
  fullyAvailable: number;
  criticalAtRisk: number;
  unresolvedReassignments: number;
  lastSynced: string;
}

// ── Members ───────────────────────────────────────────────────────────────────

export async function fetchMembers(): Promise<TeamMember[]> {
  const raw = await apiFetch<ApiTeamMember[]>('/members');
  return raw.map(parseMember);
}

export async function fetchMember(id: string): Promise<TeamMember> {
  const raw = await apiFetch<ApiTeamMember>(`/members/${id}`);
  return parseMember(raw);
}

export async function updateMemberOverride(
  id: string,
  leaveStatus: 'available' | 'ooo',
): Promise<TeamMember> {
  const raw = await apiFetch<ApiTeamMember>(`/members/${id}/override`, {
    method: 'PATCH',
    body: JSON.stringify({ leaveStatus }),
  });
  return parseMember(raw);
}

export async function deleteOverride(id: string): Promise<TeamMember> {
  const raw = await apiFetch<ApiTeamMember>(`/members/${id}/override`, { method: 'DELETE' });
  return parseMember(raw);
}

export async function syncMemberCalendar(id: string): Promise<TeamMember> {
  const raw = await apiFetch<ApiTeamMember>(`/members/${id}/calendar/sync`, {
    method: 'POST',
  });
  return parseMember(raw);
}

export async function updateMemberNotes(id: string, notes: string): Promise<TeamMember> {
  const raw = await apiFetch<ApiTeamMember>(`/members/${id}/notes`, {
    method: 'PATCH',
    body: JSON.stringify({ notes }),
  });
  return parseMember(raw);
}

export async function updateMemberSkills(id: string, skills: string[]): Promise<TeamMember> {
  const raw = await apiFetch<ApiTeamMember>(`/members/${id}/skills`, {
    method: 'PATCH',
    body: JSON.stringify({ skills }),
  });
  return parseMember(raw);
}

/** Returns the raw ICS availability report (does not update DB). */
export function fetchMemberAvailability(id: string) {
  return apiFetch<Record<string, unknown>>(`/members/${id}/availability`);
}

// ── Tasks ─────────────────────────────────────────────────────────────────────

export interface TaskCreatePayload {
  title: string;
  priority: 'P0' | 'P1' | 'P2';
  assigneeId: string | null; // null → unassigned (pipeline finds candidates); provided → covered
  deadline: string;          // ISO 8601 string
  projectName: string;
}

export async function createTask(payload: TaskCreatePayload): Promise<Task> {
  const raw = await apiFetch<ApiTask>('/tasks', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  return parseTask(raw);
}

export async function unassignTask(id: string): Promise<Task> {
  const raw = await apiFetch<ApiTask>(`/tasks/${id}/unassign`, { method: 'PATCH' });
  return parseTask(raw);
}

export async function reassignTask(id: string, memberId: string): Promise<Task> {
  const raw = await apiFetch<ApiTask>(`/tasks/${id}/reassign`, {
    method: 'PATCH',
    body: JSON.stringify({ memberId }),
  });
  return parseTask(raw);
}

export async function deleteTask(id: string): Promise<void> {
  await apiFetch<void>(`/tasks/${id}`, { method: 'DELETE' });
}

export async function fetchTasks(status?: string): Promise<Task[]> {
  const q = status ? `?status=${encodeURIComponent(status)}` : '';
  const raw = await apiFetch<ApiTask[]>(`/tasks${q}`);
  return raw.map(parseTask);
}

export async function fetchTask(id: string): Promise<Task> {
  const raw = await apiFetch<ApiTask>(`/tasks/${id}`);
  return parseTask(raw);
}

export async function updateTaskStatus(
  id: string,
  status: 'at-risk' | 'unassigned' | 'covered',
): Promise<Task> {
  const raw = await apiFetch<ApiTask>(`/tasks/${id}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  });
  return parseTask(raw);
}

// ── Summary ───────────────────────────────────────────────────────────────────

export function fetchSummary(): Promise<Summary> {
  return apiFetch<Summary>('/summary');
}

// ── Slack time-off sync ────────────────────────────────────────────────────────

/**
 * Triggers a Slack channel scan for time-off announcements.
 * Fetches recent Slack messages, runs them through Gemini AI, fuzzy-matches
 * each person to a team member, and updates their leave_status in the DB.
 *
 * @param hours How many hours of Slack history to scan (default 24).
 * @returns TimeOffSyncResult with counts and the list of detected OOO members.
 */
export function triggerSlackSync(hours = 24): Promise<TimeOffSyncResult> {
  return apiFetch<TimeOffSyncResult>(`/timeoff/sync?hours=${hours}`, {
    method: 'POST',
  });
}

// ── Gmail OOO scanning ────────────────────────────────────────────────────────

/**
 * Triggers a Gmail inbox scan for OOO emails.
 * The backend pre-filters by OOO keywords before calling Gemini, so only
 * relevant emails consume AI quota.
 *
 * @param maxResults Max emails to retrieve from Gmail search (default 100).
 * @returns TimeOffSyncResult with counts and the list of detected OOO members.
 */
export function triggerGmailScan(maxResults = 100): Promise<TimeOffSyncResult> {
  return apiFetch<TimeOffSyncResult>(`/gmail/scan?max_results=${maxResults}`, {
    method: 'POST',
  });
}

// ── Slack ping ────────────────────────────────────────────────────────────────

export interface PingPayload {
  member_name: string;
  task_title: string;
  project_name?: string;
  priority?: string;
  deadline?: string;
  context_reason?: string;
}

export interface PingResult {
  ok: boolean;
  message_ts: string;
  channel: string;
}

export function sendAvailabilityPing(body: PingPayload): Promise<PingResult> {
  return apiFetch<PingResult>('/ping', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}
