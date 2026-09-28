import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../auth/AuthProvider';
import {
  ApiError,
  NetworkError,
  fetchRecentCheckins,
  saveCheckin,
  type Checkin,
  type CheckinInput,
} from '../lib/api';
import type { Loadable } from './useTodayPlan';

/**
 * Today's check-in: what the server already holds, and saving a new answer.
 *
 * The read follows `useTodayPlan`'s discipline — one request per identity and per
 * `reload()`, none on a re-render. The write happens **only** when `save()` is called,
 * which only an explicit submit does: mounting, StrictMode and re-renders never post.
 *
 * `save()` is latched. While a save is in flight a second call is refused rather than
 * queued, so a double tap cannot write twice. Nothing retries on its own, and a 401 is
 * surfaced like any other failure — `AuthProvider` owns the session.
 */

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

export interface CheckinState {
  /** Recent check-ins from `GET /api/checkins`; the caller picks out today's. */
  recent: Loadable<Checkin[]>;
  saveStatus: SaveStatus;
  /** Non-null only when `saveStatus` is `error`. */
  saveError: ApiError | NetworkError | null;
  /** The server's copy of the last successful save — the only proof it was saved. */
  lastSaved: Checkin | null;
  /** Resolves to the saved check-in, or `null` if it failed or a save was already running. */
  save: (input: CheckinInput) => Promise<Checkin | null>;
}

function asKnownError(error: unknown): ApiError | NetworkError {
  if (error instanceof ApiError || error instanceof NetworkError) return error;
  return new ApiError('Something went wrong saving your check-in.', 0, 'UNKNOWN');
}

export function useCheckin(options: { onSaved?: () => void } = {}): CheckinState {
  const { status: authStatus, user } = useAuth();
  const identity = authStatus === 'signed-in' ? (user?.id ?? null) : null;

  const [recent, setRecent] = useState<Loadable<Checkin[]>>({ status: 'loading', data: [], error: null });
  const issued = useRef<string | null>(null);

  useEffect(() => {
    if (!identity) return;
    if (issued.current === identity) return;
    issued.current = identity;

    setRecent({ status: 'loading', data: [], error: null });
    void (async () => {
      try {
        const data = await fetchRecentCheckins();
        if (issued.current === identity) setRecent({ status: 'success', data, error: null });
      } catch (error) {
        if (issued.current === identity) setRecent({ status: 'error', data: [], error: asKnownError(error) });
      }
    })();
  }, [identity]);

  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const [saveError, setSaveError] = useState<ApiError | NetworkError | null>(null);
  const [lastSaved, setLastSaved] = useState<Checkin | null>(null);

  /** Written synchronously, so a second tap in the same frame already sees it. */
  const inFlight = useRef(false);
  const onSaved = useRef(options.onSaved);
  onSaved.current = options.onSaved;

  const save = useCallback(async (input: CheckinInput): Promise<Checkin | null> => {
    if (inFlight.current) return null;
    inFlight.current = true;
    setSaveStatus('saving');
    setSaveError(null);

    try {
      const saved = await saveCheckin(input);
      setLastSaved(saved);
      setSaveStatus('saved');
      // The day changed on the server — a check-in event was created or moved — so
      // today's reads are stale. Refetch them rather than inventing the event here.
      onSaved.current?.();
      return saved;
    } catch (error) {
      setSaveError(asKnownError(error));
      setSaveStatus('error');
      return null;
    } finally {
      inFlight.current = false;
    }
  }, []);

  return { recent, saveStatus, saveError, lastSaved, save };
}
