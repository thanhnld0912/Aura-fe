import type {
  CheckinInput,
  CreateEventInput,
  CreateWorkoutInput,
  DayTag,
  Mood,
  WorkoutType,
} from './api';
import type { ActivityCategory } from '../types';

/**
 * Every logging category except food: what each form holds, what can be read out of a
 * sentence, and the exact request each one sends.
 *
 * Pure, like `checkin.ts` and `today.ts`: no React, no fetch, and no clock of its own —
 * "now" is passed in.
 *
 * ## Reading a sentence, without a model
 *
 * There is no AI behind these categories: the backend's parsers read meals and nothing
 * else. What this file does instead is deterministic and deliberately small — it picks
 * the figures a person actually wrote ("45 phút", "2.5 km", "500 ml", "11 PM") out of
 * the text and puts them in the form's fields, where they can be seen and corrected
 * before anything is saved. It never guesses: a figure it cannot read with certainty
 * — "2 cốc nước", which says nothing about how big a cốc is — is left empty and
 * the person is asked.
 */

export type ActivityKind = Exclude<ActivityCategory, 'eat'>;

export const ACTIVITY_KINDS: readonly ActivityKind[] = ['workout', 'walk', 'water', 'sleep', 'check-in', 'other'];

// ── Forms ──────────────────────────────────────────────────────────────────────

/** Numbers stay strings while they are being typed; they are parsed once, on save. */
export interface WorkoutForm {
  workoutType: WorkoutType | null;
  name: string;
  durationMin: string;
  /** How hard it felt, 1–5 — the person's own rating. */
  effort: number | null;
}

export interface WalkForm {
  durationMin: string;
  distanceKm: string;
}

export interface WaterForm {
  amountMl: string;
}

export interface SleepForm {
  durationHours: string;
  /** "HH:MM", local time, or empty. */
  bedtime: string;
  /** "HH:MM", local time, or empty. Filled with the current time when the form opens. */
  wakeTime: string;
}

export interface CheckinActivityForm {
  mood: Mood | null;
  dayTag: DayTag | null;
  energy: number | null;
}

export interface OtherForm {
  title: string;
  durationMin: string;
}

export interface ActivityForms {
  workout: WorkoutForm;
  walk: WalkForm;
  water: WaterForm;
  sleep: SleepForm;
  'check-in': CheckinActivityForm;
  other: OtherForm;
}

export type FormOf<K extends ActivityKind> = ActivityForms[K];
export type FieldOf<K extends ActivityKind> = keyof ActivityForms[K] & string;

const pad = (n: number) => String(n).padStart(2, '0');
const clock = (instant: Date) => `${pad(instant.getHours())}:${pad(instant.getMinutes())}`;

export function emptyForm<K extends ActivityKind>(kind: K, now: Date): FormOf<K> {
  const forms: ActivityForms = {
    workout: { workoutType: null, name: '', durationMin: '', effort: null },
    walk: { durationMin: '', distanceKm: '' },
    water: { amountMl: '' },
    // The wake-up time is shown, filled in and editable, rather than assumed silently:
    // a sleep needs an anchor in time, and "you just woke up" is the one a person can see
    // and change.
    sleep: { durationHours: '', bedtime: '', wakeTime: clock(now) },
    'check-in': { mood: null, dayTag: null, energy: null },
    other: { title: '', durationMin: '' },
  };
  return forms[kind] as FormOf<K>;
}

// ── Reading a sentence ─────────────────────────────────────────────────────────

/** Not a letter — `\b` does not understand Vietnamese. */
const END = '(?![\\p{L}\\p{N}])';
const NUM = '(\\d+(?:[.,]\\d+)?)';

const toNumber = (raw: string) => Number(raw.replace(',', '.'));
/** Trims a float to what a person would have written. */
const tidy = (value: number, digits = 2) => String(Number(value.toFixed(digits)));

const normalise = (text: string) => text.normalize('NFC').toLowerCase();

