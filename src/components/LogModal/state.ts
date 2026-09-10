import type { ApiError, CalculationResult, Food, Meal, MealType, NetworkError } from '../../lib/api';
import type { DraftItem, LogMode, ReviewModel } from './types';
import { draftsFromMeal, reviewFromCalculation, reviewFromMeal } from './types';

/**
 * The composer's state machine.
 *
 * A reducer rather than a dozen booleans, for one concrete reason: the old modal
 * could be `isSaving` and `isSavedSuccess` and `isListening` at once, so illegal
 * states were representable and the Save button could be pressed twice. Here the
 * phase is a single value, and `saving` is the only place a save can start from.
 *
 *   idle → editing
 *   editing --describe--> parsing ------------------> reviewing
 *   editing --quick-----> searching → selecting → calculating → reviewing
 *   reviewing --amount changed--> calculating → reviewing
 *   reviewing → saving → saved
 *   any async phase → error → (retry) → the phase it came from
 *
 * No state-management library: this is one screen's worth of state and it belongs in
 * the screen.
 */

export type Phase =
  | 'idle'
  | 'editing'
  | 'parsing'
  | 'searching'
  | 'selecting'
  | 'calculating'
  | 'reviewing'
  | 'saving'
  | 'saved'
  | 'error';

export type RequestError = ApiError | NetworkError;

export interface LogState {
  phase: Phase;
  mode: LogMode;
  mealType: MealType;

  /** Describe mode: kept verbatim through a failure so nothing is retyped. */
  text: string;

  /** Quick Add. */
  query: string;
  results: Food[];
  drafts: DraftItem[];

  /** What the review screen draws. Always straight from a server response. */
  review: ReviewModel | null;
  /** A calculation failed, so `review` is the last good answer and now out of date. */
  reviewStale: boolean;

  /** Describe mode's persisted draft, which `confirm` later promotes. */
  draftMealId: string | null;
  /**
   * The user changed an amount on a parsed draft, so it needs a PATCH before it is
   * confirmed. Tracked rather than always patching: PATCH pins every item to full
   * confidence and marks the meal user-edited, which would be a lie about a draft
   * nobody touched.
   */
  draftsDirty: boolean;

  /** Set once the meal is logged, so the parent can reload the day exactly once. */
  savedMealId: string | null;

  error: RequestError | null;
  /** Where `retry` should return to. */
  errorFrom: Phase | null;
}

export const initialState = (initialText = ''): LogState => ({
  phase: initialText ? 'editing' : 'idle',
  mode: 'describe',
  mealType: 'lunch',
  text: initialText,
  query: '',
  results: [],
  drafts: [],
  review: null,
  reviewStale: false,
  draftMealId: null,
  draftsDirty: false,
  savedMealId: null,
  error: null,
  errorFrom: null,
});

export type Action =
  | { type: 'setMode'; mode: LogMode }
  | { type: 'setMealType'; mealType: MealType }
  | { type: 'setText'; text: string }
  | { type: 'parseStart' }
  | { type: 'parseOk'; meal: Meal; ambiguous: string[] }
  | { type: 'setQuery'; query: string }
  | { type: 'searchStart' }
  | { type: 'searchOk'; results: Food[] }
  | { type: 'selectFood'; item: DraftItem }
  | { type: 'removeItem'; key: string }
  | { type: 'updateItem'; key: string; patch: Partial<Pick<DraftItem, 'quantity' | 'unit' | 'sizeLabel'>> }
  | { type: 'calcStart' }
  | { type: 'calcOk'; result: CalculationResult }
  | { type: 'patchOk'; meal: Meal }
  | { type: 'saveStart' }
  | { type: 'saveOk'; mealId: string; meal: Meal }
  | { type: 'failed'; error: RequestError; from: Phase }
  | { type: 'retry' }
  | { type: 'dismissError' };

