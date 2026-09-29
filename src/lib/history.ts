import type { HistoryEvent } from './api';
import { EVENT_ICON, formatClock } from './today';

/**
 * History pages → what `HistoryView` renders.
 *
 * Pure, like `today.ts`. Two rules hold throughout:
 *
 * - **The server owns the order.** `GET /api/events` returns newest first, and pages are
 *   kept in the order they arrived. Nothing here sorts.
 * - **The server owns the day.** An event is filed under its `localDate`, which the
 *   server fixed from the profile timezone when the event was written. The browser does
 *   not work out which day an instant belongs to.
 */

/**
 * The next page appended to what is already loaded.
 *
 * Keyset pagination cannot repeat a row on its own, but an event edited between two
 * page loads can move across the page boundary. Should that happen the first sighting
 * is kept, so nothing is listed twice and nothing already shown moves.
 */
export function appendPage(loaded: readonly HistoryEvent[], page: readonly HistoryEvent[]): HistoryEvent[] {
  const seen = new Set(loaded.map((event) => event.id));
  return [...loaded, ...page.filter((event) => !seen.has(event.id))];
}

export interface HistoryEntry {
  id: string;
  /** "18:30", in the profile timezone. */
  time: string;
  /** Icon and the event's own title. */
  title: string;
  /** "40 min", or `null` when the event has no duration. */
  duration: string | null;
  note: string | null;
}

export interface HistoryDay {
  /** The server's `localDate` — YYYY-MM-DD. */
  localDate: string;
  /** "Thursday, September 3". */
  heading: string;
  entries: HistoryEntry[];
}

/**
 * A `YYYY-MM-DD` as "Thursday, September 3". The date is already the user's calendar
 * day, so it is formatted as a date, in UTC, where it cannot slip to a neighbour.
 */
export function formatLocalDate(localDate: string): string {
  const instant = new Date(`${localDate}T12:00:00Z`);
  if (Number.isNaN(instant.getTime())) return localDate;
  return new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' }).format(
    instant,
  );
}

/**
 * Consecutive events sharing a `localDate` become one day, in the order received. A day
 * split across two pages is one day again once the second page is appended.
 */
export function groupByDay(events: readonly HistoryEvent[], timeZone: string | undefined): HistoryDay[] {
  const days: HistoryDay[] = [];
  for (const event of events) {
    let day = days.at(-1);
    if (!day || day.localDate !== event.localDate) {
      day = { localDate: event.localDate, heading: formatLocalDate(event.localDate), entries: [] };
      days.push(day);
    }
    day.entries.push({
      id: event.id,
      time: formatClock(new Date(event.occurredAt), timeZone),
      title: `${EVENT_ICON[event.type]} ${event.title}`,
      duration: event.durationMin ? `${event.durationMin} min` : null,
      note: event.note,
    });
  }
  return days;
}