/** Minutes, from "45 phút", "1h30", "1 tiếng rưỡi", "1.5 hours", "2 giờ 15 phút". */
export function readDuration(text: string): number | null {
  const t = normalise(text);
  const HOURS = '(?:h|hr|hrs|hours?|giờ|gio|tiếng|tieng)';
  const MINUTES = '(?:min|mins|minutes?|phút|phut|p)';

  // "1h30", "1 tiếng 30 phút", "2 giờ 15" — hours with minutes after them.
  const compound = new RegExp(`(\\d+)\\s*${HOURS}\\s*(\\d{1,2})(?:\\s*${MINUTES})?${END}`, 'u').exec(t);
  if (compound) return Number(compound[1]) * 60 + Number(compound[2]);

  // "1 tiếng rưỡi" — an hour and a half.
  const half = new RegExp(`(\\d+)\\s*${HOURS}\\s*(?:rưỡi|ruoi)${END}`, 'u').exec(t);
  if (half) return Number(half[1]) * 60 + 30;

  const hours = new RegExp(`${NUM}\\s*${HOURS}${END}`, 'u').exec(t);
  const minutes = new RegExp(`(\\d+)\\s*${MINUTES}${END}`, 'u').exec(t);
  if (!hours && !minutes) return null;
  return Math.round((hours ? toNumber(hours[1]!) * 60 : 0) + (minutes ? Number(minutes[1]) : 0));
}

/** Kilometres, from "2.5 km", "2,5 cây số", "800 m" is not read — "m" is also minutes. */
export function readDistanceKm(text: string): number | null {
  const t = normalise(text);
  const km = new RegExp(`${NUM}\\s*(?:km|kilomet(?:er|re)s?|cây số|cay so)${END}`, 'u').exec(t);
  if (km) return toNumber(km[1]!);
  const metres = new RegExp(`(\\d+)\\s*(?:mét|met|meters?|metres?)${END}`, 'u').exec(t);
  return metres ? Number(metres[1]) / 1000 : null;
}

export interface WaterReading {
  amountMl: number | null;
  /** Set when the text names an amount AURA cannot convert without guessing. */
  clarification: string | null;
}

const CONTAINER = '(ly|cốc|coc|chai|lon|glass(?:es)?|cups?|bottles?|cans?)';
const MANY = new Set(['hai', 'ba', 'bốn', 'bon', 'two', 'three', 'four', 'several', 'vài', 'vai']);

/**
 * Millilitres, from "500 ml", "1.5 l", "1 lít". A glass or a cup is not an amount: "2 cốc
 * nước" is asked about rather than converted, and so is "2 ly 250ml", which could mean
 * 250 or 500.
 */
export function readWater(text: string): WaterReading {
  const t = normalise(text);
  const amounts = [
    ...[...t.matchAll(new RegExp(`${NUM}\\s*(?:ml|mls|mililit|millilit(?:er|re)s?)${END}`, 'gu'))].map((m) =>
      toNumber(m[1]!),
    ),
    ...[...t.matchAll(new RegExp(`${NUM}\\s*(?:l|lít|lit|liters?|litres?)${END}`, 'gu'))].map(
      (m) => toNumber(m[1]!) * 1000,
    ),
  ];
  // Anchored at a word start, so "really" is not a "ly".
  const containers = [...t.matchAll(new RegExp(`(?<![\\p{L}\\p{N}])(?:(\\d+)\\s*|([\\p{L}]+)\\s+)?${CONTAINER}${END}`, 'gu'))];
  const containerName = containers[0]?.[3] ?? null;
  const several = containers.some(
    (m) => (m[1] !== undefined && Number(m[1]) > 1) || (m[2] !== undefined && MANY.has(m[2])),
  );

  const unique = [...new Set(amounts.map((ml) => Math.round(ml)))];
  if (unique.length > 1) {
    return { amountMl: null, clarification: 'That names more than one amount — enter the total in ml.' };
  }
  if (unique.length === 1) {
    if (several) {
      return {
        amountMl: null,
        clarification: `Is ${unique[0]} ml the total, or for each ${containerName}? Enter the total in ml.`,
      };
    }
    return { amountMl: unique[0]!, clarification: null };
  }
  if (containerName) {
    return {
      amountMl: null,
      clarification: `AURA can't tell how much a ${containerName} holds — enter the amount in ml.`,
    };
  }
  return { amountMl: null, clarification: null };
}

/**
 * A clock time after a keyword. The hour must not be followed by a duration unit — in
 * "đi ngủ 8 tiếng" the 8 is how long, not when.
 */
const TIME =
  '(at|around|by|lúc|luc|khoảng|khoang|vào|vao)?\\s*(?:lúc|luc)?\\s*' +
  '(\\d{1,2})(?!\\d)(?![.,]\\d)(?!\\s*(?:tiếng|tieng|hours?|hrs?|phút|phut|minutes?|mins?)(?![\\p{L}]))' +
  '(?:[:h](\\d{2}))?\\s*(am|pm|a\\.m\\.|p\\.m\\.)?\\s*(?:giờ|gio)?\\s*(sáng|sang|trưa|trua|chiều|chieu|tối|toi|đêm|dem)?';

