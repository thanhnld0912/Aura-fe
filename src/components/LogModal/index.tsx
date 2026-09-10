import React, { useCallback, useEffect, useMemo, useReducer, useRef } from 'react';
import {
  ApiError,
  NetworkError,
  calculateNutrition,
  confirmMeal,
  createMeal,
  parseMeal,
  searchFoods,
  updateMeal,
  type Food,
  type MealType,
} from '../../lib/api';
import type { ActivityCategory } from '../../types';
import { DescribeMode } from './DescribeMode';
import { MealReview } from './MealReview';
import { PhotoMode } from './PhotoMode';
import { ItemEditors, QuickAddMode, defaultUnitFor } from './QuickAddMode';
import { QuickInspiration } from './QuickInspiration';
import { initialState, isBusy, reducer, type Phase, type RequestError } from './state';
import { toMealItemInput, type DraftItem } from './types';

export interface LogModalProps {
  isOpen: boolean;
  onClose: () => void;
  /**
   * Fired once a meal is actually logged, with the id the server assigned.
   *
   * Replaces the old `onAddLogSuccess(MealLogDraft)`, which handed the parent a
   * fixture object carrying invented calories. The parent now reloads the day from
   * the API instead — the server is the only thing that knows what was saved.
   */
  onSaved: (mealId: string) => void;
  initialPrompt?: string;
}

/**
 * The meal composer.
 *
 * ## The Rules-of-Hooks fix
 *
 * The previous version opened with `if (!isOpen) return null;` and *then* called ten
 * `useState`s. React counts hooks per render, so the first render after the modal
 * opened called ten more hooks than the render before it — the condition React
 * rejects with "Rendered more hooks than during the previous render."
 *
 * The wrapper below calls **no hooks at all**, in either branch, and the component
 * that owns the state only exists while the modal is open. The hook order is
 * therefore constant by construction rather than by discipline, and the composer
 * gets a fresh state each time it opens instead of the last session's leftovers.
 */
export const LogModal: React.FC<LogModalProps> = (props) => {
  if (!props.isOpen) return null;
  return <LogModalContent {...props} />;
};

export default LogModal;

/** Only `eat` has a backend path today. The rest are visible but inert (§16). */
const CATEGORIES: ReadonlyArray<{ key: ActivityCategory; label: string; icon: string }> = [
  { key: 'eat', label: 'I ate', icon: '🍱' },
  { key: 'workout', label: 'I worked out', icon: '🏋️' },
  { key: 'walk', label: 'I walked', icon: '🚶' },
  { key: 'water', label: 'I drank water', icon: '💧' },
  { key: 'sleep', label: 'I slept', icon: '😴' },
  { key: 'check-in', label: 'Check-in', icon: '😊' },
  { key: 'other', label: 'Something else', icon: '✍️' },
];

const SEARCH_DEBOUNCE_MS = 300;

function describeFailure(error: RequestError): string {
  if (error instanceof NetworkError) return error.message;
  if (error.status === 429) return 'Too many requests. Please try again later.';
  return error.message;
}

