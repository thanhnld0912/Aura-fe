import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthState } from '../auth/AuthProvider';
import type { WeeklyStoryResult } from '../lib/api';
import {
  earlierStreakFact,
  insufficientWeek,
  patternFacts,
  rankedPattern,
  readyStory,
  storyResult,
  streakFact,
  sufficientWeek,
} from '../test/weekly';
import { InsightsView } from './InsightsView';

/**
 * Weekly Insights renders the backend's week and nothing else: no prototype figures, no
 * number standing in for missing data, no story unless one was asked for, and the story
 * word for word when it comes.
 */

const profile = vi.hoisted(() => ({ locale: undefined as string | undefined }));

vi.mock('../auth/AuthProvider', () => ({
  useAuth: (): AuthState =>
    ({
      status: 'signed-in',
      user: { id: 'user-1', timezone: 'Asia/Ho_Chi_Minh', locale: profile.locale },
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
  profile.locale = undefined;
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

/**
 * The logging streak is a counted fact: shown on its own, in the backend's numbers, never
 * among the ranked patterns and never as something the story said.
 */
describe('InsightsView · logging consistency', () => {
  const facts = (name = 'Logging consistency') => screen.findByRole('region', { name });
  const weekWith = (patch: Partial<ReturnType<typeof sufficientWeek>>) => ({ ...sufficientWeek(), ...patch });

  it('shows nothing of it while the week loads or when it fails to load', async () => {
    answerReport = () => new Promise(() => {});
    const loading = view();
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Logging consistency' })).not.toBeInTheDocument();
    loading.unmount();

    answerReport = async () => json(500, { error: { code: 'INTERNAL_ERROR', message: 'Down', requestId: '01FAIL' } });
    view();
    expect(await screen.findByText('Could not load your week.')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Logging consistency' })).not.toBeInTheDocument();
    expect(screen.queryByText(/in a row/)).not.toBeInTheDocument();
  });

  it('says unavailable is unavailable — not that there is no streak', async () => {
    view();
    const region = await facts();
    expect(within(region).getByText('This information is not available right now.')).toBeInTheDocument();
    expect(within(region).queryByText(/in a row/)).not.toBeInTheDocument();
    expect(within(region).queryByText(/no run|no streak/i)).not.toBeInTheDocument();
  });

  it('treats a report without patternFacts as unavailable instead of breaking', async () => {
    const { patternFacts: _omitted, ...older } = sufficientWeek();
    answerReport = async () => json(200, older);
    view();
    expect(within(await facts()).getByText('This information is not available right now.')).toBeInTheDocument();
    expect(within(card('Meals Logged')).getByText('5 logged')).toBeInTheDocument();
  });

  it('gives none a neutral empty state with no figure in it', async () => {
    answerReport = async () => json(200, weekWith({ patternFacts: patternFacts('none') }));
    view();
    const region = await facts();
    expect(within(region).getByText('No qualifying logging streak was found in the last 45 days.')).toBeInTheDocument();
    // The only figure is the observation window: no run, no count of logged days.
    expect(within(region).getAllByText(/\d/)).toHaveLength(1);
    expect(within(region).queryByText(/in a row|Something was logged|This run/)).not.toBeInTheDocument();
    expect(within(region).queryByText(/not available/)).not.toBeInTheDocument();
    expect(within(region).queryByText(/this week|at least/i)).not.toBeInTheDocument();
  });

  it("shows a current run with the backend's dates, length, counts and caveat", async () => {
    answerReport = async () => json(200, weekWith({ patternFacts: patternFacts('available') }));
    view();
    const region = await facts();
    expect(within(region).getByText('12 days in a row')).toBeInTheDocument();
    expect(within(region).getByText('Sep 12 – Sep 23 · Your longest run in the last 45 days')).toBeInTheDocument();
    expect(within(region).getByText('This run is still going.')).toBeInTheDocument();
    expect(within(region).getByText('Something was logged on 32 of the last 45 days.')).toBeInTheDocument();
    expect(within(region).getByText(streakFact().caveat!)).toBeInTheDocument();
    expect(within(region).getByText('Counted from your logs')).toBeInTheDocument();
  });

  it('shows an earlier longest run as ended, not as current', async () => {
    answerReport = async () => json(200, weekWith({ patternFacts: patternFacts('available', earlierStreakFact()) }));
    view();
    const region = await facts();
    expect(within(region).getByText('Aug 20 – Aug 31 · Your longest run in the last 45 days')).toBeInTheDocument();
    expect(within(region).getByText('This run ended on Aug 31.')).toBeInTheDocument();
    expect(within(region).queryByText('This run is still going.')).not.toBeInTheDocument();
  });

  it('stays in English for a Vietnamese profile, like the rest of the page', async () => {
    profile.locale = 'vi';
    answerReport = async () => json(200, weekWith({ patternFacts: patternFacts('available') }));
    view();
    const region = await facts('Logging consistency');
    expect(within(region).getByText('12 days in a row')).toBeInTheDocument();
    expect(within(region).getByText('Sep 12 – Sep 23 · Your longest run in the last 45 days')).toBeInTheDocument();
    expect(within(region).getByText('This run is still going.')).toBeInTheDocument();
    expect(within(region).getByText('Something was logged on 32 of the last 45 days.')).toBeInTheDocument();
    expect(within(region).getByText(streakFact().caveat!)).toBeInTheDocument();
    expect(within(region).getByText('Counted from your logs')).toBeInTheDocument();

    expect(screen.queryByRole('region', { name: 'Tính đều đặn khi ghi nhận' })).not.toBeInTheDocument();
    expect(within(region).queryByText(/ngày|thg|Chuỗi|Chỉ tính|nhật ký/)).not.toBeInTheDocument();
  });

  it.each(['unavailable', 'none'] as const)('keeps the %s state in English for a Vietnamese profile', async (status) => {
    profile.locale = 'vi';
    answerReport = async () => json(200, weekWith({ patternFacts: patternFacts(status) }));
    view();
    const region = await facts('Logging consistency');
    expect(
      within(region).getByText(
        status === 'none'
          ? 'No qualifying logging streak was found in the last 45 days.'
          : 'This information is not available right now.',
      ),
    ).toBeInTheDocument();
    expect(within(region).queryByText(/Thông tin|Không tìm thấy|nhật ký/)).not.toBeInTheDocument();
  });

  it('adds no caveat when the backend sent none', async () => {
    answerReport = async () =>
      json(200, weekWith({ patternFacts: patternFacts('available', streakFact({ caveat: null })) }));
    view();
    const region = await facts();
    expect(within(region).getByText('12 days in a row')).toBeInTheDocument();
    expect(within(region).queryByText(/This counts days|not what you did/)).not.toBeInTheDocument();
  });

  it('keeps the streak out of the ranked patterns, and the patterns out of the streak', async () => {
    answerReport = async () =>
      json(
        200,
        weekWith({
          patterns: { status: 'available', items: [rankedPattern()] },
          patternFacts: patternFacts('available'),
        }),
      );
    view();
    const region = await facts();
    const ranked = screen.getByText('Patterns found').parentElement!;

    expect(within(ranked).getAllByRole('listitem')).toHaveLength(1);
    expect(within(ranked).getByText('Days with a walk · Good mood')).toBeInTheDocument();
    expect(within(ranked).queryByText(/Logging consistency|in a row/)).not.toBeInTheDocument();
    expect(ranked).not.toContainElement(region);

    expect(within(region).queryByText(/Days with a walk|Good mood/)).not.toBeInTheDocument();
    // No rank, score or strength is shown for a fact.
    expect(within(region).queryByText(/#\d|rank|score|strength|%/i)).not.toBeInTheDocument();
  });

  it('stays outside the story, and is never sent to it or signed by AURA', async () => {
    const report = weekWith({ patternFacts: patternFacts('available') });
    answerReport = async () => json(200, report);
    answerStory = async () => json(200, storyResult('ready', report));
    view();
    await userEvent.click(await screen.findByRole('button', { name: "Write my week's story" }));
    await screen.findByText(readyStory().headline);

    const story = screen.getByRole('article');
    const region = await facts();
    expect(story).not.toContainElement(region);
    expect(within(story).queryByText(/in a row|Logging consistency/)).not.toBeInTheDocument();
    expect(within(region).getByText('12 days in a row')).toBeInTheDocument();
    expect(within(region).queryByText(/Written by AURA|Suggested by AURA/)).not.toBeInTheDocument();

    const [, init] = storyCalls()[0]!;
    expect((init as RequestInit).body).toBe('{}');
  });

  it('shows the streak state beside a week too thin for a story', async () => {
    answerReport = async () => json(200, { ...insufficientWeek(), patternFacts: patternFacts('none') });
    view();
    expect(await screen.findByText('Not enough data yet')).toBeInTheDocument();
    expect(
      within(await facts()).getByText('No qualifying logging streak was found in the last 45 days.'),
    ).toBeInTheDocument();
  });
});
