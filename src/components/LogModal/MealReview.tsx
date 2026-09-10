import React from 'react';
import type { Nutrients } from '../../lib/api';
import type { ReviewItem, ReviewModel } from './types';

/**
 * The review screen, shared by both flows.
 *
 * Every number on it came from the server in the response being rendered. Nothing
 * here adds, scales, rounds or fills in a value — the old modal did all four, and
 * the result was a calorie figure the user could watch change as they clicked a
 * portion button that had never left the browser.
 *
 * Two rules the markup enforces:
 *   - `kcal` renders only when the key is present. Absent means the user turned
 *     calorie display off and the server never sent it; a `?? 0` would show them a
 *     fabricated zero instead of nothing.
 *   - `null` renders as an em dash, not as `0`. "Not known" and "none" are different
 *     facts about someone's food.
 */

interface MealReviewProps {
  review: ReviewModel;
  /** The preview is out of date because a recalculation failed. */
  stale: boolean;
  saving: boolean;
  saved: boolean;
  onSave: () => void;
  saveLabel: string;
}

const BAND_STYLE: Record<ReviewItem['confidenceBand'], { className: string; label: string }> = {
  confident: { className: 'bg-[#adedd0] text-[#306d56]', label: 'Confident' },
  estimate: { className: 'bg-[#e8e1db] text-[#56423b]', label: 'Estimate' },
  uncertain: { className: 'bg-[#ffdbce] text-[#7f2b01]', label: 'Uncertain' },
  unresolved: { className: 'bg-[#ffdad6] text-[#93000a]', label: 'Not found' },
};

/** The server's value, verbatim. `null` is a fact, not a zero. */
const show = (value: number | null | undefined, suffix = ''): string =>
  value === null || value === undefined ? '—' : `${value}${suffix}`;

const MacroRow: React.FC<{ label: string; value: number | null | undefined }> = ({
  label,
  value,
}) => (
  <div className="flex justify-between text-xs">
    <span className="text-[#56423b]">{label}</span>
    <span className="font-semibold text-[#1e1b17]">{show(value, value == null ? '' : 'g')}</span>
  </div>
);

const Energy: React.FC<{ nutrition: Nutrients }> = ({ nutrition }) => {
  // Key absent → the user asked not to see calories. Render nothing at all.
  if (!('kcal' in nutrition)) return null;

  return (
    <div className="mt-4 p-3 bg-white rounded-xl shadow-xs flex items-center justify-between border border-[#eee7e1]">
      <div className="flex items-center gap-1.5">
        <span className="material-symbols-outlined text-[18px] text-[#9f4118]">
          local_fire_department
        </span>
        <span className="text-xs font-semibold text-[#1e1b17]">Est. Energy</span>
      </div>
      <span className="text-base font-bold text-[#9f4118]">
        {nutrition.kcal === null ? '—' : `~${nutrition.kcal} kcal`}
      </span>
    </div>
  );
};