function toClock(hourRaw: string, minuteRaw: string | undefined, meridiem?: string, period?: string): string | null {
  let hour = Number(hourRaw);
  const minute = minuteRaw ? Number(minuteRaw) : 0;
  if (hour > 23 || minute > 59) return null;
  const pm = meridiem?.startsWith('p') || ['chiều', 'chieu', 'tối', 'toi'].includes(period ?? '');
  const am = meridiem?.startsWith('a') || ['sáng', 'sang'].includes(period ?? '');
  if (pm && hour < 12) hour += 12;
  if (am && hour === 12) hour = 0;
  // "1 giờ trưa" is 13:00; "11 giờ trưa" is 11:00.
  if ((period === 'trưa' || period === 'trua') && hour <= 5) hour += 12;
  // "11 giờ đêm" is 23:00, "12 giờ đêm" is midnight, "1 giờ đêm" is 01:00.
  if (period === 'đêm' || period === 'dem') {
    if (hour === 12) hour = 0;
    else if (hour >= 6) hour += 12;
  }
  return `${pad(hour)}:${pad(minute)}`;
}

/** The time after a keyword, and the phrase it was read from. */
function timeAfter(text: string, keywords: string): { time: string; phrase: string } | null {
  const match = new RegExp(`(?:${keywords})\\s*${TIME}`, 'u').exec(text);
  if (!match) return null;
  const [phrase, preposition, hour, minute, meridiem, period] = match;
  // A bare number after "đi ngủ" could be anything; without "at"/"lúc", minutes, am/pm or
  // a time of day it is not read as a time.
  if (!preposition && !minute && !meridiem && !period) return null;
  const time = toClock(hour!, minute, meridiem, period);
  return time ? { time, phrase } : null;
}

export interface SleepReading {
  durationMin: number | null;
  bedtime: string | null;
  wakeTime: string | null;
}

/** "I slept for 7 hours", "Tôi ngủ được 7 tiếng", "went to bed at 11 PM and woke up at 6 AM". */
export function readSleep(text: string): SleepReading {
  const t = normalise(text);
  const bed = timeAfter(t, 'went to bed|go to bed|to bed|in bed|fell asleep|slept at|đi ngủ|ngủ lúc|ngu luc|di ngu');
  const wake = timeAfter(t, 'woke up|woke|wake up|got up|thức dậy|thuc day|dậy|day luc');
  // The times are read first and taken out, so the "10 giờ" of "10 giờ tối" is not also
  // read as ten hours of sleep.
  let rest = t;
  for (const found of [bed, wake]) if (found) rest = rest.replace(found.phrase, ' ');
  return { durationMin: readDuration(rest), bedtime: bed?.time ?? null, wakeTime: wake?.time ?? null };
}

const WORKOUT_WORDS: ReadonlyArray<{ pattern: RegExp; type: WorkoutType; name: string }> = [
  { pattern: /strength training|weight training|weights|lifting|nâng tạ|tập tạ/u, type: 'gym', name: 'Strength training' },
  { pattern: /\bgym\b/u, type: 'gym', name: 'Gym' },
  { pattern: /\byoga\b/u, type: 'yoga', name: 'Yoga' },
  { pattern: /\b(?:ran|run|running|jog|jogging)\b|chạy bộ|chạy/u, type: 'run', name: 'Run' },
  { pattern: /\bcycl(?:e|ed|ing)\b|\bbik(?:e|ed|ing)\b|đạp xe/u, type: 'other', name: 'Cycling' },
  { pattern: /\bswim(?:ming)?\b|\bswam\b|bơi/u, type: 'other', name: 'Swimming' },
  { pattern: /stretch(?:ing|ed)?|giãn cơ/u, type: 'other', name: 'Stretching' },
  { pattern: /\b(?:football|soccer|tennis|badminton|basketball|volleyball|pickleball)\b|bóng đá|cầu lông|bóng rổ|bóng chuyền/u, type: 'sport', name: 'Sport' },
  { pattern: /home workout|at home|tại nhà|ở nhà/u, type: 'home', name: 'Home workout' },
];

