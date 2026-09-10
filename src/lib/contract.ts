import type { components, paths } from '../generated/api';

/**
 * The backend contract, named.
 *
 * Every type here is a *projection* of `src/generated/api.ts`, which is generated from
 * the OpenAPI document AURA-BE emits from the same Zod schemas it validates with
 * (`ARCHITECTURE.md` §10, Option B). Nothing in this file describes the API; it only
 * gives the generated shapes the names the rest of the app already uses.
 *
 * That is the whole point. Before this, `api.ts` declared these interfaces by hand,
 * transcribed from reading backend source — `ARCHITECTURE.md` §10 calls that Option D
 * and names its failure mode exactly: the copy drifts, the frontend still compiles,
 * and the mismatch only appears at runtime. Now a contract change lands here as a
 * compile error.
 *
 * ## Why projections rather than `components.schemas`
 *
 * The backend's OpenAPI transform sets `$refStrategy: 'none'`, so every schema is
 * inlined per operation and the document has no `components.schemas` to import from.
 * Indexing into `paths` is therefore the only way to reach them — verbose at this
 * boundary, but it keeps the alternative (hand-copying the shapes again) off the table.
 *
 * ## What is *not* here
 *
 * The error envelope. No operation documents a 4xx response, so `ApiError`,
 * `ErrorDetail` and friends stay hand-written in `api.ts`. See the report's
 * OPENAPI GAPS.
 */

type Json<T> = T extends { content: { 'application/json': infer B } } ? B : never;

type Response<
  P extends keyof paths,
  M extends keyof paths[P],
  C extends number,
> = paths[P][M] extends { responses: infer R }
  ? C extends keyof R
    ? Json<R[C]>
    : never
  : never;

type Body<P extends keyof paths, M extends keyof paths[P]> = paths[P][M] extends {
  requestBody: infer B;
}
  ? Json<NonNullable<B>>
  : never;

// ── Errors ─────────────────────────────────────────────────────────────────────

/**
 * The error envelope, as the backend sends it (`API_DESIGN.md` §1).
 *
 * The one named component in the document — every 4xx and 5xx response points at it,
 * so inlining it per operation would have said the same thing a hundred times.
 *
 * This is the *shape on the wire*, with `error`, `code`, `message` and `requestId`
 * all present. Parsing an untrusted response is a different problem, and `api.ts`
 * keeps its own looser view for that.
 */
export type ErrorEnvelope = components['schemas']['ErrorEnvelope'];

/** One field-level problem. `path` is dot-notation into the request body. */
export type ErrorDetail = NonNullable<ErrorEnvelope['error']['details']>[number];

/** The machine-readable codes the API can return. */
export type ErrorCode = ErrorEnvelope['error']['code'];

// ── Meals ──────────────────────────────────────────────────────────────────────

export type Meal = Response<'/api/meals/today', 'get', 200>['data'][number];
export type MealItem = Meal['items'][number];
export type MealType = Meal['mealType'];
export type MealStatus = Meal['status'];
export type ConfidenceBand = MealItem['confidenceBand'];

/**
 * Macros, and energy *sometimes*.
 *
 * The three states are distinct in the generated type because they are distinct on the
 * wire: `kcal` is both optional and nullable, so it is `kcal?: number | null`.
 *
 *   kcal absent   the user has `showCalories: false`; the number never crossed the wire
 *   kcal null     calories are shown, but nothing resolved for this item
 *   kcal number   a real figure
 *
 * `kcal ?? 0` collapses the first two into a fabricated zero. Check for `undefined`
 * and let null stay null.
 */
export type Nutrients = MealItem['nutrition'];

export type CreateMealInput = Body<'/api/meals', 'post'>;
export type UpdateMealInput = Body<'/api/meals/{id}', 'patch'>;
export type ParsedMealResult = Response<'/api/meals/parse', 'post', 200>;

// ── Nutrition ──────────────────────────────────────────────────────────────────

export type Food = Response<'/api/nutrition/search', 'get', 200>['data'][number];
export type FoodPortion = Food['portions'][number];

export type CalculationResult = Response<'/api/nutrition/calculate', 'post', 200>;
export type CalculatedItem = CalculationResult['items'][number];

/**
 * One line of a meal, as the backend accepts it.
 *
 * Note what cannot be sent: no grams, no portion id, no nutrition of any kind. The
 * caller says *what* and *how much*; the server resolves the food, converts the
 * portion and does every calculation. The write schemas are `.strict()`, so an extra
 * key is a 400 rather than a silently ignored field.
 */
export type MealItemInput = Body<'/api/nutrition/calculate', 'post'>['items'][number];

export type MealUnit = MealItemInput['unit'];
export type SizeLabel = NonNullable<MealItemInput['sizeLabel']>;

// ── Auth ───────────────────────────────────────────────────────────────────────

export type SessionResponse = Response<'/api/auth/session', 'post', 200>;

/**
 * Taken from `GET /api/users/me`, not from the session response.
 *
 * The two are almost the same object, and that "almost" is the point: the session
 * reply carries an extra `isNewUser` that only makes sense at bootstrap. Deriving
 * `AuraUser` from the session would smuggle that flag into every place a user is
 * shown, which is precisely the kind of quiet shape mismatch this file exists to stop.
 */
export type AuraUser = Response<'/api/users/me', 'get', 200>['user'];

// ── Runtime enum values ────────────────────────────────────────────────────────

/**
 * The enum members, as values.
 *
 * A generated type cannot supply these — the UI needs real arrays to render a picker
 * — so they are declared here and then *checked* against the generated unions below.
 * Adding a unit to the backend enum now breaks the typecheck instead of quietly
 * leaving a control the user cannot reach.
 */
export const MEAL_UNITS = ['g', 'ml', 'bowl', 'piece', 'plate', 'serving'] as const;
export const SIZE_LABELS = ['small', 'medium', 'large', 'custom'] as const;

/** Fails to compile unless `A` and `B` are the same union, in both directions. */
type Exact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;

// Referenced by the assertions below; `void` keeps them from being unused exports.
type UnitsMatch = Exact<(typeof MEAL_UNITS)[number], MealUnit>;
type SizesMatch = Exact<(typeof SIZE_LABELS)[number], SizeLabel>;

/** Compile-time only: a drifted enum makes one of these `never` and the build fails. */
export const CONTRACT_ENUMS_MATCH: [UnitsMatch, SizesMatch] = [true, true];