export const MealReview: React.FC<MealReviewProps> = ({
  review,
  stale,
  saving,
  saved,
  onSave,
  saveLabel,
}) => (
  <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
    {/* Left: the items the server resolved */}
    <div className="lg:col-span-8 flex flex-col gap-4">
      <div className="flex items-start gap-3 bg-gradient-to-r from-[#e6deff]/40 via-[#faf2ec] to-[#ffdbce]/20 p-4 rounded-2xl border border-[#eee7e1]/60">
        <div className="w-11 h-11 rounded-full bg-[#6050af] text-white flex items-center justify-center font-bold text-lg shadow-sm flex-shrink-0">
          ✨
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-bold text-[#1e1b17]">AURA Nutritionist</span>
            <span className="text-xs text-[#56423b]">Resolved on the server</span>
          </div>
          <p className="text-sm text-[#56423b] mt-0.5">
            Here is what AURA resolved. Every figure below comes from the food database
            — adjust anything that looks off.
          </p>
        </div>
      </div>

      {stale && (
        <div className="rounded-2xl border border-[#ffdbce] bg-[#ffdbce]/30 px-4 py-2.5 text-xs text-[#7f2b01] flex items-center gap-2">
          <span className="material-symbols-outlined text-[16px]">update_disabled</span>
          <span>
            These figures are from your previous amounts — the last recalculation did
            not complete.
          </span>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {review.items.map((item) => {
          const band = BAND_STYLE[item.confidenceBand];
          return (
            <div
              key={item.key}
              className="bg-white p-4 rounded-2xl shadow-sm border border-[#eee7e1] flex flex-col gap-2"
            >
              <div className="flex items-start justify-between gap-2">
                <h3 className="text-base font-bold text-[#1e1b17] min-w-0 break-words">
                  {item.name}
                </h3>
                <span
                  className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold flex-shrink-0 ${band.className}`}
                >
                  {band.label}
                </span>
              </div>

              <div className="text-xs text-[#56423b]">
                {item.quantity !== null && item.unit
                  ? `${item.quantity} ${item.unit}`
                  : 'Amount not recorded'}
                {item.gramsResolved !== null && (
                  <span className="text-[#8a726a]"> · {item.gramsResolved} g resolved</span>
                )}
              </div>

              <div className="space-y-1 pt-1 border-t border-[#eee7e1]/70">
                {'kcal' in item.nutrition && (
                  <div className="flex justify-between text-xs">
                    <span className="text-[#56423b]">Energy</span>
                    <span className="font-semibold text-[#1e1b17]">
                      {show(item.nutrition.kcal, item.nutrition.kcal == null ? '' : ' kcal')}
                    </span>
                  </div>
                )}
                <MacroRow label="Protein" value={item.nutrition.proteinG} />
                <MacroRow label="Carbohydrates" value={item.nutrition.carbsG} />
                <MacroRow label="Fat" value={item.nutrition.fatG} />
                <MacroRow label="Fibre" value={item.nutrition.fiberG} />
              </div>

              <div className="text-[10px] text-[#bda99f] leading-relaxed">
                source: {item.source} · confidence {item.confidence}
                {item.trace && <span className="block break-words">{item.trace}</span>}
              </div>
            </div>
          );
        })}
      </div>

      {review.ambiguous.length > 0 && (
        <div className="rounded-2xl border border-[#eee7e1] bg-[#faf2ec] p-4">
          <p className="text-xs font-bold text-[#1e1b17]">AURA could not read these parts</p>
          <p className="text-xs text-[#56423b] mt-1">{review.ambiguous.join(' · ')}</p>
        </div>
      )}

      {review.unresolved.length > 0 && (
        <div className="rounded-2xl border border-[#ffdad6] bg-[#ffdad6]/30 p-4">
          <p className="text-xs font-bold text-[#93000a]">No nutrition found for</p>
          <p className="text-xs text-[#93000a]/90 mt-1">{review.unresolved.join(' · ')}</p>
          <p className="text-[11px] text-[#93000a]/80 mt-1.5">
            These are logged without figures rather than guessed at.
          </p>
        </div>
      )}

      <div className="flex flex-col sm:flex-row items-center gap-3 pt-1">
        <button
          id="confirm-log-btn"
          onClick={onSave}
          disabled={saving || saved}
          className={`w-full sm:flex-1 py-3 px-6 rounded-full font-bold text-sm shadow-[0_10px_24px_-4px_rgba(255,138,91,0.4)] enabled:hover:scale-[1.01] enabled:active:scale-[0.98] transition-all flex items-center justify-center gap-2 text-white disabled:opacity-80 disabled:cursor-not-allowed ${
            saved ? 'bg-[#2b6952]' : 'bg-[#9f4118] enabled:hover:bg-[#ff8a5b]'
          }`}
          type="button"
        >
          {saving ? (
            <>
              <span className="material-symbols-outlined text-[20px] animate-spin">sync</span>
              <span>Saving to timeline…</span>
            </>
          ) : saved ? (
            <>
              <span className="material-symbols-outlined text-[20px]">task_alt</span>
              <span>Logged 🎉</span>
            </>
          ) : (
            <>
              <span className="material-symbols-outlined text-[20px]">check_circle</span>
              <span>{saveLabel}</span>
            </>
          )}
        </button>
      </div>
    </div>

    {/* Right: the totals, as returned */}
    <div className="lg:col-span-4">
      <div className="bg-[#faf2ec] p-5 rounded-2xl border border-[#eee7e1] h-full flex flex-col justify-between">
        <div>
          <div className="flex items-center justify-between pb-3 border-b border-[#eee7e1]">
            <span className="text-sm font-bold text-[#1e1b17]">Mindful Breakdown</span>
            <span className="text-xs px-2.5 py-0.5 bg-white rounded-full text-[#2b6952] font-bold shadow-xs">
              Estimate
            </span>
          </div>

          <div className="space-y-2.5 pt-3">
            <MacroRow label="Protein" value={review.totals.proteinG} />
            <MacroRow label="Carbohydrates" value={review.totals.carbsG} />
            <MacroRow label="Fat" value={review.totals.fatG} />
            <MacroRow label="Fibre" value={review.totals.fiberG} />
          </div>

          <Energy nutrition={review.totals} />
        </div>

        <div className="mt-4 p-3 rounded-xl bg-[#adedd0]/40 flex items-start gap-2 border border-[#adedd0]/60">
          <span className="text-base mt-0.5">🌿</span>
          <p className="text-xs text-[#0b513b] leading-relaxed">{review.notice}</p>
        </div>
      </div>
    </div>
  </div>
);
