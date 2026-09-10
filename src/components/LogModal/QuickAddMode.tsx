import React from 'react';
import { MEAL_UNITS, SIZE_LABELS, type Food, type MealUnit, type SizeLabel } from '../../lib/api';
import type { DraftItem } from './types';

/**
 * Quick Add: search the food database, pick foods, say how much.
 *
 * ## Why the amount controls look like this
 *
 * The search response describes each food's portions (`1 chén`, 150 g), but the write
 * schema accepts only `quantity`, `unit` and an optional `sizeLabel` — there is no
 * `portionId` and no grams field. So the portions are shown as **reference**, and the
 * amount is expressed in the vocabulary the server actually accepts.
 *
 * A unit the food has no portion row for still works: the server falls back to a
 * category default and says so in the `trace` on the review screen. Rather than hide
 * that, the units a food genuinely knows about are marked, so choosing an unmarked
 * one is an informed choice instead of a silent downgrade in accuracy.
 */

/**
 * The server's own portion synonyms (`nutrition/portion-resolver.ts`).
 *
 * Duplicated deliberately and narrowly: this only decides whether to *mark* a unit in
 * the picker. It never converts anything — grams are the server's business — so a
 * drift here costs a hint, not a wrong number.
 */
const UNIT_SYNONYMS: Partial<Record<MealUnit, string[]>> = {
  bowl: ['bowl', 'chen', 'chén', 'tô', 'to', 'bát', 'bat'],
  plate: ['plate', 'đĩa', 'dia'],
  piece: ['piece', 'quả', 'qua', 'cái', 'cai', 'miếng', 'mieng', 'lát', 'lat'],
  serving: ['serving', 'phần', 'phan', 'portion'],
};

function foodKnowsUnit(portions: Food['portions'], unit: MealUnit): boolean {
  // Weight and volume need no portion row — the server takes them literally.
  if (unit === 'g' || unit === 'ml') return true;

  const synonyms = UNIT_SYNONYMS[unit];
  if (!synonyms) return false;

  return portions.some((portion) => {
    const haystack = `${portion.label} ${portion.labelVi ?? ''}`.toLowerCase();
    return synonyms.some((word) => haystack.includes(word.toLowerCase()));
  });
}

/** The unit to start a food on: its default portion's, else a serving. */
export function defaultUnitFor(portions: Food['portions']): MealUnit {
  const preferred = portions.find((portion) => portion.isDefault) ?? portions[0];
  if (!preferred) return 'serving';

  for (const unit of ['bowl', 'plate', 'piece', 'serving'] as const) {
    if (foodKnowsUnit([preferred], unit)) return unit;
  }
  return 'serving';
}

export interface ItemEditorsProps {
  drafts: DraftItem[];
  onUpdateItem: (key: string, patch: Partial<Pick<DraftItem, 'quantity' | 'unit' | 'sizeLabel'>>) => void;
  onRemoveItem: (key: string) => void;
}

interface QuickAddModeProps {
  query: string;
  results: Food[];
  drafts: DraftItem[];
  searching: boolean;
  busy: boolean;
  onQueryChange: (query: string) => void;
  onSelectFood: (food: Food) => void;
  onUpdateItem: (key: string, patch: Partial<Pick<DraftItem, 'quantity' | 'unit' | 'sizeLabel'>>) => void;
  onRemoveItem: (key: string) => void;
  onCalculate: () => void;
}