const EFFORT_WORDS: ReadonlyArray<{ pattern: RegExp; effort: number }> = [
  { pattern: /\b(?:very hard|all out|exhausting)\b|rất mệt|kiệt sức/u, effort: 5 },
  { pattern: /\b(?:hard|intense|vigorous|tough|high intensity)\b|cường độ cao|tập nặng/u, effort: 4 },
  { pattern: /\b(?:moderate|medium)\b|vừa phải|trung bình/u, effort: 3 },
  { pattern: /\b(?:light|easy|gentle)\b|nhẹ nhàng|nhẹ/u, effort: 2 },
];

export interface WorkoutReading {
  workoutType: WorkoutType | null;
  name: string | null;
  durationMin: number | null;
  effort: number | null;
}

/** "I did strength training for 45 minutes", "Tôi tập gym 45 phút", "cycled for 30 minutes at moderate intensity". */
export function readWorkout(text: string): WorkoutReading {
  const t = normalise(text);
  const kind = WORKOUT_WORDS.find(({ pattern }) => pattern.test(t));
  return {
    workoutType: kind?.type ?? null,
    name: kind?.name ?? null,
    durationMin: readDuration(t),
    effort: EFFORT_WORDS.find(({ pattern }) => pattern.test(t))?.effort ?? null,
  };
}

/**
 * The fields the sentence fills in, as the form holds them. Only fields the text says
 * something about are present, so the caller can leave the rest — and anything the person
 * typed themselves — alone.
 */
export function readText<K extends ActivityKind>(kind: K, text: string): Partial<FormOf<K>> {
  const minutes = (value: number | null) => (value !== null && value > 0 ? String(value) : undefined);
  const reading: Record<string, unknown> = (() => {
    switch (kind) {
      case 'workout': {
        const r = readWorkout(text);
        return {
          workoutType: r.workoutType ?? undefined,
          name: r.name ?? undefined,
          durationMin: minutes(r.durationMin),
          effort: r.effort ?? undefined,
        };
      }
      case 'walk': {
        const km = readDistanceKm(text);
        return { durationMin: minutes(readDuration(text)), distanceKm: km !== null ? tidy(km, 3) : undefined };
      }
      case 'water': {
        const { amountMl } = readWater(text);
        return { amountMl: amountMl !== null ? String(amountMl) : undefined };
      }
      case 'sleep': {
        const r = readSleep(text);
        return {
          durationHours: r.durationMin !== null && r.durationMin > 0 ? tidy(r.durationMin / 60) : undefined,
          bedtime: r.bedtime ?? undefined,
          wakeTime: r.wakeTime ?? undefined,
        };
      }
      case 'other':
        return { durationMin: minutes(readDuration(text)) };
      default:
        return {};
    }
  })();
  return Object.fromEntries(Object.entries(reading).filter(([, value]) => value !== undefined)) as Partial<FormOf<K>>;
}

// ── Saving ─────────────────────────────────────────────────────────────────────

export type ActivityRequest =
  | { endpoint: 'events'; body: CreateEventInput }
  | { endpoint: 'workouts'; body: CreateWorkoutInput }
  | { endpoint: 'checkins'; body: CheckinInput };

export type BuildResult =
  | { ok: true; request: ActivityRequest }
  | { ok: false; errors: Partial<Record<string, string>> };

/** The server's limits (`daily-events.schema.ts`, `workouts.routes.ts`, `checkins.routes.ts`). */
export const LIMITS = {
  eventNote: 500,
  checkinNote: 1000,
  title: 80,
  eventMinutes: 1440,
  workoutMinutes: 600,
  waterMl: 5000,
  walkKm: 100,
  /**
   * One sleep entry, at most. Tighter than the server's 1440-minute event limit on purpose:
   * the wake-up time defaults to "now", so a bedtime read from a sentence about tonight
   * ("đi ngủ lúc 22:30", typed at 21:00) would otherwise come out as 22½ hours of sleep.
   */
  sleepHours: 16,
} as const;

function wholeMinutes(raw: string, max: number, what: string): { value?: number; error?: string } {
  const trimmed = raw.trim();
  if (trimmed === '') return {};
  const value = Number(trimmed.replace(',', '.'));
  if (!Number.isFinite(value) || !Number.isInteger(value)) return { error: `Enter ${what} in whole minutes.` };
  if (value < 1 || value > max) return { error: `Enter between 1 and ${max} minutes.` };
  return { value };
}

const minutesOf = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number) as [number, number];
  return h * 60 + m;
};

