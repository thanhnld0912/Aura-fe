import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React, { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthState } from '../auth/AuthProvider';
import type { TodayMealsState } from '../hooks/useTodayMeals';
import type { Loadable, TodayPlanState } from '../hooks/useTodayPlan';
import type { Checkin, DayEvent, PlanComparison } from '../lib/api';
import { TodayView } from './TodayView';

/**
 * The check-in card: it claims "Saved" only after the server answered with the saved
 * check-in, keeps everything on a failure, and hands the day back to the server's
 * events rather than drawing a check-in of its own.
 */

vi.mock('../auth/AuthProvider', () => ({
  useAuth: (): AuthState =>
    ({ status: 'signed-in', user: { id: 'user-1', displayName: 'Minh', timezone: 'Asia/Ho_Chi_Minh' } }) as unknown as AuthState,
}));

vi.mock('../lib/supabase', () => ({
  getSupabase: () => ({ auth: {} }),
  getAccessToken: async () => 'a.supabase.jwt',
}));

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const savedCheckin = (overrides: Partial<Checkin> = {}): Checkin =>
  ({
    id: 'c1',
    eventId: 'ev-checkin',
    localDate: '2026-09-18',
    mood: 'great',
    dayTag: 'busy',
    energy1to5: null,
    note: null,
    createdAt: '2026-09-18T10:00:00.000Z',
    ...overrides,
  }) as Checkin;

const fetchMock = vi.fn();
let history: Checkin[] = [];
let answerPost: (body: Record<string, unknown>) => Promise<Response>;

