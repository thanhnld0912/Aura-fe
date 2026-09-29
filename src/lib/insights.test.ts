import { describe, expect, it } from 'vitest';
import { insufficientWeek, sufficientWeek } from '../test/weekly';
import {
  LIMITATION_LABEL,
  comparisonLines,
  dayCells,
  formatRate,
  formatSleep,
  formatWait,
  formatWeekRange,
  statCards,
  weekProgress,
} from './insights';

describe('period', () => {
  it("shows the backend's own week, whatever the browser timezone", () => {
    expect(formatWeekRange({ weekStart: '2026-09-28', weekEnd: '2026-10-04' })).toBe('Sep 28 – Oct 4');
    expect(weekProgress(sufficientWeek().period)).toBe('Day 4 of 7');
    expect(weekProgress({ ...sufficientWeek().period, isComplete: true, daysElapsed: 7 })).toBe('Complete week');
  });
});

describe('number formatting', () => {
  it('keeps null as no-data and a real zero as zero', () => {
    expect(formatRate(null)).toBeNull();
    expect(formatRate(0)).toBe('0%');
    expect(formatRate(0.666)).toBe('67%');
    expect(formatSleep(null)).toBeNull();
    expect(formatSleep(425)).toBe('7h 05m');
    expect(formatSleep(40)).toBe('40m');
  });

  it('turns a Retry-After into words, and nothing into nothing', () => {
    expect(formatWait(undefined)).toBeNull();
    expect(formatWait(90)).toBe('2 min');
    expect(formatWait(3 * 3600 + 5)).toBe('4 h');
  });
});

describe('statCards', () => {
  it("shows the backend's figures as they came", () => {
    const cards = Object.fromEntries(statCards(sufficientWeek()).map((card) => [card.label, card]));
    expect(cards['Movement']).toMatchObject({ value: '2 days active', detail: '1 walk · 1 workout done' });
    expect(cards['Meals Logged']).toMatchObject({ value: '5 logged', detail: 'On 3 of 4 days' });
    expect(cards['Plan Adherence']).toMatchObject({ value: '67%', detail: '2 of 3 planned items happened' });
    expect(cards['Sleep Rest']).toMatchObject({ value: null, detail: 'No sleep logged' });
  });

  it('never turns a section with no data into a zero', () => {
    const cards = statCards(insufficientWeek());
    expect(cards.map((card) => card.value)).toEqual([null, null, null, null]);
    for (const card of cards) expect(card.detail).not.toMatch(/\b0\b/);
  });
});

describe('comparisonLines', () => {
  it("words the backend's delta and direction, and leaves out what it could not compare", () => {
    expect(comparisonLines(sufficientWeek().comparison)).toEqual([
      'Days with any log: 75%, up 18 points from last week',
    ]);
  });

  it('says "about the same" only when the backend called it flat', () => {
    const lines = comparisonLines({
      previousWeekStart: '2026-09-14',
      status: 'available',
      metrics: [{ metric: 'habit_completion', status: 'available', current: 0.5, previous: 0.45, delta: 0.05, direction: 'flat' }],
    });
    expect(lines).toEqual(['Habit completion: 50%, about the same as last week']);
  });

  it('has nothing to say when nothing could be compared', () => {
    expect(comparisonLines(insufficientWeek().comparison)).toEqual([]);
  });
});

describe('dayCells', () => {
  it('keeps "not logged" apart from "not yet"', () => {
    expect(dayCells(sufficientWeek()).map((d) => `${d.weekday}:${d.state}`)).toEqual([
      'Mon:logged',
      'Tue:not_logged',
      'Wed:logged',
      'Thu:logged',
      'Fri:upcoming',
      'Sat:upcoming',
      'Sun:upcoming',
    ]);
  });
});

describe('LIMITATION_LABEL', () => {
  it('words every limitation code the contract defines, without blame', () => {
    for (const label of Object.values(LIMITATION_LABEL)) {
      expect(label).not.toMatch(/fail|should|must|bad/i);
    }
  });
});
