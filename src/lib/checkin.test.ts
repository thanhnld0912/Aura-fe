import { describe, expect, it } from 'vitest';
import type { Checkin, DayEvent } from './api';
import { findTodaysCheckin, formFromCheckin, isMood, sameForm, toCheckinInput } from './checkin';

const saved = (overrides: Partial<Checkin> = {}): Checkin =>
  ({
    id: 'c1',
    eventId: 'ev-today',
    localDate: '2026-09-18',
    mood: 'good',
    dayTag: 'busy',
    energy1to5: null,
    note: 'long day',
    createdAt: '2026-09-18T10:00:00.000Z',
    ...overrides,
  }) as Checkin;

describe('toCheckinInput', () => {
  it('sends the whole form in the contract shape, and no date', () => {
    expect(toCheckinInput({ mood: 'great', dayTag: 'better_than_expected', note: 'ran 5k' })).toEqual({
      mood: 'great',
      dayTag: 'better_than_expected',
      note: 'ran 5k',
    });
  });

  it('leaves out a blank note — which is how the server is told to clear it', () => {
    expect(toCheckinInput({ mood: 'okay', dayTag: 'normal', note: '   ' })).toEqual({ mood: 'okay', dayTag: 'normal' });
  });

  it('never sends a null the strict schema would reject', () => {
    const input = toCheckinInput({ mood: 'low', dayTag: null, note: '' });
    expect(input).toEqual({ mood: 'low' });
    expect(Object.values(input)).not.toContain(null);
  });
});

describe('formFromCheckin and sameForm', () => {
  it('round-trips a saved check-in into the form', () => {
    expect(formFromCheckin(saved())).toEqual({ mood: 'good', dayTag: 'busy', note: 'long day' });
    expect(formFromCheckin(saved({ note: null, dayTag: null }))).toEqual({ mood: 'good', dayTag: null, note: '' });
  });

  it('treats a blank note as no note, and any other change as a change', () => {
    const base = { mood: 'good' as const, dayTag: 'busy' as const, note: '' };
    expect(sameForm(base, { ...base, note: '  ' })).toBe(true);
    expect(sameForm(base, { ...base, mood: 'great' })).toBe(false);
    expect(sameForm(base, { ...base, dayTag: 'normal' })).toBe(false);
    expect(sameForm(base, { ...base, note: 'x' })).toBe(false);
  });
});

describe('findTodaysCheckin', () => {
  const event = (id: string, type: DayEvent['type']) => ({ id, type }) as DayEvent;

  it("finds today's by the server's own event link, not by a date the browser worked out", () => {
    const yesterday = saved({ id: 'old', eventId: 'ev-old', localDate: '2026-09-17' });
    const today = saved();
    expect(findTodaysCheckin([yesterday, today], [event('ev-today', 'checkin')])).toBe(today);
  });

  it('finds nothing when today has no check-in event', () => {
    expect(findTodaysCheckin([saved()], [event('ev-today', 'walk'), event('other', 'checkin')])).toBeNull();
    expect(findTodaysCheckin([], [])).toBeNull();
  });
});

describe('isMood', () => {
  it('accepts exactly the contract moods', () => {
    expect(['low', 'okay', 'good', 'great'].every(isMood)).toBe(true);
    expect(isMood('amazing')).toBe(false);
  });
});
