import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthState, AuthStatus } from '../auth/AuthProvider';
import type { EventPage, HistoryEvent } from '../lib/api';
import { useEventHistory } from './useEventHistory';

/**
 * The history hook through a probe component, with the real API client underneath — so
 * the URLs and cursors asserted here are exactly what `apiRequest` sends.
 */

const authState = vi.hoisted(() => ({
  current: { status: 'signed-in' as AuthStatus, userId: 'user-1' as string | null },
}));

vi.mock('../auth/AuthProvider', () => ({
  useAuth: (): AuthState =>
    ({
      status: authState.current.status,
      user: authState.current.userId ? { id: authState.current.userId } : null,
    }) as unknown as AuthState,
}));

vi.mock('../lib/supabase', () => ({
  getSupabase: () => ({ auth: {} }),
  getAccessToken: async () => 'a.supabase.jwt',
}));

const event = (id: string): HistoryEvent =>
  ({
    id,
    type: 'walk',
    occurredAt: '2026-09-28T10:00:00.000Z',
    localDate: '2026-09-28',
    title: `Event ${id}`,
    durationMin: null,
    note: null,
    inputMethod: 'manual',
    source: 'user',
    metrics: null,
    detail: null,
  }) as HistoryEvent;

/** Deliberately not something a client could build or parse. */
const CURSOR_1 = 'opaque/one+==';
const CURSOR_2 = 'opaque_two';

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const fetchMock = vi.fn();
/** What the server answers, by the cursor asked for (`''` is the first page). */
let answer: (cursor: string) => Promise<Response>;

const pages: Record<string, EventPage> = {
  '': { data: [event('e3'), event('e2')], nextCursor: CURSOR_1 },
  [CURSOR_1]: { data: [event('e1')], nextCursor: CURSOR_2 },
  [CURSOR_2]: { data: [event('e0')], nextCursor: null },
};

