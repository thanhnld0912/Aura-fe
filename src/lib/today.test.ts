import { describe, expect, it } from 'vitest';
import type { DayEvent, PlanComparison, PlanComparisonItem } from './api';
import {
  eventsToSection,
  formatClock,
  formatDayHeading,
  greetingName,
  pickSpotlight,
  planHeadline,
  summarisePlan,
} from './today';

const item = (overrides: Partial<PlanComparisonItem> = {}): PlanComparisonItem =>
  ({
    planItemId: 'p1',
    planned: { title: 'Gym', time: '18:00', type: 'workout', durationMin: 60 },
    actual: null,
    adherence: 'pending',
    shiftMinutes: null,
    ...overrides,
  }) as PlanComparisonItem;

const comparison = (items: PlanComparisonItem[], adherencePct: number | null = null): PlanComparison =>
  ({ localDate: '2026-09-18', adherencePct, items, unplanned: [] }) as PlanComparison;

const event = (overrides: Partial<DayEvent> = {}): DayEvent =>
  ({
    id: 'e1',
    type: 'walk',
    occurredAt: '2026-09-18T11:30:00.000Z',
    localDate: '2026-09-18',
    title: 'Evening walk',
    durationMin: 40,
    note: null,
    inputMethod: 'manual',
    source: 'user',
    metrics: null,
    detail: null,
    ...overrides,
  }) as DayEvent;

describe('summarisePlan', () => {
  it('counts the server adherence values into done, changed and upcoming', () => {
    const summary = summarisePlan(
      comparison(
        [
          item({ adherence: 'on_time' }),
          item({ adherence: 'on_time' }),
          item({ adherence: 'shifted', shiftMinutes: 30 }),
          item({ adherence: 'substituted' }),
          item({ adherence: 'pending' }),
        ],
        100,
      ),
    );
    expect(summary).toEqual({ total: 5, done: 2, changed: 2, upcoming: 1, adherencePct: 100 });
  });

  it('passes a null percentage through rather than inventing a zero', () => {
    expect(summarisePlan(comparison([item()], null)).adherencePct).toBeNull();
  });
});

describe('planHeadline', () => {
  it('states facts only', () => {
    expect(planHeadline(null)).toMatch(/No plan for today yet/);
    expect(planHeadline({ total: 0, done: 0, changed: 0, upcoming: 0, adherencePct: null })).toMatch(/no items yet/);
    expect(planHeadline({ total: 4, done: 1, changed: 1, upcoming: 2, adherencePct: 100 })).toBe(
      '2 of 4 planned things done so far.',
    );
    expect(planHeadline({ total: 1, done: 1, changed: 0, upcoming: 0, adherencePct: 100 })).toBe(
      '1 of 1 planned thing done so far.',
    );
  });
});

describe('pickSpotlight', () => {
  it('prefers a change of plan, and labels it from the server shift', () => {
    const spotlight = pickSpotlight(
      comparison([
        item({ adherence: 'on_time', planned: { title: 'Breakfast', time: '07:00', type: 'meal', durationMin: null } }),
        item({
          adherence: 'shifted',
          shiftMinutes: -30,
          actual: { id: 'e1', title: 'Walk', time: '18:30', type: 'walk', durationMin: 40 },
        }),
      ]),
    );
    expect(spotlight).toEqual({
      planned: { title: 'Gym', time: '18:00' },
      actual: { title: 'Walk', time: '18:30' },
      label: 'Shifted 30 min',
      tone: 'success',
    });
  });

  it('falls back to the next item due, with nothing invented for what happened', () => {
    const spotlight = pickSpotlight(comparison([item({ adherence: 'pending' })]));
    expect(spotlight?.actual).toBeNull();
    expect(spotlight?.label).toBe('Upcoming');
  });

  it('shows nothing without a plan, or with an empty one', () => {
    expect(pickSpotlight(null)).toBeNull();
    expect(pickSpotlight(comparison([]))).toBeNull();
  });
});

describe('eventsToSection', () => {
  it('lists non-meal events oldest first, at their time in the profile timezone', () => {
    const section = eventsToSection(
      [
        event({ id: 'late', occurredAt: '2026-09-18T11:30:00.000Z', title: 'Evening walk' }),
        event({ id: 'meal', type: 'meal', title: 'Lunch' }),
        event({ id: 'early', type: 'water', occurredAt: '2026-09-18T01:05:00.000Z', title: 'Water', durationMin: null }),
      ],
      'Asia/Ho_Chi_Minh',
    );
    expect(section?.events.map((e) => e.id)).toEqual(['early', 'late']);
    expect(section?.events[0]).toMatchObject({ time: '08:05', title: '💧 Water', description: '' });
    expect(section?.events[1]).toMatchObject({ time: '18:30', description: '40 min' });
  });

  it('leaves meals to the meals endpoint, so a meal is never listed twice', () => {
    expect(eventsToSection([event({ type: 'meal' })], 'Asia/Ho_Chi_Minh')).toBeNull();
  });

  it('carries the user note, and nothing when there is none', () => {
    const [withNote, without] = eventsToSection(
      [event({ id: 'a', note: 'felt good' }), event({ id: 'b', occurredAt: '2026-09-18T12:00:00.000Z' })],
      'UTC',
    )!.events;
    expect(withNote?.note).toEqual({ title: 'Note', content: 'felt good' });
    expect(without?.note).toBeUndefined();
  });
});

describe('who and when', () => {
  it('greets by display name, or not at all', () => {
    expect(greetingName({ displayName: '  Thanh ' })).toBe('Thanh');
    expect(greetingName({ displayName: '' })).toBeNull();
    expect(greetingName(null)).toBeNull();
  });

  it('formats in the profile timezone, and survives an unknown one', () => {
    const instant = new Date('2026-09-17T18:30:00.000Z');
    expect(formatDayHeading(instant, 'Asia/Ho_Chi_Minh')).toBe('Friday, September 18');
    expect(formatClock(instant, 'Asia/Ho_Chi_Minh')).toBe('01:30');
    expect(() => formatClock(instant, 'Not/AZone')).not.toThrow();
  });
});
