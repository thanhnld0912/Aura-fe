import { describe, expect, it } from 'vitest';
import {
  buildRequest,
  emptyForm,
  readDistanceKm,
  readDuration,
  readSleep,
  readText,
  readWater,
  readWorkout,
  sleepTiming,
  titleFromText,
} from './activity';

/** 08:00 local on a fixed day. Local, because the forms work in the browser's time. */
const NOW = new Date(2026, 9, 27, 8, 0, 0);

describe('readDuration', () => {
  it.each([
    ['I did strength training for 45 minutes.', 45],
    ['Tôi tập gym 45 phút.', 45],
    ['Vừa hoàn thành 30 phút đi bộ nhẹ nhàng.', 30],
    ['walked 2.5 km in 35 min', 35],
    ['1h30 yoga', 90],
    ['1 tiếng 30 phút', 90],
    ['1 tiếng rưỡi', 90],
    ['1.5 hours', 90],
    ['2 giờ 15 phút', 135],
    ['30p', 30],
  ])('reads %j as %d minutes', (text, minutes) => {
    expect(readDuration(text)).toBe(minutes);
  });

  it.each(['500 ml water', 'at 5 pm', 'went for a walk', '2.5 km'])('reads no duration in %j', (text) => {
    expect(readDuration(text)).toBeNull();
  });
});

describe('readDistanceKm', () => {
  it('reads kilometres and metres, and nothing else', () => {
    expect(readDistanceKm('I walked 2.5 km in 35 minutes')).toBe(2.5);
    expect(readDistanceKm('đi bộ 2,5 cây số')).toBe(2.5);
    expect(readDistanceKm('800 mét')).toBe(0.8);
    expect(readDistanceKm('I walked for 30 minutes')).toBeNull();
  });
});

describe('readWater', () => {
  it.each([
    ['500 ml water.', 500],
    ['I drank 750 ml of water.', 750],
    ['Đã uống 1 ly nước ấm 350ml.', 350],
    ['1.5 l', 1500],
    ['1 lít nước', 1000],
    ['I really drank 300 ml', 300],
  ])('reads %j as %d ml', (text, ml) => {
    expect(readWater(text)).toEqual({ amountMl: ml, clarification: null });
  });

  it('asks rather than guessing how much a glass holds', () => {
    const reading = readWater('Tôi vừa uống 2 cốc nước.');
    expect(reading.amountMl).toBeNull();
    expect(reading.clarification).toMatch(/how much a cốc holds/);
  });

  it('asks whether an amount is per glass or the total', () => {
    const reading = readWater('2 ly 250ml');
    expect(reading.amountMl).toBeNull();
    expect(reading.clarification).toMatch(/total, or for each ly/);
  });

  it('asks when the text names two different amounts', () => {
    expect(readWater('250 ml then 500 ml').clarification).toMatch(/more than one amount/);
  });

  it('says nothing about text with no amount in it', () => {
    expect(readWater('felt thirsty')).toEqual({ amountMl: null, clarification: null });
  });
});

describe('readSleep', () => {
  it('reads a duration in English and Vietnamese', () => {
    expect(readSleep('I slept for 7 hours.')).toEqual({ durationMin: 420, bedtime: null, wakeTime: null });
    expect(readSleep('Tôi ngủ được 7 tiếng.')).toEqual({ durationMin: 420, bedtime: null, wakeTime: null });
  });

  it('reads bedtime and wake-up time', () => {
    expect(readSleep('I went to bed at 11 PM and woke up at 6 AM.')).toEqual({
      durationMin: null,
      bedtime: '23:00',
      wakeTime: '06:00',
    });
    expect(readSleep('đi ngủ lúc 10 giờ tối, dậy lúc 6 giờ sáng')).toEqual({
      durationMin: null,
      bedtime: '22:00',
      wakeTime: '06:00',
    });
    expect(readSleep('Chuẩn bị đi ngủ lúc 22:30.').bedtime).toBe('22:30');
    expect(readSleep('ngủ lúc 12 giờ đêm').bedtime).toBe('00:00');
  });

  it('does not take a duration for a time', () => {
    expect(readSleep('đi ngủ 8 tiếng')).toEqual({ durationMin: 480, bedtime: null, wakeTime: null });
  });
});

