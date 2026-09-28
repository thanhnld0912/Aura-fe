import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthState, AuthStatus } from '../auth/AuthProvider';
import type { Checkin, CheckinInput } from '../lib/api';
import { useCheckin } from './useCheckin';

/**
 * The check-in hook through a probe component, with the real API client underneath —
 * so the method, URL, body and bearer header asserted here are what `apiRequest` sends.
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

const saved: Checkin = {
  id: '00000000-0000-4000-8000-00000000c001',
  eventId: '00000000-0000-4000-8000-00000000e001',
  localDate: '2026-09-18',
  mood: 'great',
  dayTag: 'busy',
  energy1to5: null,
  note: 'long day',
  createdAt: '2026-09-18T10:00:00.000Z',
} as Checkin;

const input: CheckinInput = { mood: 'great', dayTag: 'busy', note: 'long day' };

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const fetchMock = vi.fn();
let answerPost: () => Promise<Response> = async () => json(201, saved);

beforeEach(() => {
  authState.current = { status: 'signed-in', userId: 'user-1' };
  answerPost = async () => json(201, saved);
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (url: string, init: RequestInit) => {
    if (String(url).endsWith('/checkins') && init.method === 'POST') return answerPost();
    if (String(url).endsWith('/checkins')) return json(200, { data: [] });
    throw new Error(`unexpected request ${String(url)}`);
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const posts = () => fetchMock.mock.calls.filter(([, init]) => (init as RequestInit).method === 'POST');

const onSaved = vi.fn();

const Probe: React.FC = () => {
  const { recent, saveStatus, saveError, lastSaved, save } = useCheckin({ onSaved });
  return (
    <div>
      <span data-testid="recent">{recent.status}</span>
      <span data-testid="save">{saveStatus}</span>
      <span data-testid="error">{saveError ? `${saveError.name}:${saveError.message}` : ''}</span>
      <span data-testid="saved">{lastSaved?.id ?? 'none'}</span>
      <button type="button" onClick={() => void save(input)}>
        Save
      </button>
      <button
        type="button"
        onClick={() => {
          void save(input);
          void save(input);
        }}
      >
        Double
      </button>
    </div>
  );
};

describe('useCheckin', () => {
  it('never posts on mount, even under StrictMode', async () => {
    render(
      <React.StrictMode>
        <Probe />
      </React.StrictMode>,
    );
    await waitFor(() => expect(screen.getByTestId('recent')).toHaveTextContent('success'));
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(posts()).toHaveLength(0);
    // …and reads the recent history exactly once.
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/checkins'))).toHaveLength(1);
  });

  it('posts the exact payload, authenticated, once per submit', async () => {
    render(<Probe />);
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(screen.getByTestId('save')).toHaveTextContent('saved'));
    expect(posts()).toHaveLength(1);
    const [[url, init]] = posts() as [[string, RequestInit]];
    expect(url).toMatch(/\/checkins$/);
    expect(JSON.parse(init.body as string)).toEqual(input);
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer a.supabase.jwt');
    expect(screen.getByTestId('saved')).toHaveTextContent(saved.id);
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  it('refuses a second save while the first is in flight', async () => {
    let release!: () => void;
    answerPost = () => new Promise<Response>((resolve) => { release = () => resolve(json(201, saved)); });

    render(<Probe />);
    await userEvent.click(screen.getByRole('button', { name: 'Double' }));
    await waitFor(() => expect(screen.getByTestId('save')).toHaveTextContent('saving'));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    release();
    await waitFor(() => expect(screen.getByTestId('save')).toHaveTextContent('saved'));
    expect(posts()).toHaveLength(1);
  });

  it('reports a server error without claiming a save, and does not retry it', async () => {
    onSaved.mockClear();
    answerPost = async () => json(500, { error: { code: 'INTERNAL_ERROR', message: 'Boom', requestId: '01X' } });
    render(<Probe />);
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(screen.getByTestId('save')).toHaveTextContent('error'));
    expect(screen.getByTestId('error')).toHaveTextContent('ApiError:Boom');
    expect(screen.getByTestId('saved')).toHaveTextContent('none');
    expect(onSaved).not.toHaveBeenCalled();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(posts()).toHaveLength(1);
  });

  it('surfaces a 401 as an error and leaves the session to AuthProvider', async () => {
    answerPost = async () => json(401, { error: { code: 'UNAUTHENTICATED', message: 'Authentication required', requestId: '01Y' } });
    render(<Probe />);
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.getByTestId('error')).toHaveTextContent('Authentication required'));
  });

  it('can be tried again after a failure', async () => {
    answerPost = async () => { throw new TypeError('Failed to fetch'); };
    render(<Probe />);
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.getByTestId('save')).toHaveTextContent('error'));
    expect(screen.getByTestId('error')).toHaveTextContent('NetworkError');

    answerPost = async () => json(200, saved);
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.getByTestId('save')).toHaveTextContent('saved'));
    expect(posts()).toHaveLength(2);
  });

  it('reads nothing while signed out', async () => {
    authState.current = { status: 'signed-out', userId: null };
    render(<Probe />);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