export const QuickAddMode: React.FC<QuickAddModeProps> = ({
  query,
  results,
  drafts,
  searching,
  busy,
  onQueryChange,
  onSelectFood,
  onUpdateItem,
  onRemoveItem,
  onCalculate,
}) => (
  <div className="space-y-4">
    <div className="rounded-2xl bg-[#faf2ec] p-4 sm:p-5 border border-[#eee7e1]/80 space-y-3">
      <label
        htmlFor="food-search"
        className="flex items-center gap-1.5 text-xs font-semibold text-[#56423b]"
      >
        <span className="material-symbols-outlined text-[16px] text-[#2b6952]">search</span>
        <span>Find a food</span>
      </label>
      <input
        id="food-search"
        type="search"
        value={query}
        onChange={(event) => onQueryChange(event.target.value)}
        placeholder="cơm trắng, phở bò, chicken…"
        autoComplete="off"
        className="w-full px-4 py-2.5 rounded-xl bg-white border border-[#eee7e1] text-sm text-[#1e1b17] placeholder:text-[#bda99f] focus:outline-none focus:border-[#2b6952] transition-colors"
      />

      {searching && <p className="text-xs text-[#8a726a]">Searching…</p>}

      {!searching && query.trim().length > 0 && results.length === 0 && (
        <p className="text-xs text-[#8a726a]">
          No food matched “{query.trim()}”. Try a different word, or use{' '}
          <span className="font-semibold text-[#9f4118]">Tell AURA</span> to describe it.
        </p>
      )}

      {results.length > 0 && (
        <ul className="space-y-1.5 max-h-64 overflow-y-auto">
          {results.map((food) => (
            <li key={food.foodId}>
              <button
                type="button"
                onClick={() => onSelectFood(food)}
                className="w-full text-left px-3 py-2 rounded-xl bg-white border border-[#eee7e1] hover:border-[#2b6952]/50 hover:bg-[#adedd0]/10 transition-colors"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-bold text-[#1e1b17] min-w-0 truncate">
                    {food.nameVi ?? food.nameEn}
                  </span>
                  <span className="text-[10px] uppercase font-bold tracking-wider text-[#8a726a] flex-shrink-0">
                    {food.provider} · {food.dataQuality}
                  </span>
                </div>
                {food.nameVi && (
                  <span className="text-xs text-[#56423b]">{food.nameEn}</span>
                )}
                {food.portions.length > 0 && (
                  <span className="block text-[11px] text-[#8a726a] mt-0.5">
                    {food.portions
                      .slice(0, 3)
                      .map((portion) => `${portion.labelVi ?? portion.label} ≈ ${portion.grams} g`)
                      .join(' · ')}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>

    {drafts.length > 0 && (

      <>
        <ItemEditors
          drafts={drafts}
          onUpdateItem={onUpdateItem}
          onRemoveItem={onRemoveItem}
        />

        <button
          type="button"
          onClick={onCalculate}
          disabled={busy}
          className="w-full py-3 px-6 rounded-full bg-[#2b6952] text-white font-bold text-sm hover:bg-[#306d56] disabled:opacity-60 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
        >
          <span className="material-symbols-outlined text-[20px]">calculate</span>
          <span>Work out the nutrition</span>
        </button>
      </>
    )}
  </div>
);

/**
 * The amount controls for a set of items.
 *
 * Shared by both flows: Quick Add builds these from search results, and Describe
 * builds them from a parsed draft so a misread quantity can be corrected before the
 * meal is confirmed. Neither carries a nutrition value — changing a row sends the
 * item list back to the server, which re-resolves everything.
 */
export const ItemEditors: React.FC<ItemEditorsProps> = ({
  drafts,
  onUpdateItem,
  onRemoveItem,
}) => (
  <div className="space-y-3">
    {drafts.map((draft) => (
      <div
        key={draft.key}
        className="bg-white p-4 rounded-2xl shadow-sm border border-[#eee7e1] space-y-3"
      >
        <div className="flex items-start justify-between gap-2">
          <h3 className="text-sm font-bold text-[#1e1b17] min-w-0 break-words">
            {draft.label}
          </h3>
          <button
            type="button"
            onClick={() => onRemoveItem(draft.key)}
            aria-label={`Remove ${draft.label}`}
            className="w-7 h-7 rounded-full bg-[#faf2ec] hover:bg-[#eee7e1] text-[#56423b] flex items-center justify-center flex-shrink-0"
          >
            <span className="material-symbols-outlined text-[16px]">close</span>
          </button>
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-0">
            <label
              htmlFor={`qty-${draft.key}`}
              className="block text-[11px] font-semibold text-[#56423b] mb-1"
            >
              Amount
            </label>
            <input
              id={`qty-${draft.key}`}
              type="number"
              min={0.1}
              max={100}
              step={0.5}
              value={draft.quantity}
              onChange={(event) => {
                const quantity = Number(event.target.value);
                if (Number.isFinite(quantity) && quantity > 0) {
                  onUpdateItem(draft.key, { quantity });
                }
              }}
              className="w-24 px-3 py-2 rounded-xl bg-[#faf2ec] border border-transparent text-sm text-[#1e1b17] focus:outline-none focus:border-[#2b6952] focus:bg-white"
            />
          </div>

          <div>
            <label
              htmlFor={`unit-${draft.key}`}
              className="block text-[11px] font-semibold text-[#56423b] mb-1"
            >
              Unit
            </label>
            <select
              id={`unit-${draft.key}`}
              value={draft.unit}
              onChange={(event) =>
                onUpdateItem(draft.key, { unit: event.target.value as MealUnit })
              }
              className="px-3 py-2 rounded-xl bg-[#faf2ec] border border-transparent text-sm text-[#1e1b17] focus:outline-none focus:border-[#2b6952] focus:bg-white"
            >
              {MEAL_UNITS.map((unit) => (
                <option key={unit} value={unit}>
                  {unit}
                  {foodKnowsUnit(draft.portions, unit) ? '' : ' (approx.)'}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label
              htmlFor={`size-${draft.key}`}
              className="block text-[11px] font-semibold text-[#56423b] mb-1"
            >
              Size
            </label>
            <select
              id={`size-${draft.key}`}
              value={draft.sizeLabel ?? ''}
              onChange={(event) => {
                const value = event.target.value;
                onUpdateItem(draft.key, {
                  ...(value ? { sizeLabel: value as SizeLabel } : { sizeLabel: undefined }),
                });
              }}
              className="px-3 py-2 rounded-xl bg-[#faf2ec] border border-transparent text-sm text-[#1e1b17] focus:outline-none focus:border-[#2b6952] focus:bg-white"
            >
              <option value="">as served</option>
              {SIZE_LABELS.filter((size) => size !== 'custom').map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>
          </div>
        </div>

        {draft.portions.length > 0 && (
          <p className="text-[11px] text-[#8a726a]">
            AURA knows:{' '}
            {draft.portions
              .map((portion) => `${portion.labelVi ?? portion.label} ≈ ${portion.grams} g`)
              .join(' · ')}
          </p>
        )}
      </div>
    ))}
  </div>
);