describe('readWorkout', () => {
  it.each([
    ['I did strength training for 45 minutes.', { workoutType: 'gym', name: 'Strength training', durationMin: 45, effort: null }],
    ['Tôi tập gym 45 phút.', { workoutType: 'gym', name: 'Gym', durationMin: 45, effort: null }],
    ['I cycled for 30 minutes at moderate intensity.', { workoutType: 'other', name: 'Cycling', durationMin: 30, effort: 3 }],
    ['chạy bộ nhẹ 20 phút', { workoutType: 'run', name: 'Run', durationMin: 20, effort: 2 }],
  ])('reads %j', (text, expected) => {
    expect(readWorkout(text)).toEqual(expected);
  });

  it('leaves the type empty rather than guessing it', () => {
    expect(readWorkout('worked out for an hour').workoutType).toBeNull();
  });
});

describe('readText', () => {
  it('returns only the fields the text says something about', () => {
    expect(readText('walk', 'I walked for 30 minutes')).toEqual({ durationMin: '30' });
    expect(readText('water', 'Tôi vừa uống 2 cốc nước')).toEqual({});
    expect(readText('sleep', 'I slept for 7.5 hours')).toEqual({ durationHours: '7.5' });
    expect(readText('check-in', 'feeling great')).toEqual({});
  });
});

