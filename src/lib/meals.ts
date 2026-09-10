import type { ConfidenceBand, Meal, MealItem, MealType, Nutrients } from './api';
import type { TimelineEvent, TimelineSection } from '../types';

/**
 * Backend meals → the shape `TodayView` already renders.
 *
 * Pure: no React, no fetch, no clock. Everything it emits is derived from the payload
 * it was handed, which is what makes the rule below enforceable by reading one file.
 *
 * ## The rule
 *
 * Nothing here may invent a number, a time, or a fact. The backend is authoritative
 * for nutrition (NUTRITION_ARCHITECTURE.md), and the honest response to a missing
 * value is to omit the element, never to substitute a zero or a plausible-looking
 * placeholder. A fabricated figure in a health record is worse than a blank one,
 * because a blank invites a question and a fabrication does not.
 *
 * ## Why there are no times
 *
 * `GET /api/meals/today` returns `createdAt` — when the *row* was written — and no
 * occurrence time at all; `occurredAt` is accepted on create and never serialised.
 * Printing `createdAt` under a "time" heading would be wrong for any back-dated meal,
 * so meals are grouped by `mealType` instead and `time` is left empty. `TodayView`
 * renders the time column only when there is something true to put in it.
 */

/** Presentation only — the backend has no notion of a section. */
const MEAL_GROUPS: ReadonlyArray<{ type: MealType; label: string; icon: string }> = [
  { type: 'breakfast', label: 'Breakfast', icon: '🌅' },
  { type: 'lunch', label: 'Lunch', icon: '🍱' },
  { type: 'dinner', label: 'Dinner', icon: '🌙' },
  { type: 'snack', label: 'Snack', icon: '🍎' },
  { type: 'drink', label: 'Drink', icon: '🥤' },
];

/**
 * How sure the server is, in the badge vocabulary the timeline already uses.
 *
 * `unresolved` is the only one that warns: it means no food matched, so the meal is
 * recorded but carries no nutrition at all. That is worth drawing the eye to, because
 * only the user can resolve it.
 */
const BAND_APPEARANCE: Record<
  ConfidenceBand,
  { badge: string; type: NonNullable<TimelineEvent['statusType']> }
> = {
  confident: { badge: 'Confident', type: 'success' },
  estimate: { badge: 'Estimate', type: 'neutral' },
  uncertain: { badge: 'Uncertain', type: 'neutral' },
  unresolved: { badge: 'Needs a look', type: 'warning' },
};

/**
 * The number, exactly as the server sent it.
 *
 * No rounding. An earlier draft rounded to one decimal and turned the backend's
 * `4.05 g` into `4.1 g` — small, but it is the frontend quietly restating an
 * authoritative figure as something else, which is the thing the nutrition rule
 * exists to prevent. Values arrive from `numeric(8,2)`, so this is at most two
 * decimals and `String` already drops the trailing zeros.
 */
function trim(value: number): string {
  return String(value);
}

/** The name the user is most likely to recognise, falling back to what was typed. */
export function itemLabel(item: MealItem): string {
  return item.displayNameVi ?? item.displayNameEn ?? item.detectedName;
}

function toTag(item: MealItem): string {
  return `${itemLabel(item)} · ${trim(item.quantity)} ${item.unit}`;
}

/**
 * The macro pill.
 *
 * `kcal` is included **only when the key is present**. Its absence means the user
 * turned calorie display off and the server never sent the number; a `?? 0` here
 * would put a fabricated zero in front of someone who asked not to see calories at
 * all. A present-but-null `kcal` means calories are shown but nothing resolved, which
 * is also not a zero — it is simply omitted from the pill.
 */
function toNutritionPill(totals: Nutrients): TimelineEvent['extraPill'] {
  const parts: string[] = [];

  if (totals.kcal !== undefined && totals.kcal !== null) parts.push(`${trim(totals.kcal)} kcal`);
  if (totals.proteinG !== null) parts.push(`P ${trim(totals.proteinG)}g`);
  if (totals.carbsG !== null) parts.push(`C ${trim(totals.carbsG)}g`);
  if (totals.fatG !== null) parts.push(`F ${trim(totals.fatG)}g`);
  if (totals.fiberG !== null) parts.push(`Fibre ${trim(totals.fiberG)}g`);

  // Nothing resolved. No pill rather than an empty one.
  if (parts.length === 0) return undefined;
  return { icon: 'nutrition', text: parts.join(' · ') };
}

/**
 * The note under a meal, built only from what the server said.
 *
 * `unresolved` names the things it could not price, and leads — that is the part the
 * user can act on. `notice` is the standing estimate caveat, which the API sends on
 * every meal and which the product has decided should always be visible.
 */
function toNote(meal: Meal): TimelineEvent['note'] {
  const lines: string[] = [];

  if (meal.unresolved.length > 0) {
    lines.push(
      `No nutrition found for: ${meal.unresolved.join(', ')}. Adjust the meal to add it.`,
    );
  }
  if (meal.notice) lines.push(meal.notice);

  if (lines.length === 0) return undefined;
  return { title: 'AURA Note', content: lines.join('\n') };
}

/**
 * A meal with no `rawInput` was not created from a sentence — it was built from
 * structured items, so there is no text to show. Saying so is truthful; inventing a
 * sentence on the user's behalf is not.
 */
function toDescription(meal: Meal): string {
  if (meal.rawInput !== null && meal.rawInput.trim() !== '') return meal.rawInput;
  return 'Logged as individual items.';
}

export function toTimelineEvent(meal: Meal): TimelineEvent {
  const appearance = BAND_APPEARANCE[meal.confidenceBand];
  const group = MEAL_GROUPS.find((candidate) => candidate.type === meal.mealType);
  const pill = toNutritionPill(meal.totals);
  const note = toNote(meal);

  return {
    id: meal.id,
    // Deliberately empty: the payload carries no occurrence time. See the file note.
    time: '',
    title: group?.label ?? meal.mealType,
    statusBadge: appearance.badge,
    statusType: appearance.type,
    description: toDescription(meal),
    tags: meal.items.map(toTag),
    ...(pill ? { extraPill: pill } : {}),
    ...(note ? { note } : {}),
  };
}

/**
 * Groups the day's meals under a heading per meal type, in the order a day runs.
 *
 * Only groups that actually contain a meal are emitted — an empty "Dinner" heading at
 * lunchtime reads as a missed meal rather than as a day still in progress. Meals keep
 * the order the API returned them in, which is `createdAt` ascending.
 */
export function toTimelineSections(meals: Meal[]): TimelineSection[] {
  const sections: TimelineSection[] = [];

  for (const group of MEAL_GROUPS) {
    const inGroup = meals.filter((meal) => meal.mealType === group.type);
    if (inGroup.length === 0) continue;

    sections.push({
      id: group.type,
      period: group.label,
      // No backend equivalent, and not derivable from anything the payload contains.
      timeRange: '',
      icon: group.icon,
      events: inGroup.map(toTimelineEvent),
    });
  }

  return sections;
}
