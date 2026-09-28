import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthState, AuthStatus } from '../auth/AuthProvider';
import type { DayEvent, PlanComparison } from '../lib/api';
import { useTodayPlan } from './useTodayPlan';

/**
 * The hook through what a component sees. As in `useTodayMeals.test.tsx`, `useAuth` is
 * stubbed and the API client is real, so the URLs and the bearer header are asserted
 * against what `apiRequest` actually sends.
 */

const authState = vi.hoisted(() => ({
  current: { status: 'signed-in' as AuthStatus, userId: 'user-1' as string | null },
}));

vi.mock('../auth/AuthProvider', () => ({
  useAuth: (): AuthState =>
    ({
      status: authState.current.status,
      user: authState.current.userId ? { id: authState.current.userId } : null,
      session: null,
      problem: null,
      signIn: vi.fn(),
      signOut: vi.fn(),
      retry: vi.fn(),
    }) as unknown as AuthState,
}));

vi.mock('../lib/supabase', () => ({
  getSupabase: () => ({ auth: {} }),
  getAccessToken: async () => 'a.supabase.jwt',
}));

const aComparison: PlanComparison = {
  localDate: '2026-09-18',
  adherencePct: 50,
  items: [
    {
      planItemId: '00000000-0000-4000-8000-000000000001',
      planned: { title: 'Gym', time: '18:00', type: 'workout', durationMin: 60 },
      actual: null,
      adherence: 'pending',
      shiftMinutes: null,
    },
  ],
  unplanned: [],
} as PlanComparison;

const anEvent = { id: 'e1', type: 'walk', occurredAt: '2026-09-18T11:30:00.000Z', title: 'Walk' } as DayEvent;

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const notFound = () => json(404, { error: { code: 'NOT_FOUND', message: 'No plan for that date', requestId: '01A' } });
const serverError = () => json(500, { error: { code: 'INTERNAL_ERROR', message: 'Boom', requestId: '01B' } });

const fetchMock = vi.fn();

/** Routes by path, so each read can be made to succeed or fail on its own. */
const routes = (handlers: { plan?: () => Response; events?: () => Response }) =>
  fetchMock.mockImplementation(async (url: string) => {
    if (String(url).endsWith('/daily-plan/comparison')) return (handlers.plan ?? (() => json(200, aComparison)))();
    if (String(url).endsWith('/events/today')) return (handlers.events ?? (() => json(200, { data: [anEvent], nextCursor: null })))();
    throw new Error(`unexpected request ${String(url)}`);
  });

const calls = (suffix: string) => fetchMock.mock.calls.filter(([url]) => String(url).endsWith(suffix));

const Probe: React.FC = () => {
  const { plan, events, reload } = useTodayPlan();
  return (
    <div>
      <span data-testid="plan">{plan.status}:{plan.data === null ? 'none' : plan.data.adherencePct}</span>
      <span data-testid="plan-error">{plan.error ? `${plan.error.name}:${plan.error.message}` : ''}</span>
      <span data-testid="events">{events.status}:{events.data.map((e) => e.id).join(',')}</span>
      <button type="button" onClick={reload}>
        Reload
      </button>
    </div>
  );
};

beforeEach(() => {
  authState.current = { status: 'signed-in', userId: 'user-1' };
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
  routes({});
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useTodayPlan', () => {
  it('loads the comparison and the events, authenticated, without naming a date', async () => {
    render(<Probe />);
    await waitFor(() => expect(screen.getByTestId('plan')).toHaveTextContent('success:50'));
    await waitFor(() => expect(screen.getByTestId('events')).toHaveTextContent('success:e1'));

    for (const suffix of ['/daily-plan/comparison', '/events/today']) {
      const [[url, init]] = calls(suffix) as [[string, RequestInit]];
      // "Today" is the server's question to answer, from the profile timezone.
      expect(url).not.toContain('date=');
      expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer a.supabase.jwt');
    }
  });

  it('treats a day without a plan as an answer, not an error', async () => {
    routes({ plan: notFound });
    render(<Probe />);
    await waitFor(() => expect(screen.getByTestId('plan')).toHaveTextContent('success:none'));
    expect(screen.getByTestId('plan-error')).toBeEmptyDOMElement();
  });

  it('keeps the two reads independent when one fails', async () => {
    routes({ plan: serverError });
    render(<Probe />);
    await waitFor(() => expect(screen.getByTestId('plan')).toHaveTextContent('error'));
    await waitFor(() => expect(screen.getByTestId('events')).toHaveTextContent('success:e1'));
    expect(screen.getByTestId('plan-error')).toHaveTextContent('ApiError:Boom');
  });

  it('surfaces a 401 and does not sign anyone out itself', async () => {
    routes({ plan: () => json(401, { error: { code: 'UNAUTHENTICATED', message: 'Authentication required', requestId: '01C' } }) });
    render(<Probe />);
    await waitFor(() => expect(screen.getByTestId('plan')).toHaveTextContent('error'));
    expect(screen.getByTestId('plan-error')).toHaveTextContent('Authentication required');
  });

  it('shows no fixture data when the server is unreachable', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    render(<Probe />);
    await waitFor(() => expect(screen.getByTestId('events')).toHaveTextContent(/^error:$/));
    expect(screen.getByTestId('plan')).toHaveTextContent('error:none');
  });

  describe('how many requests', () => {
    it('sends one of each under StrictMode', async () => {
      render(
        <React.StrictMode>
          <Probe />
        </React.StrictMode>,
      );
      await waitFor(() => expect(screen.getByTestId('events')).toHaveTextContent('success'));
      expect(calls('/daily-plan/comparison')).toHaveLength(1);
      expect(calls('/events/today')).toHaveLength(1);
    });

    it('sends none while the session is being restored or signed out', async () => {
      for (const status of ['loading', 'signed-out'] as const) {
        authState.current = { status, userId: null };
        const { unmount } = render(<Probe />);
        await new Promise((resolve) => setTimeout(resolve, 30));
        unmount();
      }
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('does not retry a failure on its own', async () => {
      routes({ plan: serverError });
      render(<Probe />);
      await waitFor(() => expect(screen.getByTestId('plan')).toHaveTextContent('error'));
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(calls('/daily-plan/comparison')).toHaveLength(1);
    });

    it('sends exactly one more of each on reload, and recovers', async () => {
      routes({ plan: serverError });
      render(<Probe />);
      await waitFor(() => expect(screen.getByTestId('plan')).toHaveTextContent('error'));

      routes({});
      await userEvent.click(screen.getByRole('button', { name: 'Reload' }));

      await waitFor(() => expect(screen.getByTestId('plan')).toHaveTextContent('success:50'));
      expect(calls('/daily-plan/comparison')).toHaveLength(2);
      expect(calls('/events/today')).toHaveLength(2);
    });
  });
});
