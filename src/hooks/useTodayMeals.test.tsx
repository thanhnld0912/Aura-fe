import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthState, AuthStatus } from '../auth/AuthProvider';
import type { Meal } from '../lib/api';
import { useTodayMeals } from './useTodayMeals';

/**
 * The hook, exercised through what a component would see.
 *
 * `useAuth` is stubbed rather than the whole provider mounted: this hook's only
 * dependency on authentication is "is there a signed-in identity, and which one", and
 * faking that keeps the test about meals. The API client is left real so the request
 * actually goes through `apiRequest` — the assertion that the URL and the bearer
 * header are right is worth more than a mock of our own code.
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

const aMeal = (overrides: Partial<Meal> = {}): Meal =>
  ({
    id: 'meal-1',
    eventId: 'event-1',
    mealType: 'lunch',
    status: 'confirmed',
    rawInput: 'cơm trắng',
    items: [],
    totals: { proteinG: 8.1, carbsG: 84.6, fatG: 0.9, fiberG: 1.2 },
    confidence: 0.85,
    confidenceBand: 'confident',
    userConfirmed: false,
    userEdited: false,
    isEstimate: true,
    createdAt: '2026-09-10T03:37:21.390Z',
    unresolved: [],
    notice: 'Estimates.',
    ...overrides,
  }) as Meal;

const fetchMock = vi.fn();

const ok = (meals: Meal[]): Response =>
  new Response(JSON.stringify({ data: meals }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

const failure = (status: number, code: string, message: string): Response =>
  new Response(JSON.stringify({ error: { code, message, requestId: '01JB' } }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

const Probe: React.FC = () => {
  const { status, sections, error, reload } = useTodayMeals();
  return (
    <div>
      <span data-testid="status">{status}</span>
      <span data-testid="sections">{sections.map((s) => s.id).join(',') || 'none'}</span>
      <span data-testid="error">{error ? `${error.name}:${error.message}` : ''}</span>
      <button type="button" onClick={reload}>
        Reload
      </button>
    </div>
  );
};

const mealCalls = (): unknown[][] =>
  fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/meals/today'));

beforeEach(() => {
  authState.current = { status: 'signed-in', userId: 'user-1' };
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
  fetchMock.mockImplementation(async () => ok([aMeal()]));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useTodayMeals', () => {
  it('starts loading and settles on the mapped sections', async () => {
    render(<Probe />);
    expect(screen.getByTestId('status')).toHaveTextContent('loading');

    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('success'));
    expect(screen.getByTestId('sections')).toHaveTextContent('lunch');
  });

  /**
   * The server decides what "today" means, from the timezone on the user's profile.
   * A `date` computed in the browser would disagree with it for anyone whose clock
   * is not on the same calendar day.
   */
  it('asks for today without telling the server what today is', async () => {
    render(<Probe />);
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('success'));

    const [url, init] = mealCalls()[0] as [string, RequestInit];
    expect(url).toBe('http://localhost:3001/api/meals/today');
    expect(url).not.toContain('date=');
    expect((init.headers as Record<string, string>)['Authorization']).toBe(
      'Bearer a.supabase.jwt',
    );
  });

  it('reports an empty day as a success with no sections', async () => {
    fetchMock.mockImplementation(async () => ok([]));
    render(<Probe />);

    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('success'));
    expect(screen.getByTestId('sections')).toHaveTextContent('none');
  });

  it('surfaces an unreachable server without falling back to fixtures', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    render(<Probe />);

    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('error'));
    expect(screen.getByTestId('error')).toHaveTextContent('NetworkError');
    expect(screen.getByTestId('sections')).toHaveTextContent('none');
  });

  /**
   * A 401 is reported, not acted on. `AuthProvider` owns the session; a second thing
   * deciding when to sign out is how two mechanisms start fighting over one session.
   */
  it('surfaces a 401 rather than swallowing it or signing anyone out', async () => {
    fetchMock.mockImplementation(async () => failure(401, 'UNAUTHENTICATED', 'Authentication required'));
    render(<Probe />);

    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('error'));
    expect(screen.getByTestId('error')).toHaveTextContent('Authentication required');
  });

  it('surfaces a rate limit and does not retry it on its own', async () => {
    fetchMock.mockImplementation(async () => failure(429, 'RATE_LIMITED', 'Too many requests'));
    render(<Probe />);

    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('error'));
    expect(mealCalls()).toHaveLength(1);

    // Nothing on a timer. Give it room to misbehave, then check it did not.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(mealCalls()).toHaveLength(1);
  });

  describe('how many requests', () => {
    it('sends exactly one per mount', async () => {
      render(<Probe />);
      await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('success'));
      expect(mealCalls()).toHaveLength(1);
    });

    it('sends one under StrictMode, not two', async () => {
      render(
        <React.StrictMode>
          <Probe />
        </React.StrictMode>,
      );

      await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('success'));
      expect(mealCalls()).toHaveLength(1);
    });

    it('sends none while the session is still being restored', async () => {
      authState.current = { status: 'loading', userId: null };
      render(<Probe />);

      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(mealCalls()).toHaveLength(0);
      expect(screen.getByTestId('status')).toHaveTextContent('loading');
    });

    it('sends none while signed out', async () => {
      authState.current = { status: 'signed-out', userId: null };
      render(<Probe />);

      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(mealCalls()).toHaveLength(0);
    });

    it('is unmoved by a re-render', async () => {
      const { rerender } = render(<Probe />);
      await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('success'));

      for (let i = 0; i < 4; i += 1) rerender(<Probe />);

      expect(mealCalls()).toHaveLength(1);
    });
  });

  describe('reload', () => {
    it('sends exactly one new request', async () => {
      render(<Probe />);
      await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('success'));

      await userEvent.click(screen.getByRole('button', { name: 'Reload' }));

      await waitFor(() => expect(mealCalls()).toHaveLength(2));
      expect(screen.getByTestId('status')).toHaveTextContent('success');
    });

    it('recovers from a failure when the server comes back', async () => {
      fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
      render(<Probe />);
      await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('error'));

      fetchMock.mockImplementation(async () => ok([aMeal({ mealType: 'dinner' })]));
      await userEvent.click(screen.getByRole('button', { name: 'Reload' }));

      await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('success'));
      expect(screen.getByTestId('sections')).toHaveTextContent('dinner');
      expect(mealCalls()).toHaveLength(2);
    });
  });
});
