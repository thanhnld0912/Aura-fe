import { MOODS, type Checkin, type CheckinInput, type DayEvent, type DayTag, type Mood } from './api';

/**
 * The check-in form ↔ the check-in contract.
 *
 * Pure. The vocabulary is the server's (`checkins.routes.ts`), which was itself taken
 * from this UI: the four moods are the same ids, and the four day tags are the four
 * pills. Nothing here adds a field the contract does not have.
 */

/** The pill text the UI already shows, keyed by the value the server stores. */
export const DAY_TAG_LABEL: Record<DayTag, string> = {
  normal: 'Pretty normal',
  busy: 'Busy',
  better_than_expected: 'Better than expected',
  not_as_planned: "Didn't go as planned",
};

export interface CheckinForm {
  mood: Mood;
  /** `null` only when a check-in saved elsewhere carried no tag; this form always sets one. */
  dayTag: DayTag | null;
  note: string;
}

export function isMood(value: string): value is Mood {
  return (MOODS as readonly string[]).includes(value);
}

/**
 * The request for a form. The *whole* form, every time: the server upserts the day's
 * check-in and a field left out is cleared rather than kept. An empty note is left out
 * on purpose — that is how a note is removed.
 */
export function toCheckinInput(form: CheckinForm): CheckinInput {
  return {
    mood: form.mood,
    ...(form.dayTag ? { dayTag: form.dayTag } : {}),
    ...(form.note.trim().length > 0 ? { note: form.note } : {}),
  };
}

export function formFromCheckin(checkin: Checkin): CheckinForm {
  return { mood: checkin.mood, dayTag: checkin.dayTag ?? null, note: checkin.note ?? '' };
}

/** Whether the form says the same thing as what was saved. A blank note is no note. */
export function sameForm(a: CheckinForm, b: CheckinForm): boolean {
  return a.mood === b.mood && a.dayTag === b.dayTag && a.note.trim() === b.note.trim();
}

/**
 * Today's check-in, if there is one: the check-in whose event is among today's events.
 *
 * Matched through the server's own link (`eventId`) rather than by comparing dates, so
 * "today" stays the server's answer from the profile timezone — the frontend never
 * works out which calendar day it is.
 */
export function findTodaysCheckin(checkins: readonly Checkin[], todayEvents: readonly DayEvent[]): Checkin | null {
  const todays = new Set(todayEvents.filter((event) => event.type === 'checkin').map((event) => event.id));
  return checkins.find((checkin) => todays.has(checkin.eventId)) ?? null;
}