describe('buildRequest', () => {
  it('sends a workout to /workouts, without fields nobody entered', () => {
    const form = { ...emptyForm('workout', NOW), workoutType: 'gym' as const, durationMin: '45' };
    expect(buildRequest('workout', form, '', NOW)).toEqual({
      ok: true,
      request: { endpoint: 'workouts', body: { workoutType: 'gym', durationMin: 45 } },
    });
  });

  it('keeps a workout’s name, effort and note when given', () => {
    const form = { workoutType: 'other' as const, name: 'Cycling', durationMin: '30', effort: 3 };
    const result = buildRequest('workout', form, 'I cycled for 30 minutes', NOW);
    expect(result).toEqual({
      ok: true,
      request: {
        endpoint: 'workouts',
        body: { workoutType: 'other', title: 'Cycling', durationMin: 30, perceivedEffort: 3, note: 'I cycled for 30 minutes' },
      },
    });
  });

  it.each([
    ['', 'Add how long it took, in minutes.'],
    ['0', 'Enter between 1 and 600 minutes.'],
    ['601', 'Enter between 1 and 600 minutes.'],
    ['12.5', 'Enter the duration in whole minutes.'],
    ['soon', 'Enter the duration in whole minutes.'],
  ])('rejects a workout duration of %j', (durationMin, message) => {
    const form = { ...emptyForm('workout', NOW), workoutType: 'gym' as const, durationMin };
    expect(buildRequest('workout', form, '', NOW)).toEqual({ ok: false, errors: { durationMin: message } });
  });

  it('requires a workout type', () => {
    const result = buildRequest('workout', { ...emptyForm('workout', NOW), durationMin: '30' }, '', NOW);
    expect(result).toEqual({ ok: false, errors: { workoutType: 'Pick what kind of workout this was.' } });
  });

  it('logs a walk with or without its distance', () => {
    expect(buildRequest('walk', { durationMin: '30', distanceKm: '' }, '', NOW)).toEqual({
      ok: true,
      request: { endpoint: 'events', body: { type: 'walk', title: 'Walk', durationMin: 30 } },
    });
    expect(buildRequest('walk', { durationMin: '35', distanceKm: '2,5' }, 'I walked 2.5 km', NOW)).toEqual({
      ok: true,
      request: {
        endpoint: 'events',
        body: { type: 'walk', title: 'Walk', durationMin: 35, metrics: { km: 2.5 }, note: 'I walked 2.5 km' },
      },
    });
  });

  it('rejects a walk with no duration or a nonsense distance', () => {
    expect(buildRequest('walk', { durationMin: '', distanceKm: '-1' }, '', NOW)).toEqual({
      ok: false,
      errors: {
        durationMin: 'Add how long you walked, in minutes.',
        distanceKm: 'Enter a distance between 0 and 100 km, or leave it empty.',
      },
    });
  });

  it('logs water as metrics.ml, the key the day’s summary adds up', () => {
    expect(buildRequest('water', { amountMl: '500' }, '', NOW)).toEqual({
      ok: true,
      request: { endpoint: 'events', body: { type: 'water', title: 'Water', metrics: { ml: 500 } } },
    });
  });

  it.each([
    ['', 'Enter how much you drank, in ml.'],
    ['0', 'Enter a whole number of ml, between 1 and 5000.'],
    ['2.5', 'Enter a whole number of ml, between 1 and 5000.'],
    ['9000', 'Enter a whole number of ml, between 1 and 5000.'],
  ])('rejects a water amount of %j', (amountMl, message) => {
    expect(buildRequest('water', { amountMl }, '', NOW)).toEqual({ ok: false, errors: { amountMl: message } });
  });

  it('logs a sleep from its start, which the summary reads as bedtime', () => {
    const result = buildRequest('sleep', { durationHours: '', bedtime: '23:00', wakeTime: '06:00' }, '', NOW);
    expect(result).toEqual({
      ok: true,
      request: {
        endpoint: 'events',
        body: { type: 'sleep', title: 'Sleep', occurredAt: new Date(2026, 9, 26, 23, 0).toISOString(), durationMin: 420 },
      },
    });
  });

  it('rejects a sleep with nothing to measure it by', () => {
    expect(buildRequest('sleep', { durationHours: '', bedtime: '', wakeTime: '07:00' }, '', NOW)).toEqual({
      ok: false,
      errors: { duration: 'Add how long you slept, or when you went to bed.' },
    });
    expect(buildRequest('sleep', { durationHours: '30', bedtime: '', wakeTime: '07:00' }, '', NOW)).toEqual({
      ok: false,
      errors: { duration: 'Enter between 0 and 16 hours.' },
    });
  });

  it('sends the whole check-in, leaving out only what was not chosen', () => {
    expect(buildRequest('check-in', { mood: 'good', dayTag: null, energy: null }, '', NOW)).toEqual({
      ok: true,
      request: { endpoint: 'checkins', body: { mood: 'good' } },
    });
    expect(buildRequest('check-in', { mood: 'low', dayTag: 'busy', energy: 2 }, 'long day', NOW)).toEqual({
      ok: true,
      request: { endpoint: 'checkins', body: { mood: 'low', dayTag: 'busy', energy1to5: 2, note: 'long day' } },
    });
    expect(buildRequest('check-in', { mood: null, dayTag: null, energy: 4 }, '', NOW)).toEqual({
      ok: false,
      errors: { mood: 'Pick how you are feeling.' },
    });
  });

  it('saves something else as a custom event, titled from the text when untitled', () => {
    expect(buildRequest('other', { title: '', durationMin: '10' }, 'I meditated for 10 minutes.', NOW)).toEqual({
      ok: true,
      request: { endpoint: 'events', body: { type: 'custom', title: 'I meditated for 10 minutes.', durationMin: 10 } },
    });
    expect(buildRequest('other', { title: 'Break', durationMin: '' }, 'Tôi vừa nghỉ giải lao.', NOW)).toEqual({
      ok: true,
      request: { endpoint: 'events', body: { type: 'custom', title: 'Break', note: 'Tôi vừa nghỉ giải lao.' } },
    });
    expect(buildRequest('other', { title: '', durationMin: '' }, '   ', NOW)).toEqual({
      ok: false,
      errors: { title: 'Give it a name, or describe what happened.' },
    });
  });

  it('keeps a long sentence as the note when only its start fits in the title', () => {
    const text = 'Spent the afternoon reorganising the whole kitchen, then walked to the market and back with my sister';
    const result = buildRequest('other', { title: '', durationMin: '' }, text, NOW);
    expect(result.ok && result.request.body).toMatchObject({ title: titleFromText(text), note: text });
    expect(titleFromText(text).length).toBeLessThanOrEqual(80);
  });

  it('refuses a note the server would refuse', () => {
    const result = buildRequest('water', { amountMl: '250' }, 'x'.repeat(501), NOW);
    expect(result).toEqual({ ok: false, errors: { text: 'Keep it under 500 characters.' } });
  });
});

