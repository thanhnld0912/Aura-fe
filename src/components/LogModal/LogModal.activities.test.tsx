import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LogModal } from './index';

/**
 * Every category but food, exercised through the requests it makes.
 *
 * As in `LogModal.test.tsx`, `fetch` is stubbed and the real `apiRequest` runs, so these
 * assert the URL, method and exact body the backend receives. The write schemas are
 * `.strict()`: a stray field is a 400 in production.
 */

vi.mock('../../lib/supabase', () => ({
  getSupabase: () => ({ auth: {} }),
  getAccessToken: async () => 'a.supabase.jwt',
}));

const fetchMock = vi.fn();
const onSaved = vi.fn();
const onClose = vi.fn();

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const event = (overrides: Record<string, unknown> = {}) => ({
  id: 'event-1',
  type: 'walk',
  occurredAt: '2026-10-27T01:00:00.000Z',
  localDate: '2026-10-27',
  title: 'Walk',
  durationMin: 30,
  note: null,
  inputMethod: 'manual',
  source: 'user',
  metrics: null,
  detail: null,
  ...overrides,
});

const workout = (overrides: Record<string, unknown> = {}) => ({
  id: 'session-1',
  eventId: 'event-w',
  workoutType: 'gym',
  status: 'completed',
  title: 'Gym',
  occurredAt: '2026-10-27T01:00:00.000Z',
  localDate: '2026-10-27',
  durationMin: 45,
  perceivedEffort: null,
  note: null,
  createdAt: '2026-10-27T01:00:00.000Z',
  ...overrides,
});

const checkin = (overrides: Record<string, unknown> = {}) => ({
  id: 'checkin-1',
  eventId: 'event-c',
  localDate: '2026-10-27',
  mood: 'okay',
  dayTag: 'busy',
  energy1to5: 3,
  note: 'Long morning',
  createdAt: '2026-10-27T01:00:00.000Z',
  ...overrides,
});

type Handler = (init: RequestInit) => Response | Promise<Response>;

/** Answers by method and path; anything unexpected fails loudly. */
function serve(routes: Record<string, Handler>) {
  fetchMock.mockImplementation(async (url: string, init: RequestInit = {}) => {
    const path = new URL(String(url)).pathname.replace(/^\/api/, '');
    const handler = routes[`${init.method ?? 'GET'} ${path}`];
    if (!handler) throw new Error(`unexpected request: ${init.method ?? 'GET'} ${path}`);
    return handler(init);
  });
}

const writes = () =>
  (fetchMock.mock.calls as Array<[string, RequestInit]>).filter(([, init]) => init?.method === 'POST');
const bodyOf = (call: [string, RequestInit]) => JSON.parse(call[1].body as string);
const pathOf = (call: [string, RequestInit]) => new URL(call[0]).pathname;
const keyOf = (call: [string, RequestInit]) => (call[1].headers as Record<string, string>)['Idempotency-Key'];

const open = (props: Partial<React.ComponentProps<typeof LogModal>> = {}) =>
  render(<LogModal isOpen onClose={onClose} onSaved={onSaved} {...props} />);

const choose = (label: RegExp) => userEvent.click(screen.getByRole('button', { name: label }));
const describeAs = async (text: string) => {
  const box = screen.getByRole('textbox', { name: /Describe|How much|How are you|What happened/ });
  await userEvent.clear(box);
  await userEvent.type(box, text);
};

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
  onSaved.mockReset();
  onClose.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Food-only controls: none of them may appear outside "I ate". */
function expectNoFoodControls() {
  expect(screen.queryByRole('button', { name: /Take a photo/ })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Quick add/ })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Tell AURA/ })).not.toBeInTheDocument();
  expect(screen.queryByLabelText('Meal')).not.toBeInTheDocument();
  expect(screen.queryByText('Phở bò')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Let AURA read it/ })).not.toBeInTheDocument();
}

