import { MEAL_UNITS } from '../../lib/api';
import type {
  CalculationResult,
  ConfidenceBand,
  Food,
  Meal,
  MealItemInput,
  MealUnit,
  Nutrients,
  SizeLabel,
} from '../../lib/api';

/**
 * View types local to the composer.
 *
 * Deliberately separate from the API DTOs. The DTOs are the contract and are rendered
 * verbatim; these describe what the user is part-way through assembling, which the
 * backend has no opinion about until it is submitted.
 */

export type LogMode = 'photo' | 'describe' | 'quick';

/**
 * A line the user is building in Quick Add.
 *
 * `label` and `perPortionGrams` exist only to draw the row. Neither is ever sent:
 * the request carries `foodId`, `quantity`, `unit` and at most `sizeLabel`, and the
 * server derives grams itself. Keeping the display values out of the payload is what
 * makes it impossible for the UI to assert a portion the backend did not resolve.
 */
export interface DraftItem {
  /** Stable across re-renders and independent of the food, so rows can repeat. */
  key: string;
  /** Set when a food was chosen or resolved. Absent for a phrase nothing matched. */
  foodId?: string;
  /** The phrase to resolve, used only when there is no `foodId`. */
  name?: string;
  label: string;
  quantity: number;
  unit: MealUnit;
  sizeLabel?: SizeLabel;
  /** The food's own portion rows, for showing what "1 bowl" means. Never submitted. */
  portions: Food['portions'];
}

/** The payload shape, derived from the draft. The only thing that reaches the API. */
export function toMealItemInput(item: DraftItem): MealItemInput {
  return {
    ...(item.foodId ? { foodId: item.foodId } : {}),
    ...(!item.foodId && item.name ? { name: item.name } : {}),
    quantity: item.quantity,
    unit: item.unit,
    ...(item.sizeLabel ? { sizeLabel: item.sizeLabel } : {}),
  };
}

/**
 * The backend stores one of its own units; anything else means the DTO drifted.
 *
 * Checked against `MEAL_UNITS`, which the contract layer asserts is exactly the
 * generated union — so a unit added on the backend is a compile error here rather
 * than a value this function quietly turns into "serving".
 */
export function asMealUnit(unit: string): MealUnit {
  return (MEAL_UNITS as readonly string[]).includes(unit) ? (unit as MealUnit) : 'serving';
}

/**
 * Turns a parsed draft meal into editable rows.
 *
 * Describe mode needs these so an amount the parser misread can be corrected before
 * the meal is confirmed. The rows carry no nutrition — correcting them sends the
 * item list back to `PATCH /api/meals/:id`, which re-resolves everything.
 */
export function draftsFromMeal(meal: Meal): DraftItem[] {
  return meal.items.map((item) => ({
    key: item.id,
    ...(item.foodId ? { foodId: item.foodId } : { name: item.detectedName }),
    label: item.displayNameVi || item.displayNameEn || item.detectedName || 'Unnamed item',
    quantity: item.quantity,
    unit: asMealUnit(item.unit),
    portions: [],
  }));
}

/**
 * One reviewable line, from either flow.
 *
 * Quick Add reviews a `/nutrition/calculate` response; Describe reviews a parsed
 * draft meal. The two payloads are close but not identical, so both are narrowed to
 * this before rendering — the review component then has one shape to draw and no
 * branch on where the numbers came from.
 */
export interface ReviewItem {
  key: string;
  name: string;
  quantity: number | null;
  unit: string | null;
  gramsResolved: number | null;
  nutrition: Nutrients;
  source: string;
  confidence: number;
  confidenceBand: ConfidenceBand;
  /** Present only for a calculation — the server's account of how it got there. */
  trace?: string;
}

export interface ReviewModel {
  items: ReviewItem[];
  totals: Nutrients;
  unresolved: string[];
  notice: string;
  /** Describe only: fragments the parser could not read. */
  ambiguous: string[];
}

const nameOf = (
  vi: string | null | undefined,
  en: string | null | undefined,
  detected: string,
): string => vi || en || detected || 'Unnamed item';

/** Quick Add: a calculation preview, paired with the amounts the user chose. */
export function reviewFromCalculation(
  result: CalculationResult,
  drafts: DraftItem[],
): ReviewModel {
  return {
    items: result.items.map((item, index) => {
      const draft = drafts[index];
      return {
        key: draft?.key ?? `calc-${index}`,
        name: nameOf(item.displayNameVi, draft?.label, item.detectedName),
        quantity: draft?.quantity ?? null,
        unit: draft?.unit ?? null,
        gramsResolved: item.gramsResolved,
        nutrition: item.nutrition,
        source: item.source,
        confidence: item.confidence,
        confidenceBand: item.confidenceBand,
        trace: item.trace,
      };
    }),
    totals: result.totals,
    unresolved: result.unresolved,
    notice: result.notice,
    ambiguous: [],
  };
}

/** Describe: a parsed draft meal, exactly as the server stored it. */
export function reviewFromMeal(meal: Meal, ambiguous: string[] = []): ReviewModel {
  return {
    items: meal.items.map((item) => ({
      key: item.id,
      name: nameOf(item.displayNameVi, item.displayNameEn, item.detectedName),
      quantity: item.quantity,
      unit: item.unit,
      gramsResolved: item.gramsResolved,
      nutrition: item.nutrition,
      source: item.source,
      confidence: item.confidence,
      confidenceBand: item.confidenceBand,
    })),
    totals: meal.totals,
    unresolved: meal.unresolved,
    notice: meal.notice,
    ambiguous,
  };
}
