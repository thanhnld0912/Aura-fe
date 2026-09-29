import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthState, AuthStatus } from '../auth/AuthProvider';
import { insufficientWeek, storyResult, sufficientWeek } from '../test/weekly';
import { useWeeklyInsights } from './useWeeklyInsights';

/**
 * The weekly insights hook through a probe component, with the real API client underneath —
 * so every request asserted here is what `apiRequest` actually sends.
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

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const fetchMock = vi.fn();
let answerReport: () => Promise<Response>;
let answerStory: () => Promise<Response>;

beforeEach(() => {
  authState.current = { status: 'signed-in', userId: 'user-1' };
  answerReport = async () => json(200, sufficientWeek());
  answerStory = async () => json(200, storyResult('ready'));
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (url: string) => {
    if (url.endsWith('/insights/weekly')) return answerReport();
    if (url.endsWith('/insights/weekly/story')) return answerStory();
    throw new Error(`unexpected request ${url}`);
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const reportCalls = () => fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/insights/weekly'));
const storyCalls = () => fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/story'));

const Probe: React.FC = () => {
  const insights = useWeeklyInsights();
  return (
    <div>
      <span data-testid="status">{insights.status}</span>
      <span data-testid="coverage">{insights.report?.coverage.status ?? 'none'}</span>
      <span data-testid="error">{insights.error ? `${insights.error.name}:${insights.error.message}` : ''}</span>
      <span data-testid="story-status">{insights.storyStatus}</span>
      <span data-testid="story">{insights.story ? insights.story.status : 'none'}</span>
      <span data-testid="story-error">{insights.storyError?.message ?? ''}</span>
      <button type="button" onClick={insights.retry}>
        Retry
      </button>
      <button type="button" onClick={insights.generateStory}>
        Story
      </button>
      <button
        type="button"
        onClick={() => {
          insights.generateStory();
          insights.generateStory();
        }}
      >
        Double
      </button>
    </div>
  );
};

const text = (id: string) => screen.getByTestId(id).textContent;

describe('useWeeklyInsights', () => {
  it('loads the report once under StrictMode, and never asks for a story on its own', async () => {
    render(
      <React.StrictMode>
        <Probe />
      </React.StrictMode>,
    );
    await waitFor(() => expect(text('status')).toBe('success'));
    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(reportCalls()).toHaveLength(1);
    expect(storyCalls()).toHaveLength(0);
    expect(text('coverage')).toBe('sufficient');
    expect(text('story-status')).toBe('idle');
  });

  it('keeps insufficient_data as a successful answer, not an error', async () => {
    answerReport = async () => json(200, insufficientWeek());
    render(<Probe />);
    await waitFor(() => expect(text('status')).toBe('success'));
    expect(text('coverage')).toBe('insufficient_data');
    expect(text('error')).toBe('');
  });

  it('reports a failure without retrying, retries on request, and keeps the last good report', async () => {
    answerReport = async () => json(500, { error: { code: 'INTERNAL_ERROR', message: 'Down', requestId: '01X' } });
    render(<Probe />);
    await waitFor(() => expect(text('status')).toBe('error'));
    expect(text('error')).toBe('ApiError:Down');
    expect(text('coverage')).toBe('none');
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(reportCalls()).toHaveLength(1);

    answerReport = async () => json(200, sufficientWeek());
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(text('status')).toBe('success'));

    // A later failed refresh does not take the loaded week away.
    answerReport = async () => { throw new TypeError('Failed to fetch'); };
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(text('status')).toBe('error'));
    expect(text('error')).toMatch(/^NetworkError/);
    expect(text('coverage')).toBe('sufficient');
    expect(reportCalls()).toHaveLength(3);
  });

  it('surfaces a 401 as an error and leaves the session to AuthProvider', async () => {
    answerReport = async () =>
      json(401, { error: { code: 'UNAUTHENTICATED', message: 'Authentication required', requestId: '01Y' } });
    render(<Probe />);
    await waitFor(() => expect(text('error')).toBe('ApiError:Authentication required'));
    expect(reportCalls()).toHaveLength(1);
  });

  it('asks for the story once per tap, even a double one', async () => {
    let release!: () => void;
    answerStory = () => new Promise((resolve) => { release = () => resolve(json(200, storyResult('ready'))); });
    render(<Probe />);
    await waitFor(() => expect(text('status')).toBe('success'));

    await userEvent.click(screen.getByRole('button', { name: 'Double' }));
    expect(text('story-status')).toBe('generating');
    await userEvent.click(screen.getByRole('button', { name: 'Story' }));

    release();
    await waitFor(() => expect(text('story')).toBe('ready'));
    expect(storyCalls()).toHaveLength(1);
  });

  it("returns the server's insufficient_data and disabled answers as answers", async () => {
    answerStory = async () => json(200, storyResult('disabled'));
    render(<Probe />);
    await waitFor(() => expect(text('status')).toBe('success'));
    await userEvent.click(screen.getByRole('button', { name: 'Story' }));
    await waitFor(() => expect(text('story')).toBe('disabled'));
    expect(text('story-error')).toBe('');
  });

  it('reports a failed story without retrying, and asks again only when tapped', async () => {
    answerStory = async () =>
      json(503, { error: { code: 'PROVIDER_UNAVAILABLE', message: 'Weekly stories are not available right now', requestId: '01Z' } });
    render(<Probe />);
    await waitFor(() => expect(text('status')).toBe('success'));
    await userEvent.click(screen.getByRole('button', { name: 'Story' }));
    await waitFor(() => expect(text('story-status')).toBe('error'));
    expect(text('story-error')).toBe('Weekly stories are not available right now');
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(storyCalls()).toHaveLength(1);

    answerStory = async () => json(200, storyResult('ready'));
    await userEvent.click(screen.getByRole('button', { name: 'Story' }));
    await waitFor(() => expect(text('story')).toBe('ready'));
    expect(storyCalls()).toHaveLength(2);
  });

  it('reads nothing while signed out', async () => {
    authState.current = { status: 'signed-out', userId: null };
    render(<Probe />);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
