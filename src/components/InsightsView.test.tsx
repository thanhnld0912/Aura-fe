import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthState } from '../auth/AuthProvider';
import type { WeeklyStoryResult } from '../lib/api';
import { insufficientWeek, readyStory, storyResult, sufficientWeek } from '../test/weekly';
import { InsightsView } from './InsightsView';

/**
 * Weekly Insights renders the backend's week and nothing else: no prototype figures, no
 * number standing in for missing data, no story unless one was asked for, and the story
 * word for word when it comes.
 */

vi.mock('../auth/AuthProvider', () => ({
  useAuth: (): AuthState =>
    ({ status: 'signed-in', user: { id: 'user-1', timezone: 'Asia/Ho_Chi_Minh' } }) as unknown as AuthState,
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

const onOpenLogModal = vi.fn();
const view = () => render(<InsightsView onOpenLogModal={onOpenLogModal} onNavigateToCoach={vi.fn()} />);
const storyCalls = () => fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/story'));
const card = (label: string) => screen.getByRole('region', { name: label });

describe('InsightsView', () => {
  it('shows a loading state with no figures in it', () => {
    answerReport = () => new Promise(() => {});
    view();
    expect(screen.getByRole('status')).toHaveTextContent('Gathering your week…');
    expect(screen.queryByText(/%/)).not.toBeInTheDocument();
    expect(screen.queryByText('YOUR WEEK · Here\'s what happened')).not.toBeInTheDocument();
  });

  it("renders the backend's week: its period, days and figures", async () => {
    view();
    expect(await screen.findByText('Sep 21 – Sep 27')).toBeInTheDocument();
    expect(screen.getByText('Day 4 of 7')).toBeInTheDocument();
    expect(screen.getByText('Logged on 3 of 4 days so far')).toBeInTheDocument();
    expect(screen.getByRole('listitem', { name: 'Tue: nothing logged' })).toBeInTheDocument();
    expect(screen.getByRole('listitem', { name: 'Fri: not yet' })).toBeInTheDocument();

    expect(within(card('Meals Logged')).getByText('5 logged')).toBeInTheDocument();
    expect(within(card('Plan Adherence')).getByText('67%')).toBeInTheDocument();
    expect(within(card('Movement')).getByText('1 walk · 1 workout done')).toBeInTheDocument();
    expect(screen.getByText('Days with any log: 75%, up 18 points from last week')).toBeInTheDocument();
    expect(screen.getByText('Pattern detection is not available yet.')).toBeInTheDocument();
  });

  it('says "No data" where the backend sent null, never a zero', async () => {
    view();
    const sleep = await screen.findByRole('region', { name: 'Sleep Rest' });
    expect(within(sleep).getByText('No data')).toBeInTheDocument();
    expect(within(sleep).queryByText(/\b0\b/)).not.toBeInTheDocument();
  });

  it('shows none of the prototype fixtures', async () => {
    view();
    await screen.findByText('Sep 21 – Sep 27');
    for (const fixture of [
      'Nov 10 - Nov 17',
      'Refreshed 28 mins ago',
      'Growing Sprout',
      '5-Day Flow Streak',
      '2 Patterns Unveiled',
      'Gentle Correlation',
      '23:45',
      'Breakfast Skipped',
      '10-Day Sleep vs. Meal Timing Curve',
      'Shifted +65m',
      '03:42 AM',
      '+18%',
      '4 done',
      '17 logged',
      '82% home-cooked',
      '7.1h avg',
      '78%',
      'Weekday Harmony',
      'Sustainable Movement',
      'Next week rhythm saved',
      'Space to breathe',
    ]) {
      expect(screen.queryByText(fixture, { exact: false }), fixture).not.toBeInTheDocument();
    }
  });

  it('gives insufficient_data its own state, with the backend counts and no threshold of its own', async () => {
    answerReport = async () => json(200, insufficientWeek());
    view();
    expect(await screen.findByText('Not enough data yet')).toBeInTheDocument();
    expect(screen.getByText(/something was logged on 1 of 2 days/)).toBeInTheDocument();
    expect(screen.queryByText(/Could not load/)).not.toBeInTheDocument();
    // No story is offered for a week the backend will not describe…
    expect(screen.queryByRole('button', { name: "Write my week's story" })).not.toBeInTheDocument();
    // …and no minimum is invented: the backend does not send one.
    expect(screen.queryByText(/at least|3 days|required/i)).not.toBeInTheDocument();
    for (const label of ['Movement', 'Meals Logged', 'Sleep Rest', 'Plan Adherence']) {
      expect(within(card(label)).getByText('No data')).toBeInTheDocument();
    }

    await userEvent.click(screen.getByRole('button', { name: '+ Log a moment' }));
    expect(onOpenLogModal).toHaveBeenCalled();
    expect(storyCalls()).toHaveLength(0);
  });

  it('shows a failure with its request id, and tries again only when asked', async () => {
    answerReport = async () => json(500, { error: { code: 'INTERNAL_ERROR', message: 'Down', requestId: '01FAIL' } });
    view();
    expect(await screen.findByText('Could not load your week.')).toBeInTheDocument();
    expect(screen.getByText('Request 01FAIL')).toBeInTheDocument();
    expect(screen.queryByText('YOUR WEEK · Here\'s what happened')).not.toBeInTheDocument();
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(fetchMock).toHaveBeenCalledTimes(1);

    answerReport = async () => json(200, sufficientWeek());
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Sep 21 – Sep 27')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('writes the story only on request, and renders it word for word', async () => {
    let release!: () => void;
    answerStory = () => new Promise((resolve) => { release = () => resolve(json(200, storyResult('ready'))); });
    view();
    const request = await screen.findByRole('button', { name: "Write my week's story" });
    expect(storyCalls()).toHaveLength(0);
    // No suggestions exist until the story brings them.
    expect(screen.queryByText('Suggested by AURA')).not.toBeInTheDocument();

    await userEvent.click(request);
    expect(screen.getByRole('button', { name: 'Writing your story…' })).toBeDisabled();
    release();

    const story = readyStory();
    expect(await screen.findByText(story.headline)).toBeInTheDocument();
    for (const line of [
      story.summary.text,
      story.highlights[0]!.text,
      story.interpretations[0]!.text,
      story.suggestions[0]!.text,
      story.caveats[0]!.text,
    ]) {
      expect(screen.getByText(line)).toBeInTheDocument();
    }
    expect(screen.getByText('Suggested by AURA')).toBeInTheDocument();
    expect(screen.queryByText(/caus/i)).not.toBeInTheDocument();
    expect(storyCalls()).toHaveLength(1);
  });

  it('shows a pattern with its caveat intact, as an association', async () => {
    const result: WeeklyStoryResult = storyResult('ready');
    result.story!.patterns = [
      {
        patternId: 'p1',
        statement: 'Days with a walk and days with a good mood were associated this week.',
        caveat: 'One week is a small sample; this is not evidence that one leads to the other.',
        evidence: ['P1'],
      },
    ];
    answerStory = async () => json(200, result);
    view();
    await userEvent.click(await screen.findByRole('button', { name: "Write my week's story" }));

    expect(await screen.findByText(result.story!.patterns[0]!.statement)).toBeInTheDocument();
    expect(screen.getByText(result.story!.patterns[0]!.caveat)).toBeInTheDocument();
    expect(screen.queryByText(/caused|because of/i)).not.toBeInTheDocument();
  });

  it('shows no suggestions when the story has none', async () => {
    const result = storyResult('ready');
    result.story!.suggestions = [];
    answerStory = async () => json(200, result);
    view();
    await userEvent.click(await screen.findByRole('button', { name: "Write my week's story" }));
    await screen.findByText(readyStory().headline);
    expect(screen.queryByText('Suggested by AURA')).not.toBeInTheDocument();
  });

  it("respects the server's disabled answer", async () => {
    answerStory = async () => json(200, storyResult('disabled'));
    view();
    await userEvent.click(await screen.findByRole('button', { name: "Write my week's story" }));
    expect(await screen.findByText('Weekly story is off')).toBeInTheDocument();
  });

  it('keeps the week on screen when the story fails, and says when to ask again', async () => {
    answerStory = async () =>
      new Response(JSON.stringify({ error: { code: 'RATE_LIMITED', message: 'Too many requests', requestId: '01RL' } }), {
        status: 429,
        headers: { 'Content-Type': 'application/json', 'Retry-After': '7200' },
      });
    view();
    await userEvent.click(await screen.findByRole('button', { name: "Write my week's story" }));

    expect(await screen.findByText(/The story could not be written\. Too many requests/)).toBeInTheDocument();
    expect(screen.getByText('You can ask again in about 2 h.')).toBeInTheDocument();
    expect(screen.getByText('Request 01RL')).toBeInTheDocument();
    expect(within(card('Meals Logged')).getByText('5 logged')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeEnabled();
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(storyCalls()).toHaveLength(1);
  });

  it('asks for the report once under StrictMode', async () => {
    render(
      <React.StrictMode>
        <InsightsView onOpenLogModal={vi.fn()} onNavigateToCoach={vi.fn()} />
      </React.StrictMode>,
    );
    await screen.findByText('Sep 21 – Sep 27');
    await new Promise((resolve) => setTimeout(resolve, 30));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  });
});