/** The instant `hhmm` last happened on or before `reference`, in the browser's local time. */
function lastOccurrence(hhmm: string, reference: Date): Date {
  const instant = new Date(reference);
  instant.setHours(Math.floor(minutesOf(hhmm) / 60), minutesOf(hhmm) % 60, 0, 0);
  if (instant.getTime() > reference.getTime()) instant.setDate(instant.getDate() - 1);
  return instant;
}

export interface SleepTiming {
  durationMin: number | null;
  /** When the sleep began — the event's `occurredAt`, which the day's summary reads as bedtime. */
  start: Date | null;
  error: string | null;
}

/**
 * A sleep's length and start, from whichever of the three fields were filled.
 *
 * Bedtime and wake-up time win over a typed duration, and a bedtime later on the clock
 * than the wake-up is the night before. Times are the browser's local time.
 */
export function sleepTiming(form: SleepForm, now: Date): SleepTiming {
  const bed = form.bedtime.trim();
  const wake = form.wakeTime.trim();
  let durationMin: number | null = null;

  const maxMinutes = LIMITS.sleepHours * 60;
  const outOfRange = `Enter between 0 and ${LIMITS.sleepHours} hours.`;

  if (bed && wake) {
    durationMin = (minutesOf(wake) - minutesOf(bed) + 1440) % 1440;
    if (durationMin === 0) return { durationMin: null, start: null, error: 'Bedtime and wake-up time are the same.' };
    // Reported, never clamped: a time is probably wrong, and only the person knows which.
    if (durationMin > maxMinutes) {
      return {
        durationMin: null,
        start: null,
        error: `That’s over ${LIMITS.sleepHours} hours of sleep — check your bedtime and wake-up time.`,
      };
    }
  } else if (form.durationHours.trim() !== '') {
    const hours = Number(form.durationHours.trim().replace(',', '.'));
    if (!Number.isFinite(hours) || hours <= 0 || hours > LIMITS.sleepHours) {
      return { durationMin: null, start: null, error: outOfRange };
    }
    durationMin = Math.round(hours * 60);
    if (durationMin < 1) return { durationMin: null, start: null, error: outOfRange };
  } else {
    return { durationMin: null, start: null, error: 'Add how long you slept, or when you went to bed.' };
  }

  if (wake) {
    const woke = lastOccurrence(wake, now);
    return { durationMin, start: new Date(woke.getTime() - durationMin * 60_000), error: null };
  }
  // A bedtime and a duration: the most recent night that has already ended.
  const start = lastOccurrence(bed, new Date(now.getTime() - durationMin * 60_000));
  return { durationMin, start, error: null };
}

const noteOf = (text: string) => (text.trim().length > 0 ? { note: text.trim() } : {});

function noteError(text: string, max: number): string | undefined {
  return text.trim().length > max ? `Keep it under ${max} characters.` : undefined;
}