export function reducer(state: LogState, action: Action): LogState {
  switch (action.type) {
    case 'setMode':
      // Switching modes abandons the other mode's half-finished work rather than
      // carrying it across, where it would be reviewed as if it belonged here.
      return {
        ...initialState(),
        mode: action.mode,
        mealType: state.mealType,
        text: action.mode === 'describe' ? state.text : '',
        phase: 'editing',
      };

    case 'setMealType':
      return { ...state, mealType: action.mealType };

    case 'setText':
      return { ...state, text: action.text, phase: 'editing', error: null, errorFrom: null };

    case 'parseStart':
      return { ...state, phase: 'parsing', error: null, errorFrom: null };

    case 'parseOk':
      return {
        ...state,
        phase: 'reviewing',
        draftMealId: action.meal.id,
        drafts: draftsFromMeal(action.meal),
        draftsDirty: false,
        review: reviewFromMeal(action.meal, action.ambiguous),
        reviewStale: false,
        error: null,
        errorFrom: null,
      };

    case 'setQuery':
      return { ...state, query: action.query, error: null, errorFrom: null };

    case 'searchStart':
      return { ...state, phase: 'searching', error: null, errorFrom: null };

    case 'searchOk':
      // The request is done, so the phase must leave `searching` — leaving it there
      // kept a spinner on screen and hid the "nothing matched" message behind it.
      return {
        ...state,
        phase: state.drafts.length > 0 ? 'selecting' : 'editing',
        results: action.results,
      };

    case 'selectFood':
      return {
        ...state,
        phase: 'selecting',
        drafts: [...state.drafts, action.item],
        query: '',
        results: [],
      };

    case 'removeItem': {
      const drafts = state.drafts.filter((draft) => draft.key !== action.key);
      return {
        ...state,
        drafts,
        phase: drafts.length === 0 ? 'searching' : 'selecting',
        // The preview described the old set of items, so it no longer describes this one.
        review: drafts.length === 0 ? null : state.review,
        draftsDirty: true,
        reviewStale: drafts.length > 0,
      };
    }

    case 'updateItem':
      return {
        ...state,
        phase: 'selecting',
        drafts: state.drafts.map((draft) =>
          draft.key === action.key ? { ...draft, ...action.patch } : draft,
        ),
        draftsDirty: true,
        reviewStale: state.review !== null,
      };

    case 'calcStart':
      return { ...state, phase: 'calculating', error: null, errorFrom: null };

    case 'calcOk':
      return {
        ...state,
        phase: 'reviewing',
        review: reviewFromCalculation(action.result, state.drafts),
        reviewStale: false,
      };

    case 'patchOk':
      return {
        ...state,
        phase: 'reviewing',
        drafts: draftsFromMeal(action.meal),
        draftsDirty: false,
        review: reviewFromMeal(action.meal, state.review?.ambiguous ?? []),
        reviewStale: false,
      };

    case 'saveStart':
      // The guard that stops a double click becoming two meals. There is no
      // idempotency key on the backend yet, so this is the only thing between an
      // impatient second click and a duplicate row.
      if (state.phase === 'saving') return state;
      return { ...state, phase: 'saving', error: null, errorFrom: null };

    case 'saveOk':
      return {
        ...state,
        phase: 'saved',
        savedMealId: action.mealId,
        review: reviewFromMeal(action.meal, state.review?.ambiguous ?? []),
      };

    case 'failed':
      return {
        ...state,
        phase: 'error',
        error: action.error,
        errorFrom: action.from,
        // A failed calculation leaves the last good preview on screen, flagged, rather
        // than blanking it or replacing its numbers with zeros.
        reviewStale: action.from === 'calculating' ? true : state.reviewStale,
      };

    case 'retry':
    case 'dismissError':
      return {
        ...state,
        phase: recoveryPhase(state),
        error: null,
        errorFrom: null,
      };

    default:
      return state;
  }
}

/**
 * Where the composer lands after an error is cleared.
 *
 * Back to whatever was in progress, so nothing the user typed or chose is lost. A
 * failed parse returns to `editing` with the text intact; a failed save returns to
 * the review it was trying to save.
 */
function recoveryPhase(state: LogState): Phase {
  switch (state.errorFrom) {
    case 'parsing':
      return 'editing';
    case 'searching':
      return state.drafts.length > 0 ? 'selecting' : 'editing';
    case 'calculating':
    case 'saving':
      return state.review ? 'reviewing' : 'selecting';
    default:
      return state.drafts.length > 0 ? 'selecting' : 'editing';
  }
}

/** True while a request is in flight — every control that starts one reads this. */
export function isBusy(phase: Phase): boolean {
  return phase === 'parsing' || phase === 'searching' || phase === 'calculating' || phase === 'saving';
}
