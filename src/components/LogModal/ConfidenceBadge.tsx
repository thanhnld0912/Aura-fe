import React from 'react';
import type { ConfidenceBand } from '../../lib/api';

/**
 * How sure the server is, and where its figures came from.
 *
 * These are **two different facts** and the component keeps them apart, because
 * conflating them is the easy mistake here:
 *
 *   `confidenceBand`  the API's own presentation rule for `confidence`
 *   `confidence`      a 0–1 composite: identification × portion × data quality
 *   `source`          provenance — which database the numbers came out of
 *
 * A USDA row (excellent provenance) matched to the wrong phrase is low confidence;
 * a user-stated item is pinned to 1.0 whatever its provenance. Neither number is
 * derived here. `NUTRITION_ARCHITECTURE.md` §6 is explicit that the band is
 * "returned by the API so the presentation rule lives with the contract rather than
 * being reinvented per client" — so this reads `confidenceBand` and never re-derives
 * a band from the number.
 */

const BAND_STYLE: Record<ConfidenceBand, { className: string; label: string }> = {
  confident: { className: 'bg-[#adedd0] text-[#306d56]', label: 'Confident' },
  estimate: { className: 'bg-[#e8e1db] text-[#56423b]', label: 'Estimate' },
  uncertain: { className: 'bg-[#ffdbce] text-[#7f2b01]', label: 'Uncertain' },
  unresolved: { className: 'bg-[#ffdad6] text-[#93000a]', label: 'Not found' },
};

export interface ConfidenceBadgeProps {
  band: ConfidenceBand;
  /** The composite 0–1 score. Shown as a percentage, except when unresolved. */
  confidence?: number | null;
}

export const ConfidenceBadge: React.FC<ConfidenceBadgeProps> = ({ band, confidence }) => {
  const style = BAND_STYLE[band];

  /**
   * §6: an unresolved item gets "no number at all". There is nothing to be a
   * percentage of — the server could not resolve the food — and printing 0% would
   * read as "certainly nothing", which is the opposite of what happened.
   */
  const percent =
    band === 'unresolved' || confidence === null || confidence === undefined
      ? null
      : Math.round(confidence * 100);

  return (
    <span
      className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold flex-shrink-0 ${style.className}`}
      title={percent === null ? style.label : `${style.label} — ${percent}% confidence`}
    >
      {style.label}
      {percent !== null && <span className="font-semibold opacity-70"> · {percent}%</span>}
    </span>
  );
};

/**
 * Where a figure came from.
 *
 * `source` is `type: string` in the contract with **no enum**, so the known values are
 * given names and anything else is shown verbatim rather than mapped to a guess or
 * hidden. The list below is what AURA-BE emits today; a new one appearing renders as
 * itself instead of disappearing.
 */
const SOURCE_LABEL: Record<string, string> = {
  local: 'AURA food database',
  usda: 'USDA',
  off: 'Open Food Facts',
  vision: 'Estimated from your photo',
  user: 'You said so',
  estimate: 'Estimated',
  unresolved: 'No match found',
};

export const SourceAttribution: React.FC<{ source: string; trace?: string | undefined }> = ({
  source,
  trace,
}) => (
  <div className="text-[10px] text-[#bda99f] leading-relaxed">
    <span>{SOURCE_LABEL[source] ?? source}</span>
    {trace && <span className="block break-words">{trace}</span>}
  </div>
);
