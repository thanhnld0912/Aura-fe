import type { WeeklyComparisonMetric, WeeklyLimitation, WeeklyReport } from './api';

/**
 * A weekly report → what `InsightsView` renders.
 *
 * Presentation only, like `today.ts`. Every figure here was computed by the backend
 * (`insights/weekly-report.ts`): this file formats numbers, picks labels and says "no
 * data" where the backend sent `null`. It never derives a rate, a trend, a comparison or
 * a pattern of its own, and it never turns a `null` into a 0 — "nothing logged" and "zero"
 * are different statements, and the backend already keeps them apart.
 */

/** "Sep 28 – Oct 4". The dates are already calendar days, so they are formatted in UTC. */
export function formatWeekRange(period: Pick<WeeklyReport['period'], 'weekStart' | 'weekEnd'>): string {
  const format = (localDate: string) =>
    new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(
      new Date(`${localDate}T12:00:00Z`),
    );
  return `${format(period.weekStart)} – ${format(period.weekEnd)}`;
}

/** "Day 2 of 7" while the week runs, "Complete week" once its Sunday is over. */
export function weekProgress(period: WeeklyReport['period']): string {
  return period.isComplete ? 'Complete week' : `Day ${period.daysElapsed} of ${period.daysInPeriod}`;
}

/** A 0–1 share as "78%", or `null` when the backend had nothing to divide by. */
export function formatRate(rate: number | null): string | null {
  return rate === null ? null : `${Math.round(rate * 100)}%`;
}

/** "7h 05m", or `null` when no sleep was logged. */
export function formatSleep(minutes: number | null): string | null {
  if (minutes === null) return null;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return hours === 0 ? `${rest}m` : `${hours}h ${String(rest).padStart(2, '0')}m`;
}

/** A `Retry-After` in words — "40 min", "3 h" — or `null` when the server sent none. */
export function formatWait(seconds: number | undefined): string | null {
  if (seconds === undefined || seconds <= 0) return null;
  if (seconds < 3600) return `${Math.max(1, Math.ceil(seconds / 60))} min`;
  return `${Math.ceil(seconds / 3600)} h`;
}

export interface StatCard {
  label: string;
  icon: string;
  /** The headline figure, or `null` — shown as "No data", never as 0. */
  value: string | null;
  detail: string;
}

const days = (n: number) => `${n} ${n === 1 ? 'day' : 'days'}`;

/**
 * The four headline figures. Each section reports `no_data` when nothing of its kind was
 * logged; that is said in words rather than drawn as a zero.
 */
export function statCards(report: WeeklyReport): StatCard[] {
  const { activity, nutrition, sleep, plan, period } = report;
  const sessions = activity.workoutSessions;

  return [
    {
      label: 'Movement',
      icon: '🏋️',
      value: activity.status === 'no_data' ? null : `${days(activity.activeDays)} active`,
      detail:
        activity.status === 'no_data'
          ? 'No walks or workouts logged'
          : [
              activity.walks !== null ? `${activity.walks} ${activity.walks === 1 ? 'walk' : 'walks'}` : null,
              sessions ? `${sessions.completed} ${sessions.completed === 1 ? 'workout' : 'workouts'} done` : null,
            ]
              .filter(Boolean)
              .join(' · '),
    },
    {
      label: 'Meals Logged',
      icon: '🍱',
      value: nutrition.confirmedMeals === null ? null : `${nutrition.confirmedMeals} logged`,
      detail:
        nutrition.status === 'no_data'
          ? 'No confirmed meals logged'
          : `On ${nutrition.daysWithConfirmedMeals} of ${days(period.daysElapsed)}`,
    },
    {
      label: 'Sleep Rest',
      icon: '😴',
      value: sleep.averageSleepMinutes === null ? null : `${formatSleep(sleep.averageSleepMinutes)} avg`,
      detail: sleep.status === 'no_data' ? 'No sleep logged' : `From ${days(sleep.daysWithSleep)} logged`,
    },
    {
      label: 'Plan Adherence',
      icon: '✨',
      value: formatRate(plan.adherenceRate),
      detail:
        plan.status === 'no_data'
          ? 'No plan this week'
          : plan.happenedItems !== null && plan.resolvedItems !== null
            ? `${plan.happenedItems} of ${plan.resolvedItems} planned items happened`
            : 'Nothing resolved yet',
    },
  ];
}

const METRIC_LABEL: Record<WeeklyComparisonMetric['metric'], string> = {
  logging_coverage: 'Days with any log',
  meal_logging_coverage: 'Days with a meal logged',
  plan_adherence: 'Plan adherence',
  habit_completion: 'Habit completion',
};

/**
 * One week-on-week line per metric the backend could compare. The delta and its
 * direction are the server's; only the wording is chosen here. Metrics the backend
 * marked `insufficient_data` or `unavailable` are left out rather than shown as "no change".
 */
export function comparisonLines(comparison: WeeklyReport['comparison']): string[] {
  return comparison.metrics
    .filter((metric) => metric.status === 'available' && metric.delta !== null)
    .map((metric) => {
      const points = Math.abs(Math.round(metric.delta! * 100));
      const change =
        metric.direction === 'flat'
          ? 'about the same as last week'
          : `${metric.direction === 'up' ? 'up' : 'down'} ${points} ${points === 1 ? 'point' : 'points'} from last week`;
      return `${METRIC_LABEL[metric.metric]}: ${formatRate(metric.current)}, ${change}`;
    });
}

/** The backend's own reasons its picture of the week is partial, in words. */
export const LIMITATION_LABEL: Record<WeeklyLimitation, string> = {
  week_in_progress: 'The week is still in progress.',
  insufficient_logging_coverage: 'Too few days have logs to describe the week yet.',
  no_meal_logs: 'No confirmed meals were logged.',
  meal_items_unresolved: 'Some meal items still need review.',
  no_activity_logs: 'No walks or workouts were logged.',
  no_plans: 'There was no plan this week.',
  no_habit_logs: 'No habits were logged.',
  no_checkins: 'No check-ins were saved.',
  no_sleep_logs: 'No sleep was logged.',
  pattern_engine_unavailable: 'Pattern detection is not available yet.',
  previous_week_unavailable: 'Last week has no logs to compare with.',
  previous_week_insufficient: 'Last week has too few logs to compare with.',
};

export interface DayCell {
  localDate: string;
  /** "Mon". */
  weekday: string;
  state: 'logged' | 'not_logged' | 'upcoming';
}

/** The seven days as the backend reported them: logged, not logged, or not yet reached. */
export function dayCells(report: WeeklyReport): DayCell[] {
  return report.days.map((day) => ({
    localDate: day.localDate,
    weekday: new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: 'UTC' }).format(
      new Date(`${day.localDate}T12:00:00Z`),
    ),
    state: !day.elapsed || day.tracked === null ? 'upcoming' : day.tracked ? 'logged' : 'not_logged',
  }));
}
