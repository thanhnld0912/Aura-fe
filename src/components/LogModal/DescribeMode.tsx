import React from 'react';
import type { MealType } from '../../lib/api';

/**
 * Describe mode: a sentence in Vietnamese or English, parsed on the server.
 *
 * The parser is deterministic and runs in the backend — no model, no key, and
 * nothing here calls a provider. Phase 4 swaps the implementation behind the same
 * endpoint, so this component does not change when it lands.
 *
 * Parsing produces a **draft**, never a logged meal. The user reviews it, edits it if
 * the reading was wrong, and only then confirms.
 */

const MEAL_TYPES: ReadonlyArray<{ value: MealType; label: string }> = [
  { value: 'breakfast', label: 'Breakfast' },
  { value: 'lunch', label: 'Lunch' },
  { value: 'dinner', label: 'Dinner' },
  { value: 'snack', label: 'Snack' },
  { value: 'drink', label: 'Drink' },
];

interface DescribeModeProps {
  text: string;
  mealType: MealType;
  busy: boolean;
  onTextChange: (text: string) => void;
  onMealTypeChange: (mealType: MealType) => void;
  onParse: () => void;
}

export const DescribeMode: React.FC<DescribeModeProps> = ({
  text,
  mealType,
  busy,
  onTextChange,
  onMealTypeChange,
  onParse,
}) => (
  <div className="rounded-2xl bg-[#faf2ec] p-4 sm:p-5 border border-[#eee7e1]/80 space-y-4">
    <div className="flex items-center justify-between text-[#56423b] text-xs font-semibold">
      <div className="flex items-center gap-1.5">
        <span className="material-symbols-outlined text-[16px] text-[#9f4118]">forum</span>
        <span>Tell AURA what you ate</span>
      </div>
    </div>

    <div>
      <label htmlFor="describe-text" className="sr-only">
        Describe your meal
      </label>
      <textarea
        id="describe-text"
        value={text}
        onChange={(event) => onTextChange(event.target.value)}
        rows={3}
        maxLength={1000}
        placeholder="Tôi ăn 2 chén cơm với thịt kho trứng và canh rau…"
        className="w-full bg-white rounded-xl p-3 text-base text-[#1e1b17] border border-[#eee7e1] placeholder:text-[#bda99f] focus:outline-none focus:border-[#ff8a5b] transition-colors"
      />
    </div>

    <div className="flex flex-wrap items-center justify-between gap-3 pt-1 border-t border-[#e8e1db]/60">
      <div className="flex items-center gap-2">
        <label htmlFor="describe-meal-type" className="text-xs font-semibold text-[#56423b]">
          Meal
        </label>
        <select
          id="describe-meal-type"
          value={mealType}
          onChange={(event) => onMealTypeChange(event.target.value as MealType)}
          className="px-3 py-1.5 rounded-full bg-[#e8e1db] text-[#56423b] text-xs font-medium focus:outline-none focus:ring-1 focus:ring-[#ff8a5b]"
        >
          {MEAL_TYPES.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      <button
        type="button"
        onClick={onParse}
        disabled={busy || text.trim().length === 0}
        className="px-5 py-2.5 rounded-full bg-[#9f4118] text-white text-sm font-bold hover:bg-[#ff8a5b] disabled:opacity-60 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
      >
        <span className="material-symbols-outlined text-[18px]">auto_awesome</span>
        <span>{busy ? 'Reading…' : 'Let AURA read it'}</span>
      </button>
    </div>

    <p className="text-[11px] text-[#8a726a] leading-relaxed">
      AURA reads what you ate and how much. Every nutrition figure comes from the food
      database afterwards — the sentence never sets a number.
    </p>
  </div>
);
