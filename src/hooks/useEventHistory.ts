import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { ApiError, NetworkError, fetchEvents, type HistoryEvent } from '../lib/api';
import { appendPage } from '../lib/history';
import type { LoadStatus } from './useTodayPlan';

/**
 * History: `GET /api/events`, a page at a time.
 *
 * The first page follows `useTodayPlan`'s discipline — one request per authenticated
 * identity and per `retry()`, none on a re-render or a StrictMode re-run. Every later page
 * is fetched **only** by `loadMore()`, which only an explicit tap calls, and which is
 * latched: while a page is in flight another call is refused, so one tap is one request.
 *
 * The cursor is the server's. It is stored as received and sent back as received, and it
 * only moves forward when a page actually arrives. A failed page therefore leaves both the
 * loaded events and the cursor exactly where they were, so trying again asks for the same
 * page. Nothing retries on its own, and a 401 is surfaced like any other failure —
 * `AuthProvider` owns the session.
 */

export interface EventHistoryState {
  /** The first page. `success` stays `success` while later pages load or fail. */
  status: LoadStatus;
  /** Every event loaded so far, in the order the server sent them. */
  events: HistoryEvent[];
  /** `false` once the server has said there is nothing older. */
  hasMore: boolean;
  /** Non-null only when the first page failed. */
  error: ApiError | NetworkError | null;
  loadingMore: boolean;
  /** Non-null only when the last `loadMore()` failed. The loaded events are untouched. */
  moreError: ApiError | NetworkError | null;
  /** Fetches the next page. A no-op while one is in flight or when there is none. */
  loadMore: () => void;
  /** Starts again from the first page — the retry after the first page failed. */
  retry: () => void;
}

function asKnownError(error: unknown): ApiError | NetworkError {
  if (error instanceof ApiError || error instanceof NetworkError) return error;
  return new ApiError('Something went wrong loading your history.', 0, 'UNKNOWN');
}

interface Pages {
  status: LoadStatus;
  events: HistoryEvent[];
  nextCursor: string | null;
  error: ApiError | NetworkError | null;
  loadingMore: boolean;
  moreError: ApiError | NetworkError | null;
}

const initial: Pages = {
  status: 'loading',
  events: [],
  nextCursor: null,
  error: null,
  loadingMore: false,
  moreError: null,
};

export function useEventHistory(): EventHistoryState {
  const { status: authStatus, user } = useAuth();
  const identity = authStatus === 'signed-in' ? (user?.id ?? null) : null;

  const [pages, setPages] = useState<Pages>(initial);
  const [attempt, setAttempt] = useState(0);

  /** Which first-page load is current; a response for any other is dropped. */
  const issued = useRef<string | null>(null);
  /** The cursor for the next page, as last received. Read synchronously by `loadMore`. */
  const cursor = useRef<string | null>(null);
  /** Written synchronously, so a second tap in the same frame already sees it. */
  const inFlight = useRef(false);

  useEffect(() => {
    if (!identity) return;

    const key = `${identity}#${attempt}`;
    if (issued.current === key) return;
    issued.current = key;
    cursor.current = null;
    inFlight.current = false;

    setPages(initial);
    void (async () => {
      try {
        const page = await fetchEvents();
        if (issued.current !== key) return;
        cursor.current = page.nextCursor;
        setPages({ ...initial, status: 'success', events: page.data, nextCursor: page.nextCursor });
      } catch (error) {
        if (issued.current !== key) return;
        setPages({ ...initial, status: 'error', error: asKnownError(error) });
      }
    })();
  }, [identity, attempt]);

  const loadMore = useCallback(() => {
    const from = cursor.current;
    if (inFlight.current || from === null) return;
    inFlight.current = true;
    const key = issued.current;

    setPages((current) => ({ ...current, loadingMore: true, moreError: null }));
    void (async () => {
      try {
        const page = await fetchEvents({ cursor: from });
        if (issued.current !== key) return;
        cursor.current = page.nextCursor;
        setPages((current) => ({
          ...current,
          events: appendPage(current.events, page.data),
          nextCursor: page.nextCursor,
          loadingMore: false,
        }));
      } catch (error) {
        if (issued.current !== key) return;
        // The cursor is not advanced: the same page is what a retry should ask for.
        setPages((current) => ({ ...current, loadingMore: false, moreError: asKnownError(error) }));
      } finally {
        if (issued.current === key) inFlight.current = false;
      }
    })();
  }, []);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  return {
    status: pages.status,
    events: pages.events,
    hasMore: pages.status === 'success' && pages.nextCursor !== null,
    error: pages.error,
    loadingMore: pages.loadingMore,
    moreError: pages.moreError,
    loadMore,
    retry,
  };
}