beforeEach(() => {
  history = [];
  answerPost = async (body) => json(201, savedCheckin(body as Partial<Checkin>));
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (url: string, init: RequestInit) => {
    if (String(url).endsWith('/checkins') && init.method === 'POST') return answerPost(JSON.parse(init.body as string));
    if (String(url).endsWith('/checkins')) return json(200, { data: history });
    throw new Error(`unexpected request ${String(url)}`);
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const posts = () => fetchMock.mock.calls.filter(([, init]) => (init as RequestInit).method === 'POST');
const lastBody = () => JSON.parse((posts().at(-1)![1] as RequestInit).body as string);

const meals: TodayMealsState = { status: 'success', sections: [], error: null, reload: vi.fn() };
const ok = <T,>(data: T): Loadable<T> => ({ status: 'success', data, error: null });

/** Holds the mood the way `App` does — the card is controlled from above. */
const Harness: React.FC<{ reload: () => void; events?: DayEvent[] }> = ({ reload, events = [] }) => {
  const [mood, setMood] = useState('good');
  const plan: TodayPlanState = {
    plan: ok<PlanComparison | null>(null),
    events: ok<DayEvent[]>(events),
    reload,
  };
  return <TodayView today={meals} plan={plan} onOpenLogModal={vi.fn()} onSelectMood={setMood} selectedMood={mood} />;
};

const saveButton = () => screen.getByRole('button', { name: /Save check-in|Try again|Saving…/ });
const status = () => screen.getByRole('status');

describe('Check-in card', () => {
  it('makes no claim it cannot back: no "Saved automatically", no save on mount', async () => {
    render(
      <React.StrictMode>
        <Harness reload={vi.fn()} />
      </React.StrictMode>,
    );
    await waitFor(() => expect(status()).toHaveTextContent('Not saved yet'));
    expect(screen.queryByText('Saved automatically')).not.toBeInTheDocument();
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(posts()).toHaveLength(0);
  });

  it('saves the chosen mood, tag and note, then reloads the day', async () => {
    const reload = vi.fn();
    render(<Harness reload={reload} />);

    await userEvent.click(screen.getByRole('button', { name: /Low energy/ }));
    await userEvent.click(screen.getByRole('button', { name: "Didn't go as planned" }));
    await userEvent.click(screen.getByRole('button', { name: '+ Add a note' }));
    await userEvent.type(screen.getByPlaceholderText(/How are you feeling/), 'slept badly');
    await userEvent.click(screen.getByRole('button', { name: 'Save Reflection' }));

    await waitFor(() => expect(status()).toHaveTextContent('Saved'));
    expect(posts()).toHaveLength(1);
    expect(lastBody()).toEqual({ mood: 'low', dayTag: 'not_as_planned', note: 'slept badly' });
    // The timeline learns about the check-in from the server, not from this card.
    expect(reload).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('⚡ Check-in')).not.toBeInTheDocument();
  });

  it('shows saving, and cannot be submitted twice while it is', async () => {
    let release!: () => void;
    answerPost = (body) =>
      new Promise((resolve) => {
        release = () => resolve(json(201, savedCheckin(body as Partial<Checkin>)));
      });
    render(<Harness reload={vi.fn()} />);
    await waitFor(() => expect(status()).toHaveTextContent('Not saved yet'));

    await userEvent.click(saveButton());
    expect(status()).toHaveTextContent('Saving…');
    expect(saveButton()).toBeDisabled();
    await userEvent.click(saveButton());

    release();
    await waitFor(() => expect(status()).toHaveTextContent('Saved'));
    expect(posts()).toHaveLength(1);
    // Nothing changed since the save, so there is nothing to save again.
    expect(saveButton()).toBeDisabled();
  });

  it('keeps every input after a failed save, and lets the person try again', async () => {
    answerPost = async () => json(500, { error: { code: 'INTERNAL_ERROR', message: 'Boom', requestId: '01REQ' } });
    const reload = vi.fn();
    render(<Harness reload={reload} />);

    await userEvent.click(screen.getByRole('button', { name: /Great/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Busy' }));
    await userEvent.click(screen.getByRole('button', { name: '+ Add a note' }));
    await userEvent.type(screen.getByPlaceholderText(/How are you feeling/), 'keep me');
    await userEvent.click(saveButton());

    await waitFor(() => expect(status()).toHaveTextContent("Couldn't save"));
    expect(screen.getByText(/Your check-in was not saved\. Boom/)).toBeInTheDocument();
    expect(screen.getByText('Request 01REQ')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Great/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Busy' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByPlaceholderText(/How are you feeling/)).toHaveValue('keep me');
    expect(reload).not.toHaveBeenCalled();

    answerPost = async (body) => json(201, savedCheckin(body as Partial<Checkin>));
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(status()).toHaveTextContent('Saved'));
    expect(posts()).toHaveLength(2);
    expect(lastBody()).toEqual({ mood: 'great', dayTag: 'busy', note: 'keep me' });
  });

  it("shows today's saved check-in as saved, so a reload cannot erase its note", async () => {
    history = [savedCheckin({ mood: 'low', dayTag: 'busy', note: 'from this morning' })];
    render(<Harness reload={vi.fn()} events={[{ id: 'ev-checkin', type: 'checkin', title: 'Check-in', occurredAt: '2026-09-18T01:00:00.000Z' } as DayEvent]} />);

    await waitFor(() => expect(status()).toHaveTextContent('Saved'));
    expect(screen.getByRole('button', { name: /Low energy/ })).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(screen.getByRole('button', { name: '+ Add a note' }));
    expect(screen.getByPlaceholderText(/How are you feeling/)).toHaveValue('from this morning');

    // Changing only the mood still sends the note back, rather than clearing it.
    await userEvent.click(screen.getByRole('button', { name: /Okay/ }));
    expect(status()).toHaveTextContent('Unsaved changes');
    await userEvent.click(saveButton());
    await waitFor(() => expect(status()).toHaveTextContent('Saved'));
    expect(lastBody()).toEqual({ mood: 'okay', dayTag: 'busy', note: 'from this morning' });
  });

  it("ignores a check-in from another day", async () => {
    history = [savedCheckin({ eventId: 'ev-yesterday', mood: 'low' })];
    render(<Harness reload={vi.fn()} events={[]} />);
    await waitFor(() => expect(status()).toHaveTextContent('Not saved yet'));
    expect(screen.getByRole('button', { name: /Good/ })).toHaveAttribute('aria-pressed', 'true');
  });
});
