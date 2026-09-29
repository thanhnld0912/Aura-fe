import type { Adherence, AuraUser, DayEvent, EventType, PlanComparison, PlanComparisonItem } from './api';
import type { TimelineEvent, TimelineSection } from '../types';

/**
 * The day's plan and events → what `TodayView` renders.
 *
 * Pure, like `meals.ts`: no React, no fetch, and no clock of its own — the time is
 * passed in. The same rule applies. Every judgement here was already made by the
 * backend: which event satisfied which plan item, whether it was on time, and the
 * adherence percentage all come from `daily-plans/reconciliation.ts`. This file counts
 * and labels what it was handed; it never decides whether a day went well.
 */

// ── The plan ───────────────────────────────────────────────────────────────────

export interface PlanSummary {
  /** Planned items in total. */
  total: number;
  /** Done as planned (`on_time`). */
  done: number;
  /** Done differently — at another time (`shifted`) or as something else (`substituted`). */
  changed: number;
  /** Not yet due (`pending`). The day is still going, so these are not misses. */
  upcoming: number;
  /** 0–100 from the server, or `null` while nothing has resolved yet. */
  adherencePct: number | null;
}

const count = (items: readonly PlanComparisonItem[], ...kinds: Adherence[]) =>
  items.filter((item) => kinds.includes(item.adherence)).length;

export function summarisePlan(comparison: PlanComparison): PlanSummary {
  const { items } = comparison;
  return {
    total: items.length,
    done: count(items, 'on_time'),
    changed: count(items, 'shifted', 'substituted'),
    upcoming: count(items, 'pending'),
    adherencePct: comparison.adherencePct ?? null,
  };
}

/**
 * The hero card's one line, stated as facts. The prototype's sentence ("your energy is
 * staying steady") claimed things nothing measures; this one says only what the plan
 * comparison contains.
 */
export function planHeadline(summary: PlanSummary | null): string {
  if (!summary) return 'No plan for today yet — everything you log still counts.';
  if (summary.total === 0) return 'Your plan for today has no items yet.';
  const happened = summary.done + summary.changed;
  const noun = summary.total === 1 ? 'thing' : 'things';
  return `${happened} of ${summary.total} planned ${noun} done so far.`;
}

export interface Spotlight {
  planned: { title: string; time: string };
  /** `null` when nothing has been matched to the planned item yet. */
  actual: { title: string; time: string } | null;
  label: string;
  tone: 'success' | 'neutral' | 'warning';
}

const ADHERENCE_LABEL: Record<Adherence, (item: PlanComparisonItem) => string> = {
  on_time: () => 'On time',
  shifted: (item) =>
    item.shiftMinutes ? `Shifted ${Math.abs(item.shiftMinutes)} min` : 'Shifted',
  substituted: () => 'Swapped',
  pending: () => 'Upcoming',
  not_logged: () => 'Not logged',
};

const ADHERENCE_TONE: Record<Adherence, Spotlight['tone']> = {
  on_time: 'success',
  shifted: 'success',
  substituted: 'success',
  pending: 'neutral',
  not_logged: 'warning',
};

/**
 * Which one plan item the spotlight shows. A change of plan is the most useful thing to
 * reflect back — the card exists to say "that still counts" — so a shifted or swapped
 * item wins, then one done as planned, then the next one due. Choosing what to *show*
 * is presentation; whether the item was on time is still the server's answer.
 */
export function pickSpotlight(comparison: PlanComparison | null): Spotlight | null {
  if (!comparison) return null;
  const order: Adherence[][] = [['shifted', 'substituted'], ['on_time'], ['pending'], ['not_logged']];

  for (const kinds of order) {
    const item = comparison.items.find((candidate) => kinds.includes(candidate.adherence));
    if (!item) continue;
    return {
      planned: { title: item.planned.title, time: item.planned.time },
      actual: item.actual ? { title: item.actual.title, time: item.actual.time } : null,
      label: ADHERENCE_LABEL[item.adherence](item),
      tone: ADHERENCE_TONE[item.adherence],
    };
  }
  return null;
}

// ── Events that are not meals ──────────────────────────────────────────────────

/**
 * Presentation only. Today never shows the meal one — `meals.ts` renders meals from their
 * own endpoint — but History lists every event type, so the map covers them all.
 */
export const EVENT_ICON: Record<EventType, string> = {
  meal: '🍱',
  workout: '🏋️',
  walk: '🚶',
  sleep: '😴',
  water: '💧',
  habit: '✅',
  checkin: '⚡',
  custom: '✨',
};

/**
 * The day's non-meal events as one timeline section, oldest first, or `null` when there
 * are none. Meals are left out on purpose: `GET /api/meals/today` carries their
 * nutrition, and listing a meal twice would read as two meals.
 */
export function eventsToSection(events: readonly DayEvent[], timeZone: string | undefined): TimelineSection | null {
  const others = events
    .filter((event): event is DayEvent & { type: Exclude<EventType, 'meal'> } => event.type !== 'meal')
    .slice()
    .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
  if (others.length === 0) return null;

  return {
    id: 'moments',
    period: 'Other moments',
    timeRange: '',
    icon: '🌿',
    events: others.map((event): TimelineEvent => ({
      id: event.id,
      time: formatClock(new Date(event.occurredAt), timeZone),
      title: `${EVENT_ICON[event.type]} ${event.title}`,
      description: event.durationMin ? `${event.durationMin} min` : '',
      ...(event.note ? { note: { title: 'Note', content: event.note } } : {}),
    })),
  };
}

// ── Who and when ───────────────────────────────────────────────────────────────

/** The name to greet, or `null` — the profile may have none, and one is not invented. */
export function greetingName(user: Pick<AuraUser, 'displayName'> | null): string | null {
  const name = user?.displayName?.trim();
  return name ? name : null;
}

/**
 * Formats in the profile's timezone, which is the one the server uses for "today".
 * An unknown zone falls back to the browser's rather than throwing out of a render.
 */
function format(instant: Date, timeZone: string | undefined, options: Intl.DateTimeFormatOptions): string {
  try {
    return new Intl.DateTimeFormat('en-US', { ...options, ...(timeZone ? { timeZone } : {}) }).format(instant);
  } catch {
    return new Intl.DateTimeFormat('en-US', options).format(instant);
  }
}

/** "Friday, September 4". */
export function formatDayHeading(instant: Date, timeZone: string | undefined): string {
  return format(instant, timeZone, { weekday: 'long', month: 'long', day: 'numeric' });
}

/** "16:45" — 24-hour, as the rest of the app writes times. */
export function formatClock(instant: Date, timeZone: string | undefined): string {
  return format(instant, timeZone, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
}
