import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthState } from '../auth/AuthProvider';
import type { EventPage, HistoryEvent } from '../lib/api';
import { HistoryView } from './HistoryView';

/**
 * History renders the server's pages and nothing else: no fixture days, no invented
 * reflections, and a failed "Load more" never takes away what is already on screen.
 */

const profile = vi.hoisted(() => ({ timezone: 'Asia/Ho_Chi_Minh' }));

vi.mock('../auth/AuthProvider', () => ({
  useAuth: (): AuthState =>
    ({ status: 'signed-in', user: { id: 'user-1', displayName: 'Minh', timezone: profile.timezone } }) as unknown as AuthState,
}));

vi.mock('../lib/supabase', () => ({
  getSupabase: () => ({ auth: {} }),
  getAccessToken: async () => 'a.supabase.jwt',
}));

const event = (id: string, occurredAt: string, localDate: string, overrides: Partial<HistoryEvent> = {}): HistoryEvent =>
  ({
    id,
    type: 'walk',
    occurredAt,
    localDate,
    title: `Event ${id}`,
    durationMin: null,
    note: null,
    inputMethod: 'manual',
    source: 'user',
    metrics: null,
    detail: null,
    ...overrides,
  }) as HistoryEvent;

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const first: EventPage = {
  data: [
    event('e3', '2026-09-28T11:30:00.000Z', '2026-09-28', { title: 'Evening walk', durationMin: 40, note: 'by the lake' }),
    event('e2', '2026-09-28T01:00:00.000Z', '2026-09-28', { type: 'checkin', title: 'Check-in' }),
  ],
  nextCursor: 'cursor-page-2',
};
const second: EventPage = {
  data: [event('e1', '2026-09-26T05:15:00.000Z', '2026-09-26', { type: 'meal', title: 'Lunch' })],
  nextCursor: null,
};

const fetchMock = vi.fn();
let answer: (cursor: string | null) => Promise<Response>;

beforeEach(() => {
  profile.timezone = 'Asia/Ho_Chi_Minh';
  answer = async (cursor) => json(200, cursor === null ? first : second);
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (url: string) => answer(new URL(url).searchParams.get('cursor')));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const view = () => render(<HistoryView onOpenLogModal={vi.fn()} />);
const loadMore = () => screen.getByRole('button', { name: /Load more|Loading…|Try again/ });

describe('HistoryView', () => {
  it('shows loading, then the first page grouped by day with times in the profile timezone', async () => {
    view();
    expect(screen.getByText('Loading your history…')).toBeInTheDocument();

    const day = await screen.findByRole('region', { name: 'Monday, September 28' });
    expect(within(day).getByText('2 entries')).toBeInTheDocument();
    expect(within(day).getByText('🚶 Evening walk')).toBeInTheDocument();
    expect(within(day).getByText('18:30')).toBeInTheDocument();
    expect(within(day).getByText('40 min')).toBeInTheDocument();
    expect(within(day).getByText('by the lake')).toBeInTheDocument();
    expect(within(day).getByText('⚡ Check-in')).toBeInTheDocument();
    expect(within(day).getByText('08:00')).toBeInTheDocument();
    expect(screen.queryByText('Loading your history…')).not.toBeInTheDocument();
  });

  it('writes times in whatever timezone the profile has', async () => {
    profile.timezone = 'America/New_York';
    view();
    const day = await screen.findByRole('region', { name: 'Monday, September 28' });
    expect(within(day).getByText('07:30')).toBeInTheDocument();
  });

  it('shows none of the prototype fixtures or filters', async () => {
    view();
    await screen.findByText('🚶 Evening walk');
    for (const fixture of [
      'Thursday, September 3',
      'Bedtime Rest',
      'Canh chua',
      'mindful entries',
      'History & Patterns',
      'This week',
      'All Logs',
      'Consistent wind-down ritual',
    ]) {
      expect(screen.queryByText(fixture, { exact: false }), fixture).not.toBeInTheDocument();
    }
  });

  it('appends the next page below the first, then says it has reached the end', async () => {
    view();
    await screen.findByText('🚶 Evening walk');

    await userEvent.click(loadMore());
    const older = await screen.findByRole('region', { name: 'Saturday, September 26' });
    expect(within(older).getByText('🍱 Lunch')).toBeInTheDocument();
    expect(screen.getByText('🚶 Evening walk')).toBeInTheDocument();

    const headings = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
    expect(headings).toEqual(['Monday, September 28', 'Saturday, September 26']);
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument();
    expect(screen.getByText("That's everything so far.")).toBeInTheDocument();
  });

  it('disables Load more while the page is loading', async () => {
    let release!: () => void;
    answer = (cursor) =>
      cursor === null
        ? Promise.resolve(json(200, first))
        : new Promise((resolve) => {
            release = () => resolve(json(200, second));
          });
    view();
    await screen.findByText('🚶 Evening walk');

    await userEvent.click(loadMore());
    expect(loadMore()).toHaveTextContent('Loading…');
    expect(loadMore()).toBeDisabled();
    await userEvent.click(loadMore());

    release();
    await screen.findByText('🍱 Lunch');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('keeps the loaded events when a page fails, and retries the same page', async () => {
    answer = async (cursor) =>
      cursor === null ? json(200, first) : json(503, { error: { code: 'INTERNAL_ERROR', message: 'Boom', requestId: '01REQ' } });
    view();
    await screen.findByText('🚶 Evening walk');

    await userEvent.click(loadMore());
    await screen.findByText(/Older entries could not be loaded\. Boom/);
    expect(screen.getByText('Request 01REQ')).toBeInTheDocument();
    expect(screen.getByText('🚶 Evening walk')).toBeInTheDocument();
    expect(screen.getByText('⚡ Check-in')).toBeInTheDocument();

    answer = async (cursor) => json(200, cursor === null ? first : second);
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await screen.findByText('🍱 Lunch');
    const cursors = fetchMock.mock.calls.map(([url]) => new URL(url as string).searchParams.get('cursor'));
    expect(cursors).toEqual([null, 'cursor-page-2', 'cursor-page-2']);
  });

  it('says plainly when there is nothing yet', async () => {
    answer = async () => json(200, { data: [], nextCursor: null });
    view();
    expect(await screen.findByText('No activity yet')).toBeInTheDocument();
    expect(screen.queryByRole('region')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument();
  });

  it('shows a first-page failure with its request id, and tries again on request', async () => {
    answer = async () => json(500, { error: { code: 'INTERNAL_ERROR', message: 'Down', requestId: '01FAIL' } });
    view();
    expect(await screen.findByText('Could not load your history.')).toBeInTheDocument();
    expect(screen.getByText('Request 01FAIL')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    answer = async (cursor) => json(200, cursor === null ? first : second);
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await screen.findByText('🚶 Evening walk');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('asks for the first page once under StrictMode', async () => {
    render(
      <React.StrictMode>
        <HistoryView onOpenLogModal={vi.fn()} />
      </React.StrictMode>,
    );
    await screen.findByText('🚶 Evening walk');
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
