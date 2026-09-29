import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../auth/AuthProvider';
import {
  ApiError,
  NetworkError,
  fetchWeeklyReport,
  requestWeeklyStory,
  type WeeklyReport,
  type WeeklyStoryResult,
} from '../lib/api';
import type { LoadStatus } from './useTodayPlan';

/**
 * This week's insights: the report, and — only when asked — the story.
 *
 * The report follows `useTodayPlan`'s discipline: one `GET /api/insights/weekly` per
 * authenticated identity and per `retry()`, none on a re-render or a StrictMode re-run.
 * A failed retry keeps the last report that did load, so a blip does not blank the page.
 *
 * The story is a reasoning-model call that the server limits to a few a day and does not
 * cache, so it is **never** requested on mount: only `generateStory()` sends it, and that
 * is latched so a double tap costs one call. Nothing retries on its own, and a 401 is
 * surfaced like any other failure — `AuthProvider` owns the session.
 */

export type StoryStatus = 'idle' | 'generating' | 'done' | 'error';

export interface WeeklyInsightsState {
  /** The report. `success` with `report` set; `error` may still carry the last good one. */
  status: LoadStatus;
  report: WeeklyReport | null;
  error: ApiError | NetworkError | null;
  retry: () => void;

  storyStatus: StoryStatus;
  /** The server's answer once `storyStatus` is `done` — `ready`, `insufficient_data` or `disabled`. */
  story: WeeklyStoryResult | null;
  storyError: ApiError | NetworkError | null;
  generateStory: () => void;
}

function asKnownError(error: unknown, fallback: string): ApiError | NetworkError {
  if (error instanceof ApiError || error instanceof NetworkError) return error;
  return new ApiError(fallback, 0, 'UNKNOWN');
}

export function useWeeklyInsights(): WeeklyInsightsState {
  const { status: authStatus, user } = useAuth();
  const identity = authStatus === 'signed-in' ? (user?.id ?? null) : null;

  const [status, setStatus] = useState<LoadStatus>('loading');
  const [report, setReport] = useState<WeeklyReport | null>(null);
  const [error, setError] = useState<ApiError | NetworkError | null>(null);
  const [attempt, setAttempt] = useState(0);
  const issued = useRef<string | null>(null);
  const reportFor = useRef<string | null>(null);

  useEffect(() => {
    if (!identity) return;

    const key = `${identity}#${attempt}`;
    if (issued.current === key) return;
    issued.current = key;

    // Another person's week is never shown while this one loads.
    if (reportFor.current !== identity) setReport(null);
    setStatus('loading');
    setError(null);

    void (async () => {
      try {
        const data = await fetchWeeklyReport();
        if (issued.current !== key) return;
        reportFor.current = identity;
        setReport(data);
        setStatus('success');
      } catch (failure) {
        if (issued.current !== key) return;
        setError(asKnownError(failure, 'Something went wrong loading your week.'));
        setStatus('error');
      }
    })();
  }, [identity, attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  const [storyStatus, setStoryStatus] = useState<StoryStatus>('idle');
  const [story, setStory] = useState<WeeklyStoryResult | null>(null);
  const [storyError, setStoryError] = useState<ApiError | NetworkError | null>(null);
  /** Written synchronously, so a second tap in the same frame already sees it. */
  const inFlight = useRef(false);
  const storyFor = useRef<string | null>(null);

  // A story belongs to the person it was written for.
  useEffect(() => {
    if (storyFor.current !== null && storyFor.current !== identity) {
      storyFor.current = null;
      setStory(null);
      setStoryError(null);
      setStoryStatus('idle');
    }
  }, [identity]);

  const generateStory = useCallback(() => {
    if (inFlight.current || !identity) return;
    inFlight.current = true;
    setStoryStatus('generating');
    setStoryError(null);

    void (async () => {
      try {
        const result = await requestWeeklyStory();
        storyFor.current = identity;
        setStory(result);
        setStoryStatus('done');
      } catch (failure) {
        setStoryError(asKnownError(failure, 'Something went wrong writing your weekly story.'));
        setStoryStatus('error');
      } finally {
        inFlight.current = false;
      }
    })();
  }, [identity]);

  return { status, report, error, retry, storyStatus, story, storyError, generateStory };
}
