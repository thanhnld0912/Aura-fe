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

/**
 * `POST /api/meals/analyze-image`: a photo in, the same reviewable draft out.
 *
 * Projected from its own path rather than aliased to `ParsedMealResult`, even though
 * the two 200 schemas are byte-identical today. They are separate operations on the
 * backend and may diverge; deriving each from its own path means a divergence lands
 * here as a compile error instead of as a silently wrong render.
 *
 * The draft is already persisted when this returns — it has an `id` and `status:
 * 'draft'` — so the flow past this point is Describe's exactly: correct the amounts,
 * `PATCH` if they changed, then `confirm`.
 */
export type AnalyzeImageResult = Response<'/api/meals/analyze-image', 'post', 200>;

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

// ── The day: events and the plan ───────────────────────────────────────────────

/** One thing that happened, as `GET /api/events/today` lists it. */
export type DayEvent = Response<'/api/events/today', 'get', 200>['data'][number];
export type EventType = DayEvent['type'];

/**
 * One page of history, as `GET /api/events` returns it: newest first, and a `nextCursor`
 * that is `null` on the last page. The cursor is opaque — sent back verbatim, never read.
 */
export type EventPage = Response<'/api/events', 'get', 200>;
export type HistoryEvent = EventPage['data'][number];

/**
 * Plan vs actual for one day. Every judgement in it — which event satisfied which plan
 * item, whether it was on time, the adherence percentage — is the backend's
 * reconciliation (`daily-plans/reconciliation.ts`); the frontend only renders it.
 */
export type PlanComparison = Response<'/api/daily-plan/comparison', 'get', 200>;
export type PlanComparisonItem = PlanComparison['items'][number];
export type Adherence = PlanComparisonItem['adherence'];

// ── Check-ins ──────────────────────────────────────────────────────────────────

/**
 * One day's check-in. The server keeps one per local day and upserts it: a second save
 * replaces the first — including any field left out, which becomes null.
 */
export type Checkin = Response<'/api/checkins', 'post', 201>;
export type CheckinInput = Body<'/api/checkins', 'post'>;
export type Mood = CheckinInput['mood'];
export type DayTag = NonNullable<CheckinInput['dayTag']>;

// ── Weekly insights ────────────────────────────────────────────────────────────

/**
 * The week's facts, as `GET /api/insights/weekly` computes them — deterministically, in
 * the profile timezone, Monday to Sunday. Every figure, rate, comparison and limitation
 * is the backend's; a behaviour figure with no data behind it is `null`, never 0.
 */
export type WeeklyReport = Response<'/api/insights/weekly', 'get', 200>;
export type WeeklyLimitation = WeeklyReport['dataQuality']['limitations'][number];
export type WeeklyComparisonMetric = WeeklyReport['comparison']['metrics'][number];
export type WeeklyPattern = WeeklyReport['patterns']['items'][number];

/**
 * `POST /api/insights/weekly/story`: the report again, plus prose written from it — or,
 * when the status is `insufficient_data` or `disabled`, no prose at all.
 */
export type WeeklyStoryResult = Response<'/api/insights/weekly/story', 'post', 200>;
export type WeeklyStory = NonNullable<WeeklyStoryResult['story']>;

// ── The AI coach ───────────────────────────────────────────────────────────────

/**
 * `POST /api/agent/chat`: one message in, one validated reply out.
 *
 * **Stateless, by contract.** The body is `{ message }` and the schema is strict, so
 * there is no conversation id to send and inventing one would be a 400. The reply
 * carries no id either. AURA-BE keeps no conversation table and sends the model no
 * previous turn (`agent.service.ts`), which means a follow-up that depends on the turn
 * before it gets an answer saying so. Whatever transcript the screen shows belongs to
 * the screen: this session only, gone on reload, and never claimed to be saved.
 */
export type AgentChatInput = Body<'/api/agent/chat', 'post'>;
export type AgentChatResponse = Response<'/api/agent/chat', 'post', 200>;

/**
 * Which of four shapes a reply is. **All four arrive as `200`.**
 *
 *   answer    the model answered, in scope
 *   boundary  outside AURA's scope — the model's own judgement, or the safety gate's
 *   support   the safety gate answered instead of the model, with a written fixed reply
 *   disabled  this person has AI features turned off in their own preferences
 *
 * None of them is an error and none of them is the frontend's decision. `support` in
 * particular is the backend's crisis path (`agent/safety-responses.ts`): the text is
 * written by people, the model never sees the message, and this app's whole job is to
 * show that text as it was written.
 */
export type AgentReplyKind = AgentChatResponse['kind'];

/** What the backend classified the message as. Chosen server-side; never sent by us. */
export type AgentIntent = AgentChatResponse['intent'];

/**
 * A statement and the source ids behind it.
 *
 * `evidence` holds deterministic machine refs — `metric:meals.lunch_days`, `pattern:<id>`
 * — not prose. They are the server's audit trail for the claim, not a caption.
 */
export type AgentStatement = AgentChatResponse['answer'];

export type AgentSection = AgentChatResponse['sections'][number];

/**
 * `fact` states cited evidence, `interpretation` is a tentative reading of it, `general`
 * is education that cites nothing and is not about this person. The backend enforces the
 * difference; showing them alike would throw away the distinction it enforces.
 */
export type AgentSectionKind = AgentSection['kind'];

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

export const MOODS = ['low', 'okay', 'good', 'great'] as const;
export const DAY_TAGS = ['normal', 'busy', 'better_than_expected', 'not_as_planned'] as const;

// Referenced by the assertions below; `void` keeps them from being unused exports.
type UnitsMatch = Exact<(typeof MEAL_UNITS)[number], MealUnit>;
type SizesMatch = Exact<(typeof SIZE_LABELS)[number], SizeLabel>;
type MoodsMatch = Exact<(typeof MOODS)[number], Mood>;
type DayTagsMatch = Exact<(typeof DAY_TAGS)[number], DayTag>;

/** Compile-time only: a drifted enum makes one of these `never` and the build fails. */
export const CONTRACT_ENUMS_MATCH: [UnitsMatch, SizesMatch, MoodsMatch, DayTagsMatch] = [
  true,
  true,
  true,
  true,
];