describe('the category selector', () => {
  it.each([
    [/I worked out/, 'Describe your workout', 'Save workout'],
    [/I walked/, 'Describe your walk', 'Save walk'],
    [/I drank water/, 'How much water did you drink?', 'Log water'],
    [/I slept/, 'Describe your sleep', 'Save sleep'],
    [/Something else/, 'What happened?', 'Save activity'],
  ])('%s shows its own form and nothing of food’s', async (category, heading, submit) => {
    open();
    await choose(category);

    expect(screen.getByRole('button', { name: category })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /I ate/ })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('textbox', { name: heading })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: new RegExp(submit) })).toBeInTheDocument();
    expectNoFoodControls();
  });

  it('Check-in shows its own form once today’s answer is loaded', async () => {
    serve({ 'GET /checkins': () => json(200, { data: [] }), 'GET /events/today': () => json(200, { data: [] }) });
    open();
    await choose(/Check-in/);

    expect(screen.getByRole('textbox', { name: 'How are you feeling?' })).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: /Save check-in/ })).toBeEnabled();
    expectNoFoodControls();
  });

  it('brings food back, unchanged, when switched back', async () => {
    open();
    await choose(/I walked/);
    await choose(/I ate/);
    expect(screen.getByRole('button', { name: /Take a photo/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Let AURA read it/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Save walk/ })).not.toBeInTheDocument();
  });

  it('keeps the description across a switch, but starts the new category’s fields afresh', async () => {
    open();
    await choose(/I worked out/);
    await describeAs('Tôi tập gym 45 phút');
    await userEvent.type(screen.getByLabelText(/Activity name/), 'Leg day');

    await choose(/I walked/);
    // The description followed; its 45 minutes is read again, for the walk.
    expect(screen.getByRole('textbox', { name: 'Describe your walk' })).toHaveValue('Tôi tập gym 45 phút');
    expect(screen.getByLabelText('Duration')).toHaveValue('45');

    await choose(/I worked out/);
    // The name typed into the workout's own field did not survive leaving it.
    expect(screen.getByLabelText(/Activity name/)).toHaveValue('Gym');
  });

  it('opens on the category the caller asked for', () => {
    open({ initialCategory: 'water' });
    expect(screen.getByRole('button', { name: /I drank water/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /Log water/ })).toBeInTheDocument();
  });

  it('wraps the categories rather than hiding some off-screen', () => {
    open();
    expect(screen.getByRole('group', { name: 'What are you logging?' }).className).toContain('flex-wrap');
  });
});

