import { describe, expect, it } from 'vitest';
import type { HistoryEvent } from './api';
import { appendPage, formatLocalDate, groupByDay } from './history';

const event = (id: string, occurredAt: string, localDate: string, overrides: Partial<HistoryEvent> = {}): HistoryEvent =>
  ({
    id,
    type: 'walk',
    occurredAt,
    localDate,
    title: `Event ${id}`,
    durationMin: null,
    note: null,
    inputMethod: 'manual',
    source: 'user',
    metrics: null,
    detail: null,
    ...overrides,
  }) as HistoryEvent;

describe('appendPage', () => {
  it('keeps the loaded page and adds the next one after it, in the order received', () => {
    const first = [event('c', '2026-09-28T10:00:00Z', '2026-09-28'), event('b', '2026-09-27T10:00:00Z', '2026-09-27')];
    const second = [event('a', '2026-09-26T10:00:00Z', '2026-09-26')];
    expect(appendPage(first, second).map((e) => e.id)).toEqual(['c', 'b', 'a']);
    // The first page is not replaced or reordered.
    expect(first.map((e) => e.id)).toEqual(['c', 'b']);
  });

  it('never lists an event twice, keeping where it was first shown', () => {
    const first = [event('c', '2026-09-28T10:00:00Z', '2026-09-28'), event('b', '2026-09-27T10:00:00Z', '2026-09-27')];
    const second = [event('b', '2026-09-27T09:00:00Z', '2026-09-27'), event('a', '2026-09-26T10:00:00Z', '2026-09-26')];
    expect(appendPage(first, second).map((e) => e.id)).toEqual(['c', 'b', 'a']);
  });
});

describe('groupByDay', () => {
  it("files each event under the server's localDate and shows its time in the profile timezone", () => {
    // 17:30Z is already the next calendar day in Ho Chi Minh City (UTC+7).
    const days = groupByDay(
      [event('late', '2026-09-27T17:30:00Z', '2026-09-28', { type: 'checkin', title: 'Check-in', note: 'tired' })],
      'Asia/Ho_Chi_Minh',
    );
    expect(days).toEqual([
      {
        localDate: '2026-09-28',
        heading: 'Monday, September 28',
        entries: [{ id: 'late', time: '00:30', title: '⚡ Check-in', duration: null, note: 'tired' }],
      },
    ]);

    // The same instant for a user in New York.
    expect(groupByDay([event('late', '2026-09-27T17:30:00Z', '2026-09-27')], 'America/New_York')[0]!.entries[0]!.time).toBe(
      '13:30',
    );
  });

  it('keeps the server order within and across days — it never sorts', () => {
    const days = groupByDay(
      [
        event('3', '2026-09-28T12:00:00Z', '2026-09-28'),
        event('2', '2026-09-28T08:00:00Z', '2026-09-28'),
        event('1', '2026-09-26T08:00:00Z', '2026-09-26'),
      ],
      'UTC',
    );
    expect(days.map((d) => d.localDate)).toEqual(['2026-09-28', '2026-09-26']);
    expect(days[0]!.entries.map((e) => e.id)).toEqual(['3', '2']);
  });

  it('joins a day that was split across two pages', () => {
    const page1 = [event('b', '2026-09-28T12:00:00Z', '2026-09-28')];
    const page2 = [event('a', '2026-09-28T08:00:00Z', '2026-09-28')];
    const days = groupByDay(appendPage(page1, page2), 'UTC');
    expect(days).toHaveLength(1);
    expect(days[0]!.entries.map((e) => e.id)).toEqual(['b', 'a']);
  });

  it('labels every event type, meals included, and shows a duration only when there is one', () => {
    const [day] = groupByDay(
      [
        event('m', '2026-09-28T05:00:00Z', '2026-09-28', { type: 'meal', title: 'Lunch' }),
        event('w', '2026-09-28T04:00:00Z', '2026-09-28', { type: 'workout', title: 'Gym', durationMin: 45 }),
      ],
      'UTC',
    );
    expect(day!.entries.map((e) => [e.title, e.duration])).toEqual([
      ['🍱 Lunch', null],
      ['🏋️ Gym', '45 min'],
    ]);
  });

  it('returns no days for no events', () => {
    expect(groupByDay([], 'UTC')).toEqual([]);
  });
});

describe('formatLocalDate', () => {
  it('formats the calendar date itself, whatever the browser timezone', () => {
    expect(formatLocalDate('2026-09-03')).toBe('Thursday, September 3');
    expect(formatLocalDate('2026-01-01')).toBe('Thursday, January 1');
  });
});