beforeEach(() => {
  authState.current = { status: 'signed-in', userId: 'user-1' };
  answer = async (cursor) => json(200, pages[cursor]);
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (url: string) => {
    const parsed = new URL(url);
    if (parsed.pathname !== '/api/events') throw new Error(`unexpected request ${url}`);
    return answer(parsed.searchParams.get('cursor') ?? '');
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const cursorsSent = () => fetchMock.mock.calls.map(([url]) => new URL(url as string).searchParams.get('cursor'));

const Probe: React.FC = () => {
  const history = useEventHistory();
  return (
    <div>
      <span data-testid="status">{history.status}</span>
      <span data-testid="events">{history.events.map((e) => e.id).join(',')}</span>
      <span data-testid="more">{history.hasMore ? 'more' : 'end'}</span>
      <span data-testid="loading-more">{history.loadingMore ? 'yes' : 'no'}</span>
      <span data-testid="error">{history.error ? `${history.error.name}:${history.error.message}` : ''}</span>
      <span data-testid="more-error">{history.moreError?.message ?? ''}</span>
      <button type="button" onClick={history.loadMore}>
        More
      </button>
      <button
        type="button"
        onClick={() => {
          history.loadMore();
          history.loadMore();
        }}
      >
        Double
      </button>
      <button type="button" onClick={history.retry}>
        Retry
      </button>
    </div>
  );
};

const text = (id: string) => screen.getByTestId(id).textContent;

describe('useEventHistory', () => {
  it('asks for the first page once, even under StrictMode, and keeps it with its cursor', async () => {
    render(
      <React.StrictMode>
        <Probe />
      </React.StrictMode>,
    );
    await waitFor(() => expect(text('status')).toBe('success'));
    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(cursorsSent()).toEqual([null]);
    expect(text('events')).toBe('e3,e2');
    expect(text('more')).toBe('more');
  });

  it('pages with the exact cursors received, appending each page, until the cursor is null', async () => {
    render(
      <React.StrictMode>
        <Probe />
      </React.StrictMode>,
    );
    await waitFor(() => expect(text('status')).toBe('success'));

    await userEvent.click(screen.getByRole('button', { name: 'More' }));
    await waitFor(() => expect(text('events')).toBe('e3,e2,e1'));
    await userEvent.click(screen.getByRole('button', { name: 'More' }));
    await waitFor(() => expect(text('events')).toBe('e3,e2,e1,e0'));

    expect(text('more')).toBe('end');
    await userEvent.click(screen.getByRole('button', { name: 'More' }));
    expect(cursorsSent()).toEqual([null, CURSOR_1, CURSOR_2]);
  });

  it('sends one request for a double tap, and refuses more while a page is loading', async () => {
    let release!: () => void;
    answer = (cursor) =>
      cursor === ''
        ? Promise.resolve(json(200, pages['']))
        : new Promise((resolve) => {
            release = () => resolve(json(200, pages[cursor]));
          });
    render(<Probe />);
    await waitFor(() => expect(text('status')).toBe('success'));

    await userEvent.click(screen.getByRole('button', { name: 'Double' }));
    expect(text('loading-more')).toBe('yes');
    await userEvent.click(screen.getByRole('button', { name: 'More' }));
    // Already loaded events stay on screen while the next page loads.
    expect(text('events')).toBe('e3,e2');

    release();
    await waitFor(() => expect(text('events')).toBe('e3,e2,e1'));
    expect(cursorsSent()).toEqual([null, CURSOR_1]);
  });

  it('keeps every loaded event and the same cursor when a page fails, and retries that page', async () => {
    answer = async (cursor) =>
      cursor === ''
        ? json(200, pages[''])
        : json(500, { error: { code: 'INTERNAL_ERROR', message: 'Boom', requestId: '01X' } });
    render(<Probe />);
    await waitFor(() => expect(text('status')).toBe('success'));

    await userEvent.click(screen.getByRole('button', { name: 'More' }));
    await waitFor(() => expect(text('more-error')).toBe('Boom'));
    expect(text('status')).toBe('success');
    expect(text('events')).toBe('e3,e2');
    expect(text('more')).toBe('more');
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(fetchMock).toHaveBeenCalledTimes(2);

    answer = async (cursor) => json(200, pages[cursor]);
    await userEvent.click(screen.getByRole('button', { name: 'More' }));
    await waitFor(() => expect(text('events')).toBe('e3,e2,e1'));
    expect(text('more-error')).toBe('');
    expect(cursorsSent()).toEqual([null, CURSOR_1, CURSOR_1]);
  });

  it('reports a failed first page without retrying, and starts over on retry', async () => {
    answer = async () => json(500, { error: { code: 'INTERNAL_ERROR', message: 'Down', requestId: '01Y' } });
    render(<Probe />);
    await waitFor(() => expect(text('status')).toBe('error'));
    expect(text('error')).toBe('ApiError:Down');
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(fetchMock).toHaveBeenCalledTimes(1);

    answer = async (cursor) => json(200, pages[cursor]);
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(text('status')).toBe('success'));
    expect(text('events')).toBe('e3,e2');
    expect(cursorsSent()).toEqual([null, null]);
  });

  it('surfaces a 401 as an error and leaves the session to AuthProvider', async () => {
    answer = async () =>
      json(401, { error: { code: 'UNAUTHENTICATED', message: 'Authentication required', requestId: '01Z' } });
    render(<Probe />);
    await waitFor(() => expect(text('error')).toBe('ApiError:Authentication required'));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('treats a first page with no cursor as the whole history', async () => {
    answer = async () => json(200, { data: [event('only')], nextCursor: null });
    render(<Probe />);
    await waitFor(() => expect(text('status')).toBe('success'));
    expect(text('more')).toBe('end');
    await userEvent.click(screen.getByRole('button', { name: 'More' }));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('reads nothing while signed out', async () => {
    authState.current = { status: 'signed-out', userId: null };
    render(<Probe />);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