describe('I worked out', () => {
  it('reads a Vietnamese sentence into the fields and posts a workout', async () => {
    serve({ 'POST /workouts': () => json(201, workout()) });
    open();
    await choose(/I worked out/);
    await describeAs('Tôi tập gym 45 phút');

    expect(screen.getByRole('button', { name: 'Gym / strength' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByLabelText('Duration')).toHaveValue('45');

    await choose(/Save workout/);
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith('event-w', 'workout'));
    const [call] = writes();
    expect(pathOf(call!)).toBe('/api/workouts');
    expect(bodyOf(call!)).toEqual({ workoutType: 'gym', title: 'Gym', durationMin: 45, note: 'Tôi tập gym 45 phút' });
  });

  it('reads an English sentence with an intensity, and sends no measurement nobody gave', async () => {
    serve({ 'POST /workouts': () => json(201, workout({ workoutType: 'other' })) });
    open();
    await choose(/I worked out/);
    await describeAs('I cycled for 30 minutes at moderate intensity.');
    await choose(/Save workout/);

    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(bodyOf(writes()[0]!)).toEqual({
      workoutType: 'other',
      title: 'Cycling',
      durationMin: 30,
      perceivedEffort: 3,
      note: 'I cycled for 30 minutes at moderate intensity.',
    });
  });

  it('rejects a missing type and a bad duration before sending anything', async () => {
    open();
    await choose(/I worked out/);
    await userEvent.type(screen.getByLabelText('Duration'), '0');
    await choose(/Save workout/);

    expect(screen.getByText('Pick what kind of workout this was.')).toBeInTheDocument();
    expect(screen.getByText('Enter between 1 and 600 minutes.')).toBeInTheDocument();
    expect(screen.getByLabelText('Duration')).toHaveAttribute('aria-invalid', 'true');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('never overwrites a field the person set when the description changes', async () => {
    open();
    await choose(/I worked out/);
    await userEvent.type(screen.getByLabelText('Duration'), '50');
    await describeAs('gym 45 phút');
    expect(screen.getByLabelText('Duration')).toHaveValue('50');
  });
});

describe('I walked', () => {
  it('posts a walk with its distance as metrics.km', async () => {
    serve({ 'POST /events': () => json(201, event()) });
    open();
    await choose(/I walked/);
    await describeAs('I walked 2.5 km in 35 minutes.');
    await choose(/Save walk/);

    await waitFor(() => expect(onSaved).toHaveBeenCalledWith('event-1', 'walk'));
    const [call] = writes();
    expect(pathOf(call!)).toBe('/api/events');
    expect(bodyOf(call!)).toEqual({
      type: 'walk',
      title: 'Walk',
      durationMin: 35,
      metrics: { km: 2.5 },
      note: 'I walked 2.5 km in 35 minutes.',
    });
  });

  it('needs only a duration — distance and note can be left out', async () => {
    serve({ 'POST /events': () => json(201, event()) });
    open();
    await choose(/I walked/);
    await userEvent.type(screen.getByLabelText('Duration'), '30');
    await choose(/Save walk/);

    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(bodyOf(writes()[0]!)).toEqual({ type: 'walk', title: 'Walk', durationMin: 30 });
  });

  it('reads the Today chip’s Vietnamese sentence as 30 minutes', async () => {
    open({ initialCategory: 'walk', initialPrompt: 'Vừa hoàn thành 30 phút đi bộ nhẹ nhàng.' });
    expect(screen.getByLabelText('Duration')).toHaveValue('30');
  });

  it('asks for a duration rather than saving a walk without one', async () => {
    open();
    await choose(/I walked/);
    await choose(/Save walk/);
    expect(screen.getByText('Add how long you walked, in minutes.')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('I drank water', () => {
  it('logs a quick amount in two taps', async () => {
    serve({ 'POST /events': () => json(201, event({ type: 'water', title: 'Water', metrics: { ml: 500 } })) });
    open();
    await choose(/I drank water/);
    await choose(/^500 ml$/);
    await choose(/Log water/);

    await waitFor(() => expect(onSaved).toHaveBeenCalledWith('event-1', 'water'));
    expect(bodyOf(writes()[0]!)).toEqual({ type: 'water', title: 'Water', metrics: { ml: 500 } });
  });

  it('reads an amount in ml from English and Vietnamese', async () => {
    serve({ 'POST /events': () => json(201, event({ type: 'water' })) });
    open();
    await choose(/I drank water/);
    await describeAs('I drank 750 ml of water.');
    expect(screen.getByLabelText('Amount')).toHaveValue('750');
    await describeAs('Đã uống 1 ly nước ấm 350ml.');
    expect(screen.getByLabelText('Amount')).toHaveValue('350');
  });

  it('asks how big a cốc is instead of guessing, and does not save', async () => {
    open();
    await choose(/I drank water/);
    await describeAs('Tôi vừa uống 2 cốc nước.');

    expect(screen.getByLabelText('Amount')).toHaveValue('');
    expect(screen.getByText(/can't tell how much a cốc holds/)).toBeInTheDocument();
    await choose(/Log water/);
    expect(screen.getByText('Enter how much you drank, in ml.')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('I slept', () => {
  it('works the duration out from bedtime and wake-up, across midnight', async () => {
    serve({ 'POST /events': () => json(201, event({ type: 'sleep' })) });
    open();
    await choose(/I slept/);
    await describeAs('I went to bed at 11 PM and woke up at 6 AM.');

    expect(screen.getByLabelText(/Went to bed/)).toHaveValue('23:00');
    expect(screen.getByLabelText('Woke up')).toHaveValue('06:00');
    expect(screen.getByText(/Worked out from your times: 7 h 0 min/)).toBeInTheDocument();

    await choose(/Save sleep/);
    await waitFor(() => expect(writes()).toHaveLength(1));
    const body = bodyOf(writes()[0]!);
    expect(body).toMatchObject({ type: 'sleep', title: 'Sleep', durationMin: 420 });
    // The event starts at bedtime, which is what the day's summary reads it as.
    const start = new Date(body.occurredAt);
    expect([start.getHours(), start.getMinutes()]).toEqual([23, 0]);
  });

  it('says at once when the times add up to over 16 hours, and saves nothing', async () => {
    open();
    await choose(/I slept/);
    await describeAs('I went to bed at 8 AM and woke up at 7 AM.');

    const warning = 'That’s over 16 hours of sleep — check your bedtime and wake-up time.';
    expect(screen.getByText(warning)).toBeInTheDocument();
    expect(screen.queryByText(/Worked out from your times/)).not.toBeInTheDocument();

    await choose(/Save sleep/);
    // After the attempt it is the field's own error, shown once.
    expect(screen.getAllByText(warning)).toHaveLength(1);
    expect(screen.getByLabelText('Hours slept')).toHaveAttribute('aria-invalid', 'true');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reads a Vietnamese duration', async () => {
    open();
    await choose(/I slept/);
    await describeAs('Tôi ngủ được 7 tiếng.');
    expect(screen.getByLabelText('Hours slept')).toHaveValue('7');
  });

  it('asks how long when there is nothing to measure the sleep by', async () => {
    open();
    await choose(/I slept/);
    await choose(/Save sleep/);
    expect(screen.getByText('Add how long you slept, or when you went to bed.')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('Check-in', () => {
  it('starts from today’s saved answer and sends the whole form back', async () => {
    serve({
      'GET /checkins': () => json(200, { data: [checkin()] }),
      'GET /events/today': () => json(200, { data: [event({ id: 'event-c', type: 'checkin', title: 'Check-in' })] }),
      'POST /checkins': () => json(200, checkin({ mood: 'good' })),
    });
    open();
    await choose(/Check-in/);

    expect(await screen.findByText(/You checked in earlier today/)).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'How are you feeling?' })).toHaveValue('Long morning');
    expect(screen.getByRole('button', { name: /Okay/ })).toHaveAttribute('aria-pressed', 'true');

    await choose(/Good/);
    await choose(/Save check-in/);

    await waitFor(() => expect(onSaved).toHaveBeenCalledWith('checkin-1', 'check-in'));
    const post = writes().find((call) => pathOf(call) === '/api/checkins')!;
    // The tag, energy and note it never touched go back as they were, not cleared.
    expect(bodyOf(post)).toEqual({ mood: 'good', dayTag: 'busy', energy1to5: 3, note: 'Long morning' });
  });

  it('shows the saved note it is about to replace when the box already holds other text', async () => {
    serve({
      'GET /checkins': () => json(200, { data: [checkin()] }),
      'GET /events/today': () => json(200, { data: [event({ id: 'event-c', type: 'checkin', title: 'Check-in' })] }),
    });
    open();
    await choose(/I walked/);
    await describeAs('walked 20 minutes');
    await choose(/Check-in/);

    expect(await screen.findByText(/Today’s saved note — “Long morning” — will be replaced/)).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'How are you feeling?' })).toHaveValue('walked 20 minutes');
  });

  it('requires a mood, and leaves the optional ratings out when not chosen', async () => {
    serve({
      'GET /checkins': () => json(200, { data: [] }),
      'GET /events/today': () => json(200, { data: [] }),
      'POST /checkins': () => json(201, checkin()),
    });
    open();
    await choose(/Check-in/);
    await choose(/Save check-in/);
    expect(screen.getByText('Pick how you are feeling.')).toBeInTheDocument();
    expect(writes()).toHaveLength(0);

    await choose(/Great/);
    await choose(/Save check-in/);
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(bodyOf(writes()[0]!)).toEqual({ mood: 'great' });
  });

  it('warns when today’s answer could not be loaded, and still lets the person save', async () => {
    serve({
      'GET /checkins': () => json(500, { error: { code: 'INTERNAL_ERROR', message: 'boom', requestId: 'r1' } }),
      'GET /events/today': () => json(200, { data: [] }),
    });
    open();
    await choose(/Check-in/);
    expect(await screen.findByText(/Couldn’t load today’s check-in/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Save check-in/ })).toBeEnabled();
  });
});

describe('Something else', () => {
  it('saves a sentence AURA cannot classify, as written', async () => {
    serve({ 'POST /events': () => json(201, event({ type: 'custom' })) });
    open();
    await choose(/Something else/);
    await describeAs('Tôi vừa nghỉ giải lao.');
    await choose(/Save activity/);

    await waitFor(() => expect(onSaved).toHaveBeenCalledWith('event-1', 'other'));
    expect(bodyOf(writes()[0]!)).toEqual({ type: 'custom', title: 'Tôi vừa nghỉ giải lao.' });
  });

  it('keeps a title, a duration read from the text, and the text as the note', async () => {
    serve({ 'POST /events': () => json(201, event({ type: 'custom' })) });
    open();
    await choose(/Something else/);
    await describeAs('I meditated for 10 minutes.');
    await userEvent.type(screen.getByLabelText(/Title/), 'Meditation');
    await choose(/Save activity/);

    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(bodyOf(writes()[0]!)).toEqual({
      type: 'custom',
      title: 'Meditation',
      durationMin: 10,
      note: 'I meditated for 10 minutes.',
    });
  });
});

describe('saving', () => {
  it('shows the server’s error, keeps every input, and lets the person try again', async () => {
    let attempt = 0;
    serve({
      'POST /events': () =>
        ++attempt === 1
          ? json(500, { error: { code: 'INTERNAL_ERROR', message: 'Something broke on our side.', requestId: 'req-9' } })
          : json(201, event()),
    });
    open();
    await choose(/I walked/);
    await describeAs('I walked for 30 minutes');
    await choose(/Save walk/);

    expect(await screen.findByRole('alert')).toHaveTextContent('Something broke on our side.');
    expect(screen.getByText('Request req-9')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Describe your walk' })).toHaveValue('I walked for 30 minutes');
    expect(screen.getByLabelText('Duration')).toHaveValue('30');
    expect(onSaved).not.toHaveBeenCalled();

    await choose(/Save walk/);
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
  });

  it('holds the button and the categories while saving, and sends once however often it is pressed', async () => {
    let release!: (response: Response) => void;
    serve({ 'POST /events': () => new Promise<Response>((resolve) => (release = resolve)) });
    open();
    await choose(/I drank water/);
    await choose(/^250 ml$/);

    const save = screen.getByRole('button', { name: /Log water/ });
    await userEvent.dblClick(save);
    await userEvent.click(save);

    expect(await screen.findByRole('button', { name: /Saving…/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /I walked/ })).toBeDisabled();
    expect(writes()).toHaveLength(1);

    await act(async () => release(json(201, event({ type: 'water' }))));
    expect(await screen.findByRole('button', { name: /Logged/ })).toBeDisabled();
    expect(writes()).toHaveLength(1);
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  it('says plainly when the network is down, after one silent second attempt with the same key', async () => {
    serve({
      'POST /events': () => {
        throw new TypeError('Failed to fetch');
      },
    });
    open();
    await choose(/I drank water/);
    await choose(/^250 ml$/);
    await choose(/Log water/);
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Log water/ })).toBeEnabled();
    expect(writes()).toHaveLength(2);
    expect(new Set(writes().map(keyOf)).size).toBe(1);
  });
});

describe('Idempotency-Key', () => {
  it('sends a key with every activity write', async () => {
    serve({ 'POST /events': () => json(201, event()) });
    open();
    await choose(/I walked/);
    await userEvent.type(screen.getByLabelText('Duration'), '30');
    await choose(/Save walk/);
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(keyOf(writes()[0]!)).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('recovers from a dropped answer without a second record: the resend carries the same key', async () => {
    let attempt = 0;
    serve({
      'POST /events': () => {
        attempt += 1;
        if (attempt === 1) throw new TypeError('Failed to fetch');
        return json(201, event());
      },
    });
    open();
    await choose(/I drank water/);
    await choose(/^250 ml$/);
    await choose(/Log water/);

    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    const [first, second] = writes();
    expect(keyOf(second!)).toBe(keyOf(first!));
  });

  it('reuses the key for “try again” on an unchanged form, and takes a new one once it is edited', async () => {
    const failure = () => json(500, { error: { code: 'INTERNAL_ERROR', message: 'Boom', requestId: 'r' } });
    serve({ 'POST /events': failure });
    open();
    await choose(/I walked/);
    await userEvent.type(screen.getByLabelText('Duration'), '30');

    await choose(/Save walk/);
    await screen.findByRole('alert');
    await choose(/Save walk/);
    await waitFor(() => expect(writes()).toHaveLength(2));
    expect(keyOf(writes()[1]!)).toBe(keyOf(writes()[0]!));

    await userEvent.type(screen.getByLabelText('Duration'), '5');
    await choose(/Save walk/);
    await waitFor(() => expect(writes()).toHaveLength(3));
    expect(keyOf(writes()[2]!)).not.toBe(keyOf(writes()[0]!));
  });
});

describe('accessibility of the choice groups', () => {
  it('describes the workout-type group by its error', async () => {
    open();
    await choose(/I worked out/);
    const group = screen.getByRole('group', { name: 'Kind of workout' });
    expect(group).not.toHaveAttribute('aria-describedby');

    await choose(/Save workout/);
    expect(group).toHaveAttribute('aria-describedby', 'workout-type-error');
    expect(group).toHaveAccessibleDescription('Pick what kind of workout this was.');
  });

  it('describes the mood group by its error', async () => {
    serve({ 'GET /checkins': () => json(200, { data: [] }), 'GET /events/today': () => json(200, { data: [] }) });
    open();
    await choose(/Check-in/);
    await screen.findByRole('button', { name: /Save check-in/ });
    await waitFor(() => expect(screen.getByRole('button', { name: /Save check-in/ })).toBeEnabled());

    await choose(/Save check-in/);
    const group = screen.getByRole('group', { name: 'Mood' });
    expect(group).toHaveAttribute('aria-describedby', 'checkin-mood-error');
    expect(group).toHaveAccessibleDescription('Pick how you are feeling.');
  });
});