/** A title from free text: its first line, cut at a word to fit. */
export function titleFromText(text: string): string {
  const line = text.trim().split(/\r?\n/)[0]!.trim();
  if (line.length <= LIMITS.title) return line;
  const cut = line.slice(0, LIMITS.title - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > 40 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/**
 * The request for a form, or why there is none yet. Messages are written to be shown
 * next to the field they name; `text` is the free description, saved as the note.
 */
export function buildRequest<K extends ActivityKind>(kind: K, form: FormOf<K>, text: string, now: Date): BuildResult {
  const errors: Partial<Record<string, string>> = {};
  const fail = () => ({ ok: false as const, errors });

  switch (kind) {
    case 'workout': {
      const f = form as WorkoutForm;
      if (!f.workoutType) errors['workoutType'] = 'Pick what kind of workout this was.';
      const duration = wholeMinutes(f.durationMin, LIMITS.workoutMinutes, 'the duration');
      if (f.durationMin.trim() === '') errors['durationMin'] = 'Add how long it took, in minutes.';
      else if (duration.error) errors['durationMin'] = duration.error;
      if (f.name.trim().length > LIMITS.title) errors['name'] = `Keep it under ${LIMITS.title} characters.`;
      const note = noteError(text, LIMITS.eventNote);
      if (note) errors['text'] = note;
      if (Object.keys(errors).length > 0 || !f.workoutType) return fail();
      return {
        ok: true,
        request: {
          endpoint: 'workouts',
          body: {
            workoutType: f.workoutType,
            ...(f.name.trim() ? { title: f.name.trim() } : {}),
            durationMin: duration.value!,
            ...(f.effort !== null ? { perceivedEffort: f.effort } : {}),
            ...noteOf(text),
          },
        },
      };
    }

    case 'walk': {
      const f = form as WalkForm;
      const duration = wholeMinutes(f.durationMin, LIMITS.eventMinutes, 'the duration');
      if (f.durationMin.trim() === '') errors['durationMin'] = 'Add how long you walked, in minutes.';
      else if (duration.error) errors['durationMin'] = duration.error;
      let km: number | undefined;
      if (f.distanceKm.trim() !== '') {
        km = Number(f.distanceKm.trim().replace(',', '.'));
        if (!Number.isFinite(km) || km <= 0 || km > LIMITS.walkKm) {
          errors['distanceKm'] = `Enter a distance between 0 and ${LIMITS.walkKm} km, or leave it empty.`;
        }
      }
      const note = noteError(text, LIMITS.eventNote);
      if (note) errors['text'] = note;
      if (Object.keys(errors).length > 0) return fail();
      return {
        ok: true,
        request: {
          endpoint: 'events',
          body: {
            type: 'walk',
            title: 'Walk',
            durationMin: duration.value!,
            ...(km !== undefined ? { metrics: { km: Number(km.toFixed(3)) } } : {}),
            ...noteOf(text),
          },
        },
      };
    }

    case 'water': {
      const f = form as WaterForm;
      const raw = f.amountMl.trim();
      const ml = Number(raw);
      if (raw === '') errors['amountMl'] = 'Enter how much you drank, in ml.';
      else if (!Number.isInteger(ml) || ml < 1 || ml > LIMITS.waterMl) {
        errors['amountMl'] = `Enter a whole number of ml, between 1 and ${LIMITS.waterMl}.`;
      }
      const note = noteError(text, LIMITS.eventNote);
      if (note) errors['text'] = note;
      if (Object.keys(errors).length > 0) return fail();
      // `metrics.ml` is the key the day's summary adds up (`daily-events.repository.ts`).
      return { ok: true, request: { endpoint: 'events', body: { type: 'water', title: 'Water', metrics: { ml }, ...noteOf(text) } } };
    }

    case 'sleep': {
      const timing = sleepTiming(form as SleepForm, now);
      if (timing.error) errors['duration'] = timing.error;
      const note = noteError(text, LIMITS.eventNote);
      if (note) errors['text'] = note;
      if (Object.keys(errors).length > 0 || timing.durationMin === null || !timing.start) return fail();
      return {
        ok: true,
        request: {
          endpoint: 'events',
          body: {
            type: 'sleep',
            title: 'Sleep',
            occurredAt: timing.start.toISOString(),
            durationMin: timing.durationMin,
            ...noteOf(text),
          },
        },
      };
    }

    case 'check-in': {
      const f = form as CheckinActivityForm;
      if (!f.mood) errors['mood'] = 'Pick how you are feeling.';
      const note = noteError(text, LIMITS.checkinNote);
      if (note) errors['text'] = note;
      if (Object.keys(errors).length > 0 || !f.mood) return fail();
      // The whole form, every time: the server upserts today's check-in and clears
      // whatever a save leaves out (`checkin.ts`).
      return {
        ok: true,
        request: {
          endpoint: 'checkins',
          body: {
            mood: f.mood,
            ...(f.dayTag ? { dayTag: f.dayTag } : {}),
            ...(f.energy !== null ? { energy1to5: f.energy } : {}),
            ...(text.trim() ? { note: text.trim() } : {}),
          },
        },
      };
    }

    case 'other': {
      const f = form as OtherForm;
      const title = f.title.trim() || titleFromText(text);
      if (!title) errors['title'] = 'Give it a name, or describe what happened.';
      else if (title.length > LIMITS.title) errors['title'] = `Keep it under ${LIMITS.title} characters.`;
      const duration = wholeMinutes(f.durationMin, LIMITS.eventMinutes, 'the duration');
      if (duration.error) errors['durationMin'] = duration.error;
      const note = noteError(text, LIMITS.eventNote);
      if (note) errors['text'] = note;
      if (Object.keys(errors).length > 0) return fail();
      // The note is kept whenever it says more than the title — a sentence is never
      // dropped because it could not be classified.
      const keepNote = text.trim() !== '' && text.trim() !== title;
      return {
        ok: true,
        request: {
          endpoint: 'events',
          body: {
            type: 'custom',
            title,
            ...(duration.value !== undefined ? { durationMin: duration.value } : {}),
            ...(keepNote ? { note: text.trim() } : {}),
          },
        },
      };
    }

    default:
      return fail();
  }
}
