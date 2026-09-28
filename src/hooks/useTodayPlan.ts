import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../auth/AuthProvider';
import {
  ApiError,
  NetworkError,
  fetchPlanComparison,
  fetchTodayEvents,
  type DayEvent,
  type PlanComparison,
} from '../lib/api';

/**
 * Today's plan comparison and today's events, from the server.
 *
 * Same discipline as `useTodayMeals`, for the same reasons: one request per
 * authenticated identity and per `reload()`, nothing on a timer or a re-render, and a
 * 401 surfaced rather than acted on — `AuthProvider` owns the session.
 *
 * The two reads are independent, so each keeps its own state. An events outage must not
 * blank the plan card, and a plan that failed to load must not hide what happened.
 */

export type LoadStatus = 'loading' | 'success' | 'error';

export interface Loadable<T> {
  status: LoadStatus;
  /** Meaningful only when `status` is `success`. */
  data: T;
  /** Non-null only when `status` is `error`. Safe to show; carries no token. */
  error: ApiError | NetworkError | null;
}

export interface TodayPlanState {
  /** `data` is `null` on success when the user has no plan today — not an error. */
  plan: Loadable<PlanComparison | null>;
  events: Loadable<DayEvent[]>;
  reload: () => void;
}

function asKnownError(error: unknown): ApiError | NetworkError {
  if (error instanceof ApiError || error instanceof NetworkError) return error;
  return new ApiError("Something went wrong loading today's plan.", 0, 'UNKNOWN');
}

const loading = <T,>(data: T): Loadable<T> => ({ status: 'loading', data, error: null });

export function useTodayPlan(): TodayPlanState {
  const { status: authStatus, user } = useAuth();
  const identity = authStatus === 'signed-in' ? (user?.id ?? null) : null;

  const [plan, setPlan] = useState<Loadable<PlanComparison | null>>(loading(null));
  const [events, setEvents] = useState<Loadable<DayEvent[]>>(loading([]));
  const [attempt, setAttempt] = useState(0);
  const issued = useRef<string | null>(null);

  useEffect(() => {
    if (!identity) return;

    const key = `${identity}#${attempt}`;
    if (issued.current === key) return;
    issued.current = key;

    setPlan(loading(null));
    setEvents(loading([]));

    const settle = async <T,>(
      request: Promise<T>,
      set: (next: Loadable<T>) => void,
      empty: T,
    ): Promise<void> => {
      try {
        const data = await request;
        if (issued.current === key) set({ status: 'success', data, error: null });
      } catch (error) {
        if (issued.current === key) set({ status: 'error', data: empty, error: asKnownError(error) });
      }
    };

    void settle(fetchPlanComparison(), setPlan, null);
    void settle(fetchTodayEvents(), setEvents, []);
  }, [identity, attempt]);

  const reload = useCallback(() => setAttempt((n) => n + 1), []);

  return { plan, events, reload };
}