describe('sleepTiming — the 16-hour limit', () => {
  const TOO_LONG = 'That’s over 16 hours of sleep — check your bedtime and wake-up time.';
  const timesFor = (bedtime: string, wakeTime: string) => sleepTiming({ durationHours: '', bedtime, wakeTime }, NOW);

  it('accepts an ordinary night across midnight', () => {
    expect(timesFor('23:15', '06:45')).toMatchObject({ durationMin: 450, error: null });
    // 16 hours exactly is still one sleep.
    expect(timesFor('14:00', '06:00')).toMatchObject({ durationMin: 960, error: null });
  });

  it('flags times that only make sense as most of a day, instead of saving them', () => {
    // A same-day pair the wrong way round reads as 23 hours, across midnight.
    expect(timesFor('08:00', '07:00')).toEqual({ durationMin: null, start: null, error: TOO_LONG });
    // "đi ngủ lúc 22:30" typed at 21:00, with the wake-up left at "now".
    expect(timesFor('22:30', '21:00')).toEqual({ durationMin: null, start: null, error: TOO_LONG });
    expect(timesFor('13:59', '06:00').error).toBe(TOO_LONG);
  });

  it('still rejects identical times as their own mistake', () => {
    expect(timesFor('07:00', '07:00').error).toBe('Bedtime and wake-up time are the same.');
  });

  it('keeps a typed duration, within the same limit', () => {
    const typed = (durationHours: string) => sleepTiming({ durationHours, bedtime: '', wakeTime: '07:00' }, NOW);
    expect(typed('16')).toMatchObject({ durationMin: 960, error: null });
    expect(typed('7,5')).toMatchObject({ durationMin: 450, error: null });
    expect(typed('16.5').error).toBe('Enter between 0 and 16 hours.');
  });

  it('never clamps: an over-long sleep produces no request at all', () => {
    expect(buildRequest('sleep', { durationHours: '', bedtime: '08:00', wakeTime: '07:00' }, '', NOW)).toEqual({
      ok: false,
      errors: { duration: TOO_LONG },
    });
  });
});

describe('sleepTiming', () => {
  it('treats a bedtime later than the wake-up as the night before', () => {
    const timing = sleepTiming({ durationHours: '', bedtime: '22:30', wakeTime: '06:15' }, NOW);
    expect(timing.durationMin).toBe(465);
    expect(timing.start).toEqual(new Date(2026, 9, 26, 22, 30));
  });

  it('anchors a duration at the wake-up time', () => {
    const timing = sleepTiming({ durationHours: '7', bedtime: '', wakeTime: '07:00' }, NOW);
    expect(timing.start).toEqual(new Date(2026, 9, 27, 0, 0));
  });

  it('puts a wake-up time later than now on the previous day', () => {
    const timing = sleepTiming({ durationHours: '8', bedtime: '', wakeTime: '09:00' }, NOW);
    expect(timing.start).toEqual(new Date(2026, 9, 26, 1, 0));
  });

  it('anchors a bedtime and a duration at the most recent night that has ended', () => {
    const timing = sleepTiming({ durationHours: '7', bedtime: '23:00', wakeTime: '' }, NOW);
    expect(timing.start).toEqual(new Date(2026, 9, 26, 23, 0));
  });
});
