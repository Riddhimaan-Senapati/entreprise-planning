/**
 * hooks/use-api.ts
 * React hooks for fetching data from the CoverageIQ backend.
 *
 * Each hook returns { data, loading, error, refetch }.
 * Pass `enabled: false` to skip the initial fetch (useful when waiting on a
 * user action before loading).
 */

'use client';

import { useCallback, useEffect, useState } from 'react';
import type { TeamMember, Task } from '@/lib/types';
import {
  fetchMembers,
  fetchMember,
  fetchTasks,
  fetchSummary,
  syncMemberCalendar,
  updateMemberOverride,
  updateTaskStatus,
  type Summary,
} from '@/lib/api-client';

// ── Generic fetch state ────────────────────────────────────────────────────────

interface FetchState<T> {
  data: T | null;
  loading: boolean;
  error: Error | null;
  refetch: () => void;
}

function useFetch<T>(
  fetcher: () => Promise<T>,
  enabled = true,
): FetchState<T> {
  const [data, setData]       = useState<T | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [error, setError]     = useState<Error | null>(null);
  const [tick, setTick]       = useState(0);

  const refetch = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    setLoading(true);
    setError(null);

    fetcher()
      .then((result) => { if (!cancelled) setData(result); })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err : new Error(String(err)));
      })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick, enabled]);

  return { data, loading, error, refetch };
}

// ── Public hooks ───────────────────────────────────────────────────────────────

/** Fetch all 24 team members. */
export function useTeamMembers(enabled = true): FetchState<TeamMember[]> {
  return useFetch(fetchMembers, enabled);
}

/** Fetch a single team member by ID. */
export function useTeamMember(id: string, enabled = true): FetchState<TeamMember> {
  return useFetch(useCallback(() => fetchMember(id), [id]), enabled);
}

/** Fetch tasks, optionally filtered by status ('at-risk' | 'covered' | 'unassigned'). */
export function useTasks(status?: string, enabled = true): FetchState<Task[]> {
  return useFetch(useCallback(() => fetchTasks(status), [status]), enabled);
}

/** Fetch the summary counts (OOO, partial, critical-at-risk, etc.). */
export function useSummary(enabled = true): FetchState<Summary> {
  return useFetch(fetchSummary, enabled);
}

// ── Mutation helpers ───────────────────────────────────────────────────────────

interface MutationState<T> {
  data: T | null;
  loading: boolean;
  error: Error | null;
}

/**
 * Returns a `trigger(id)` function that re-syncs a member's ICS calendar.
 * The hook also tracks loading / error state so you can show a spinner.
 *
 * Usage:
 *   const { trigger, loading } = useCalendarSync();
 *   await trigger('mem-012');
 */
export function useCalendarSync() {
  const [state, setState] = useState<MutationState<TeamMember>>({
    data: null, loading: false, error: null,
  });

  const trigger = useCallback(async (memberId: string) => {
    setState({ data: null, loading: true, error: null });
    try {
      const updated = await syncMemberCalendar(memberId);
      setState({ data: updated, loading: false, error: null });
      return updated;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      setState({ data: null, loading: false, error });
      throw error;
    }
  }, []);

  return { ...state, trigger };
}

/**
 * Returns a `trigger(id, leaveStatus)` function for persisting a manual
 * leave-status override to the database.
 */
export function useMemberOverride() {
  const [state, setState] = useState<MutationState<TeamMember>>({
    data: null, loading: false, error: null,
  });

  const trigger = useCallback(
    async (memberId: string, leaveStatus: 'available' | 'partial' | 'ooo') => {
      setState({ data: null, loading: true, error: null });
      try {
        const updated = await updateMemberOverride(memberId, leaveStatus);
        setState({ data: updated, loading: false, error: null });
        return updated;
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        setState({ data: null, loading: false, error });
        throw error;
      }
    },
    [],
  );

  return { ...state, trigger };
}

/**
 * Returns a `trigger(id, status)` function for patching a task's status.
 */
export function useTaskStatusUpdate() {
  const [state, setState] = useState<MutationState<Task>>({
    data: null, loading: false, error: null,
  });

  const trigger = useCallback(
    async (taskId: string, status: 'at-risk' | 'unassigned' | 'covered') => {
      setState({ data: null, loading: true, error: null });
      try {
        const updated = await updateTaskStatus(taskId, status);
        setState({ data: updated, loading: false, error: null });
        return updated;
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        setState({ data: null, loading: false, error });
        throw error;
      }
    },
    [],
  );

  return { ...state, trigger };
}
