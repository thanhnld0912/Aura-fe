import React from 'react';
import { ASSETS } from '../../data/initialData';

/**
 * Shortcuts into the food search.
 *
 * These three cards used to log a whole meal on a single tap, with the calorie count
 * written into the click handler — 140 kcal for a cà phê sữa đá, 490 for a phở, 95
 * for a fruit plate. Those numbers were invented in the frontend and went straight
 * into someone's health record.
 *
 * They are now what they always looked like: suggestions. Tapping one puts the name
 * into the search box, and the meal is then resolved and priced by the server like
 * any other. Nothing here asserts a nutrition value or logs anything.
 *
 * The images are decorative fixtures from the original design; the *food* comes from
 * the database, and a card whose search finds nothing simply finds nothing.
 */

interface Suggestion {
  query: string;
  label: string;
  kicker: string;
  kickerClass: string;
  image: string;
}

const SUGGESTIONS: readonly Suggestion[] = [
  {
    query: 'cà phê sữa đá',
    label: 'Cà phê sữa đá',
    kicker: 'Quick Drink',
    kickerClass: 'text-[#9f4118]',
    image: ASSETS.coffee,
  },
  {
    query: 'phở bò',
    label: 'Phở bò',
    kicker: 'Breakfast Classic',
    kickerClass: 'text-[#2b6952]',
    image: ASSETS.pho,
  },
  {
    query: 'trái cây',
    label: 'Trái cây',
    kicker: 'Mindful Snack',
    kickerClass: 'text-[#6050af]',
    image: ASSETS.fruit,
  },
];

export const QuickInspiration: React.FC<{ onSearch: (query: string) => void }> = ({
  onSearch,
}) => (
  <div className="mt-6 pt-2 grid grid-cols-1 sm:grid-cols-3 gap-3">
    {SUGGESTIONS.map((suggestion) => (
      <button
        key={suggestion.query}
        type="button"
        onClick={() => onSearch(suggestion.query)}
        className="text-left rounded-2xl p-3 bg-white shadow-xs border border-[#eee7e1] flex items-center gap-3 hover:scale-[1.02] transition-transform"
      >
        <div
          className="w-12 h-12 rounded-xl bg-cover bg-center flex-shrink-0"
          style={{ backgroundImage: `url('${suggestion.image}')` }}
        />
        <div className="min-w-0">
          <span
            className={`text-[10px] uppercase font-bold tracking-wider ${suggestion.kickerClass}`}
          >
            {suggestion.kicker}
          </span>
          <p className="text-xs font-bold text-[#1e1b17] truncate">{suggestion.label}</p>
          <span className="text-[11px] text-[#56423b]">Tap to search</span>
        </div>
      </button>
    ))}
  </div>
);
