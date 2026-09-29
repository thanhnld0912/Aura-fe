import type { WeeklyReport, WeeklyStory, WeeklyStoryResult } from '../lib/api';

/**
 * Weekly report fixtures for tests, typed against the generated contract — so a field the
 * backend renames breaks these at compile time rather than letting a test pass on a
 * shape the server no longer sends.
 */

const day = (localDate: string, elapsed: boolean, tracked: boolean | null) => ({
  localDate,
  elapsed,
  tracked,
  eventsLogged: tracked ? 2 : elapsed ? 0 : null,
  mealsLogged: tracked ? 1 : null,
  mood: null,
});

/** A week with enough logged to describe: Monday 21 September 2026, four days in. */
export function sufficientWeek(): WeeklyReport {
  return {
    period: {
      weekStart: '2026-09-21',
      weekEnd: '2026-09-27',
      timezone: 'Asia/Ho_Chi_Minh',
      daysInPeriod: 7,
      daysElapsed: 4,
      isComplete: false,
    },
    coverage: { daysTracked: 3, daysElapsed: 4, rate: 0.75, status: 'sufficient' },
    days: [
      day('2026-09-21', true, true),
      day('2026-09-22', true, false),
      day('2026-09-23', true, true),
      day('2026-09-24', true, true),
      day('2026-09-25', false, null),
      day('2026-09-26', false, null),
      day('2026-09-27', false, null),
    ],
    nutrition: {
      status: 'ok',
      daysWithConfirmedMeals: 3,
      coverage: 0.75,
      confirmedMeals: 5,
      averageMealsPerLoggedDay: 1.7,
      distinctFoods: 4,
      itemsNeedingReview: 0,
    },
    activity: { status: 'ok', activeDays: 2, walks: 1, workoutSessions: { completed: 1, partial: 0, skipped: 0 } },
    plan: {
      status: 'ok',
      daysWithPlan: 2,
      plannedItems: 4,
      resolvedItems: 3,
      happenedItems: 2,
      pendingItems: 1,
      adherenceRate: 0.67,
      byAdherence: { pending: 1, on_time: 1, shifted: 1, substituted: 0, not_logged: 1 },
      activity: null,
    },
    habits: { status: 'no_data', daysWithLogs: 0, trackedHabits: null, logs: null, completionRate: null },
    checkins: {
      status: 'ok',
      daysWithCheckin: 2,
      moodCounts: { low: 0, okay: 1, good: 1, great: 0 },
      dayTagCounts: null,
      averageEnergy: null,
      energySamples: null,
    },
    sleep: { status: 'no_data', daysWithSleep: 0, averageSleepMinutes: null },
    comparison: {
      previousWeekStart: '2026-09-14',
      status: 'available',
      metrics: [
        { metric: 'logging_coverage', status: 'available', current: 0.75, previous: 0.57, delta: 0.18, direction: 'up' },
        { metric: 'plan_adherence', status: 'insufficient_data', current: 0.67, previous: null, delta: null, direction: null },
      ],
    },
    patterns: { status: 'unavailable', items: [] },
    dataQuality: { limitations: ['week_in_progress', 'no_sleep_logs', 'pattern_engine_unavailable'] },
  };
}

/** A week with one tracked day: the backend's `insufficient_data`, every behaviour figure null. */
export function insufficientWeek(): WeeklyReport {
  const week = sufficientWeek();
  return {
    ...week,
    period: { ...week.period, weekStart: '2026-09-28', weekEnd: '2026-10-04', daysElapsed: 2 },
    coverage: { daysTracked: 1, daysElapsed: 2, rate: 0.5, status: 'insufficient_data' },
    days: [
      day('2026-09-28', true, true),
      day('2026-09-29', true, false),
      ...['2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04'].map((d) => day(d, false, null)),
    ],
    nutrition: {
      status: 'no_data',
      daysWithConfirmedMeals: 0,
      coverage: 0,
      confirmedMeals: null,
      averageMealsPerLoggedDay: null,
      distinctFoods: null,
      itemsNeedingReview: null,
    },
    activity: { status: 'no_data', activeDays: 0, walks: null, workoutSessions: null },
    plan: {
      status: 'no_data',
      daysWithPlan: 0,
      plannedItems: null,
      resolvedItems: null,
      happenedItems: null,
      pendingItems: null,
      adherenceRate: null,
      byAdherence: null,
      activity: null,
    },
    comparison: { previousWeekStart: '2026-09-21', status: 'insufficient_data', metrics: [] },
    dataQuality: { limitations: ['week_in_progress', 'insufficient_logging_coverage', 'no_meal_logs'] },
  };
}

export function readyStory(): WeeklyStory {
  return {
    promptVersion: 'weekly-story-v1',
    headline: 'A steadier week of logging',
    summary: { text: 'You logged something on 3 of 4 days so far.', evidence: ['F1'] },
    highlights: [{ text: '5 meals were confirmed across 3 days.', evidence: ['F2'], type: 'fact' }],
    patterns: [],
    interpretations: [{ text: 'Days with a check-in were also days with a meal logged.', evidence: ['C1'] }],
    suggestions: [{ text: 'A short check-in on busy days keeps the picture complete.', evidence: ['L1'] }],
    caveats: [{ text: 'This is one week, and it is still in progress.', evidence: ['L1'] }],
  };
}

export function storyResult(status: WeeklyStoryResult['status'], report = sufficientWeek()): WeeklyStoryResult {
  return { status, report, story: status === 'ready' ? readyStory() : null };
}