const LogModalContent: React.FC<LogModalProps> = ({ onClose, onSaved, initialPrompt }) => {
  const [state, dispatch] = useReducer(reducer, initialPrompt ?? '', initialState);

  /**
   * The item signature the current preview was calculated for.
   *
   * Guards against re-calculating a set of items that has not changed — a repeated
   * click on "Work out the nutrition" costs nothing, and the `nutrition` bucket is
   * 60 requests a minute.
   */
  const calculatedFor = useRef<string | null>(null);
  /** One save per composer, whatever the button does. */
  const saveIssued = useRef(false);

  /**
   * Which asynchronous operation the composer is still waiting for.
   *
   * Every request that ends in a dispatch takes a number on the way out and checks it
   * on the way back; a reply whose number has been superseded is dropped instead of
   * rendered. Aborting is not enough on its own, because a response already in flight
   * still resolves, and the slower of two calculations would otherwise repaint the
   * review with an amount the user has already moved off. For a parse it is worse than
   * cosmetic: every parse persists its own draft, so a late reply would leave
   * `draftMealId` pointing at the abandoned one and `confirm` would promote the wrong
   * meal.
   */
  const latest = useRef(0);
  const claim = useCallback(() => (latest.current += 1), []);
  const superseded = useCallback((seq: number) => latest.current !== seq, []);

  const signature = useMemo(
    () => JSON.stringify(state.drafts.map(toMealItemInput)),
    [state.drafts],
  );

  const fail = useCallback((error: unknown, from: Phase) => {
    const known =
      error instanceof ApiError || error instanceof NetworkError
        ? error
        : new ApiError('Something went wrong.', 0, 'UNKNOWN');
    dispatch({ type: 'failed', error: known, from });
  }, []);

  // ── Quick Add: debounced search ─────────────────────────────────────────────
  const query = state.query;
  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length === 0) {
      dispatch({ type: 'searchOk', results: [] });
      return;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => {
      const seq = claim();
      dispatch({ type: 'searchStart' });
      searchFoods(trimmed, { limit: 8, signal: controller.signal })
        .then((results) => {
          if (controller.signal.aborted || superseded(seq)) return;
          dispatch({ type: 'searchOk', results });
        })
        .catch((error: unknown) => {
          // An aborted request is this effect being superseded, not a failure.
          if (controller.signal.aborted || superseded(seq)) return;
          fail(error, 'searching');
        });
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, fail, claim, superseded]);

  const handleSelectFood = useCallback((food: Food) => {
    const item: DraftItem = {
      key: `${food.foodId}-${Date.now()}`,
      foodId: food.foodId,
      label: food.nameVi ?? food.nameEn,
      quantity: 1,
      unit: defaultUnitFor(food.portions),
      portions: food.portions,
    };
    dispatch({ type: 'selectFood', item });
  }, []);

  const handleCalculate = useCallback(async () => {
    if (state.drafts.length === 0) return;
    if (calculatedFor.current === signature && !state.reviewStale) return;

    const seq = claim();
    dispatch({ type: 'calcStart' });
    try {
      const result = await calculateNutrition(state.drafts.map(toMealItemInput));
      if (superseded(seq)) return;
      calculatedFor.current = signature;
      dispatch({ type: 'calcOk', result });
    } catch (error) {
      if (superseded(seq)) return;
      fail(error, 'calculating');
    }
  }, [state.drafts, state.reviewStale, signature, fail, claim, superseded]);

  // ── Describe: parse ─────────────────────────────────────────────────────────
  const handleParse = useCallback(async () => {
    const text = state.text.trim();
    if (text.length === 0) return;

    const seq = claim();
    dispatch({ type: 'parseStart' });
    try {
      const { meal, ambiguous } = await parseMeal(text, state.mealType);
      if (superseded(seq)) return;
      dispatch({ type: 'parseOk', meal, ambiguous });
    } catch (error) {
      // The text stays exactly where it was, so a failed reading can be reworded
      // rather than retyped.
      if (superseded(seq)) return;
      fail(error, 'parsing');
    }
  }, [state.text, state.mealType, fail, claim, superseded]);

  // ── Saving ──────────────────────────────────────────────────────────────────
  const handleSave = useCallback(async () => {
    if (state.phase === 'saving' || saveIssued.current) return;
    saveIssued.current = true;
    // Claimed but never checked: a save is latched and terminal, so it does not need
    // to guard its own reply. Taking the number invalidates anything still in flight,
    // which stops a calculation landing mid-save and moving the phase off `saving`
    // — that would re-enable the button the latch is there to hold shut.
    claim();
    dispatch({ type: 'saveStart' });

    try {
      let saved;
      if (state.draftMealId) {
        // Describe: the parse already persisted a draft. PATCH first *only* if the
        // amounts were actually changed — patching an untouched draft would pin every
        // item to full confidence and mark the meal user-edited, which would claim a
        // correction nobody made. Confirm is what creates the timeline event.
        if (state.draftsDirty) {
          await updateMeal(state.draftMealId, state.drafts.map(toMealItemInput));
        }
        saved = await confirmMeal(state.draftMealId);
      } else {
        saved = await createMeal({
          mealType: state.mealType,
          items: state.drafts.map(toMealItemInput),
          status: 'confirmed',
        });
      }

      dispatch({ type: 'saveOk', mealId: saved.id, meal: saved });
      onSaved(saved.id);
      window.setTimeout(onClose, 900);
    } catch (error) {
      // Releasing the latch lets the person try again; the composer is still theirs.
      saveIssued.current = false;
      fail(error, 'saving');
    }
  }, [state.phase, state.draftMealId, state.draftsDirty, state.drafts, state.mealType, onSaved, onClose, fail, claim]);

  /** Describe mode: push corrected amounts back so the server re-resolves them. */
  const handleUpdateDraft = useCallback(async () => {
    if (!state.draftMealId || !state.draftsDirty) return;

    const seq = claim();
    dispatch({ type: 'calcStart' });
    try {
      const meal = await updateMeal(state.draftMealId, state.drafts.map(toMealItemInput));
      if (superseded(seq)) return;
      dispatch({ type: 'patchOk', meal });
    } catch (error) {
      if (superseded(seq)) return;
      fail(error, 'calculating');
    }
  }, [state.draftMealId, state.draftsDirty, state.drafts, fail, claim, superseded]);

  const busy = isBusy(state.phase);
  const showReview = state.review !== null && state.phase !== 'searching';

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-[#1e1b17]/40 backdrop-blur-md flex justify-center p-3 sm:p-6 lg:p-8 animate-in fade-in duration-200">
      <div className="relative w-full max-w-5xl my-auto">
        {/* Glow Accents */}
        <div className="absolute -top-12 left-1/4 w-80 h-80 bg-[#ffdbce]/40 rounded-full blur-3xl pointer-events-none -z-10" />
        <div className="absolute top-1/3 -right-10 w-72 h-72 bg-[#e6deff]/30 rounded-full blur-3xl pointer-events-none -z-10" />

        <div className="bg-white rounded-3xl shadow-[0_24px_54px_-12px_rgba(75,40,20,0.14),0_4px_20px_rgba(45,42,38,0.06)] p-5 sm:p-8 lg:p-10 relative overflow-hidden border border-[#eee7e1]/80 max-h-[92vh] overflow-y-auto">
          {/* Header Ribbon */}
          <div className="flex items-center justify-between gap-4 pb-6 border-b border-[#eee7e1]/60">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-full bg-[#ffdbce] flex items-center justify-center text-[#7f2b01] shadow-sm flex-shrink-0">
                <span className="material-symbols-outlined text-[24px]">auto_awesome</span>
              </div>
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <h2 className="text-xl sm:text-2xl font-bold text-[#1e1b17]">What happened?</h2>
                  <span className="px-2.5 py-0.5 bg-[#adedd0] text-[#306d56] rounded-full text-xs font-bold">
                    Live Context
                  </span>
                </div>
                <p className="text-xs sm:text-sm text-[#56423b] mt-0.5">
                  Log naturally in Vietnamese or English — AURA extracts the mindful details
                </p>
              </div>
            </div>
            <button
              aria-label="Close composer"
              onClick={onClose}
              className="w-10 h-10 rounded-full bg-[#eee7e1] hover:bg-[#e8e1db] text-[#56423b] hover:text-[#1e1b17] flex items-center justify-center transition-all duration-200 flex-shrink-0"
              type="button"
            >
              <span className="material-symbols-outlined text-[20px]">close</span>
            </button>
          </div>

          {/* Activity Category Selector — only `eat` reaches a backend today. */}
          <div className="flex items-center gap-2 overflow-x-auto py-4 no-scrollbar">
            {CATEGORIES.map((cat) => {
              const isActive = cat.key === 'eat';
              const available = cat.key === 'eat';
              return (
                <button
                  key={cat.key}
                  disabled={!available}
                  title={available ? undefined : 'Coming in a later phase'}
                  className={`px-4 py-2 rounded-full text-sm font-semibold flex items-center gap-2 flex-shrink-0 transition-all ${
                    isActive
                      ? 'bg-[#9f4118] text-white shadow-[0_8px_20px_-4px_rgba(255,138,91,0.4)]'
                      : 'bg-[#faf2ec] text-[#56423b] opacity-40 cursor-not-allowed'
                  }`}
                  type="button"
                >
                  <span className="text-base">{cat.icon}</span>
                  <span>{cat.label}</span>
                </button>
              );
            })}
          </div>

          {/* 3 Giant Visual Modes Bar */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-1 pb-6">
            <button
              onClick={() => dispatch({ type: 'setMode', mode: 'photo' })}
              type="button"
              className={`text-left rounded-2xl p-4 transition-all duration-300 flex items-center gap-3 border ${
                state.mode === 'photo'
                  ? 'bg-[#ffdbce]/40 border-[#ff8a5b] shadow-sm'
                  : 'bg-[#faf2ec] hover:bg-[#f4ede6] border-transparent'
              }`}
            >
              <div className="w-11 h-11 rounded-full bg-white flex items-center justify-center text-[#9f4118] shadow-sm flex-shrink-0">
                <span className="material-symbols-outlined text-[24px]">photo_camera</span>
              </div>
              <div className="min-w-0">
                <div className="text-sm font-bold text-[#1e1b17]">Take a photo</div>
                <p className="text-xs text-[#56423b] truncate">Coming soon</p>
              </div>
            </button>

            <button
              onClick={() => dispatch({ type: 'setMode', mode: 'describe' })}
              type="button"
              className={`text-left rounded-2xl p-4 transition-all duration-300 flex items-center gap-3 border ${
                state.mode === 'describe'
                  ? 'bg-[#ffdbce]/60 border-[#ff8a5b]/60 shadow-[0_6px_20px_-6px_rgba(255,138,91,0.25)]'
                  : 'bg-[#faf2ec] hover:bg-[#f4ede6] border-transparent'
              }`}
            >
              <div className="w-11 h-11 rounded-full bg-[#9f4118] text-white flex items-center justify-center shadow-md flex-shrink-0">
                <span className="material-symbols-outlined text-[24px]">edit_note</span>
              </div>
              <div className="min-w-0">
                <div className="text-sm font-bold text-[#370e00] flex items-center gap-2">
                  <span>Tell AURA</span>
                  <span className="w-2 h-2 rounded-full bg-[#9f4118] animate-pulse" />
                </div>
                <p className="text-xs text-[#7f2b01] truncate">Just describe your meal</p>
              </div>
            </button>

            <button
              onClick={() => dispatch({ type: 'setMode', mode: 'quick' })}
              type="button"
              className={`text-left rounded-2xl p-4 transition-all duration-300 flex items-center gap-3 border ${
                state.mode === 'quick'
                  ? 'bg-[#adedd0]/50 border-[#2b6952] shadow-sm'
                  : 'bg-[#faf2ec] hover:bg-[#f4ede6] border-transparent'
              }`}
            >
              <div className="w-11 h-11 rounded-full bg-white flex items-center justify-center text-[#2b6952] shadow-sm flex-shrink-0">
                <span className="material-symbols-outlined text-[24px]">bolt</span>
              </div>
              <div className="min-w-0">
                <div className="text-sm font-bold text-[#1e1b17]">Quick add</div>
                <p className="text-xs text-[#56423b] truncate">Pick the main ingredients</p>
              </div>
            </button>
          </div>

          {/* Mode body */}
          <div className="mb-6">
            {state.mode === 'photo' && <PhotoMode />}

            {state.mode === 'describe' && (
              <DescribeMode
                text={state.text}
                mealType={state.mealType}
                busy={busy}
                onTextChange={(text) => dispatch({ type: 'setText', text })}
                onMealTypeChange={(mealType: MealType) =>
                  dispatch({ type: 'setMealType', mealType })
                }
                onParse={() => void handleParse()}
              />
            )}

            {state.mode === 'quick' && (
              <QuickAddMode
                query={state.query}
                results={state.results}
                drafts={state.drafts}
                searching={state.phase === 'searching'}
                busy={busy}
                onQueryChange={(value) => dispatch({ type: 'setQuery', query: value })}
                onSelectFood={handleSelectFood}
                onUpdateItem={(key, patch) => dispatch({ type: 'updateItem', key, patch })}
                onRemoveItem={(key) => dispatch({ type: 'removeItem', key })}
                onCalculate={() => void handleCalculate()}
              />
            )}
          </div>

          {/* Errors — inline, never a silent fallback to invented data. */}
          {state.error && (
            <div
              role="alert"
              className="mb-6 rounded-2xl border border-[#ffdad6] bg-[#ffdad6]/30 p-4 space-y-2"
            >
              <div className="flex items-start gap-2.5">
                <span className="material-symbols-outlined text-[#93000a] text-[20px]">error</span>
                <div className="min-w-0">
                  <p className="text-sm font-bold text-[#93000a]">
                    {describeFailure(state.error)}
                  </p>
                  {state.error instanceof ApiError && state.error.details && (
                    <ul className="text-xs text-[#93000a]/90 mt-1 space-y-0.5">
                      {state.error.details.map((detail) => (
                        <li key={`${detail.path}-${detail.issue}`}>
                          {detail.path}: {detail.issue}
                        </li>
                      ))}
                    </ul>
                  )}
                  {state.error instanceof ApiError && state.error.requestId && (
                    <p className="text-[10px] text-[#93000a]/70 mt-1 font-mono break-all">
                      Request {state.error.requestId}
                    </p>
                  )}
                </div>
              </div>
              <button
                type="button"
                onClick={() => dispatch({ type: 'retry' })}
                className="px-4 py-1.5 rounded-full bg-[#9f4118] text-white text-xs font-bold hover:bg-[#ff8a5b] transition-colors"
              >
                Back to editing
              </button>
            </div>
          )}

          {/* Review — only ever drawn from a server response. */}
          {showReview && state.review && (
            <div className="mb-8 space-y-4">
              {/* Describe: the parsed amounts, editable. A correction goes back to
                  PATCH /api/meals/:id, which re-resolves every figure server-side. */}
              {state.draftMealId && state.drafts.length > 0 && (
                <div className="space-y-3">
                  <p className="text-xs font-semibold text-[#56423b]">
                    Did AURA read the amounts right?
                  </p>
                  <ItemEditors
                    drafts={state.drafts}
                    onUpdateItem={(key, patch) => dispatch({ type: 'updateItem', key, patch })}
                    onRemoveItem={(key) => dispatch({ type: 'removeItem', key })}
                  />
                  {state.draftsDirty && (
                    <button
                      type="button"
                      onClick={() => void handleUpdateDraft()}
                      disabled={busy}
                      className="w-full py-2.5 px-6 rounded-full bg-[#2b6952] text-white font-bold text-xs hover:bg-[#306d56] disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
                    >
                      Update amounts
                    </button>
                  )}
                </div>
              )}

              <MealReview
                review={state.review}
                stale={state.reviewStale}
                saving={state.phase === 'saving'}
                saved={state.phase === 'saved'}
                onSave={() => void handleSave()}
                saveLabel="✓ Looks right — Add to today's timeline"
              />
            </div>
          )}

          <QuickInspiration
            onSearch={(value) => {
              dispatch({ type: 'setMode', mode: 'quick' });
              dispatch({ type: 'setQuery', query: value });
            }}
          />
        </div>
      </div>
    </div>
  );
};
