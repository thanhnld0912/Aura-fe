import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { ApiError, NetworkError, fetchTodayMeals } from '../lib/api';
import { toTimelineSections } from '../lib/meals';
import type { TimelineSection } from '../types';

/**
 * Today's meals, from the server.
 *
 * The request goes out once per authenticated identity and otherwise only when
 * `reload()` is called. Nothing here retries on a timer, on a re-render, or on a tab
 * focus — the same discipline the auth bootstrap needed, for the same reason: the
 * API is rate limited and a client that keeps hoping is a client that gets refused.
 *
 * This hook owns no authentication of its own. It reads `useAuth()` to know whether
 * there is anyone to fetch for, calls the one API client, and surfaces a 401 rather
 * than acting on it — `AuthProvider` owns the session lifecycle, and a second thing
 * deciding when to sign out is how two mechanisms start fighting.
 */

export type TodayMealsStatus = 'loading' | 'success' | 'error';

export interface TodayMealsState {
  status: TodayMealsStatus;
  sections: TimelineSection[];
  /** Non-null only when `status` is `error`. Safe to show; carries no token. */
  error: ApiError | NetworkError | null;
  reload: () => void;
}

/** `apiRequest` throws only these two; anything else is a bug, reported as one. */
function asKnownError(error: unknown): ApiError | NetworkError {
  if (error instanceof ApiError || error instanceof NetworkError) return error;
  return new ApiError('Something went wrong loading your meals.', 0, 'UNKNOWN');
}

export function useTodayMeals(): TodayMealsState {
  const { status: authStatus, user } = useAuth();
  const identity = authStatus === 'signed-in' ? (user?.id ?? null) : null;

  const [state, setState] = useState<Omit<TodayMealsState, 'reload'>>({
    status: 'loading',
    sections: [],
    error: null,
  });

  /** Bumped by `reload`, which is the only thing that re-runs a settled request. */
  const [attempt, setAttempt] = useState(0);

  /**
   * Which request has been issued, as `identity#attempt`.
   *
   * A ref, so it is written synchronously and survives StrictMode's remount. The
   * second mount finds its key already claimed and does not fire a duplicate.
   */
  const issued = useRef<string | null>(null);

  useEffect(() => {
    // Nobody to fetch for. Stay in `loading` — the signed-in UI is not mounted yet,
    // and inventing an empty day here would be indistinguishable from a real one.
    if (!identity) return;

    const key = `${identity}#${attempt}`;
    if (issued.current === key) return;
    issued.current = key;

    setState({ status: 'loading', sections: [], error: null });

    void (async () => {
      try {
        const meals = await fetchTodayMeals();
        // Guarded on the request key, not on whether the component is mounted: what
        // matters is whether this answer is still the one being waited for.
        if (issued.current !== key) return;
        setState({ status: 'success', sections: toTimelineSections(meals), error: null });
      } catch (error) {
        if (issued.current !== key) return;
        setState({ status: 'error', sections: [], error: asKnownError(error) });
      }
    })();
  }, [identity, attempt]);

  const reload = useCallback(() => setAttempt((n) => n + 1), []);

  return { ...state, reload };
}
