import { describe, expect, it } from 'vitest';
import type { Meal, MealItem, MealType, Nutrients } from './api';
import { toTimelineSections } from './meals';

/**
 * The adapter is where a fabricated number would enter the UI, so most of what is
 * asserted here is what must *not* appear: no invented time, no zero standing in for
 * a missing calorie count, no sentence written on the user's behalf.
 */

const nutrients = (overrides: Partial<Nutrients> = {}): Nutrients => ({
  proteinG: 8.1,
  carbsG: 84.6,
  fatG: 0.9,
  fiberG: 1.2,
  ...overrides,
});

const item = (overrides: Partial<MealItem> = {}): MealItem => ({
  id: 'item-1',
  foodId: 'food-1',
  detectedName: 'com trang',
  displayNameVi: 'Cơm trắng',
  displayNameEn: 'Steamed white rice',
  quantity: 2,
  unit: 'bowl',
  gramsResolved: 300,
  portionLabel: 'medium',
  nutrition: nutrients(),
  source: 'local',
  confidence: 0.85,
  confidenceBand: 'confident',
  userConfirmed: false,
  ...overrides,
});

const meal = (overrides: Partial<Meal> = {}): Meal => ({
  id: 'meal-1',
  eventId: 'event-1',
  mealType: 'breakfast' as MealType,
  status: 'confirmed',
  rawInput: 'hai bát cơm trắng',
  items: [item()],
  totals: nutrients(),
  confidence: 0.85,
  confidenceBand: 'confident',
  userConfirmed: false,
  userEdited: false,
  isEstimate: true,
  createdAt: '2026-09-10T03:37:21.390Z',
  unresolved: [],
  notice: 'Nutrition figures are estimates based on typical portions.',
  ...overrides,
});

describe('toTimelineSections', () => {
  it('maps one breakfast into one section with one event', () => {
    const [section, ...rest] = toTimelineSections([meal()]);

    expect(rest).toEqual([]);
    expect(section).toMatchObject({ id: 'breakfast', period: 'Breakfast', icon: '🌅' });
    expect(section?.events).toHaveLength(1);
    expect(section?.events[0]).toMatchObject({
      id: 'meal-1',
      title: 'Breakfast',
      description: 'hai bát cơm trắng',
      statusBadge: 'Confident',
      statusType: 'success',
    });
  });

  it('groups by meal type, in the order a day runs', () => {
    const sections = toTimelineSections([
      meal({ id: 'd', mealType: 'dinner' }),
      meal({ id: 'b', mealType: 'breakfast' }),
      meal({ id: 's', mealType: 'snack' }),
      meal({ id: 'l', mealType: 'lunch' }),
    ]);

    expect(sections.map((s) => s.id)).toEqual(['breakfast', 'lunch', 'dinner', 'snack']);
    // A meal type nobody logged gets no heading — an empty "Drink" reads as a gap.
    expect(sections.map((s) => s.id)).not.toContain('drink');
  });

  it('keeps two meals of the same type together, in the order the API sent them', () => {
    const sections = toTimelineSections([
      meal({ id: 'first', mealType: 'snack' }),
      meal({ id: 'second', mealType: 'snack' }),
    ]);

    expect(sections).toHaveLength(1);
    expect(sections[0]?.events.map((e) => e.id)).toEqual(['first', 'second']);
  });

  it('produces an empty list for an empty day rather than a placeholder', () => {
    expect(toTimelineSections([])).toEqual([]);
  });

  describe('never inventing a time', () => {
    it('leaves the event time and the section range empty', () => {
      const [section] = toTimelineSections([meal()]);

      expect(section?.timeRange).toBe('');
      expect(section?.events[0]?.time).toBe('');
    });

    it('does not leak createdAt into any rendered field', () => {
      const [section] = toTimelineSections([meal({ createdAt: '2026-09-10T03:37:21.390Z' })]);
      const rendered = JSON.stringify(section);

      expect(rendered).not.toContain('2026-09-10');
      expect(rendered).not.toContain('03:37');
    });
  });

  describe('item labels', () => {
    it('prefers the Vietnamese name', () => {
      const [section] = toTimelineSections([meal()]);
      expect(section?.events[0]?.tags).toEqual(['Cơm trắng · 2 bowl']);
    });

    it('falls back to the English name when there is no Vietnamese one', () => {
      const [section] = toTimelineSections([
        meal({ items: [item({ displayNameVi: null })] }),
      ]);
      expect(section?.events[0]?.tags).toEqual(['Steamed white rice · 2 bowl']);
    });

    it('falls back to what the parser detected when neither name exists', () => {
      const [section] = toTimelineSections([
        meal({ items: [item({ displayNameVi: null, displayNameEn: null })] }),
      ]);
      expect(section?.events[0]?.tags).toEqual(['com trang · 2 bowl']);
    });
  });

  describe('description', () => {
    it('uses rawInput when the meal came from a sentence', () => {
      const [section] = toTimelineSections([meal({ rawInput: 'phở bò tái' })]);
      expect(section?.events[0]?.description).toBe('phở bò tái');
    });

    /** Truthful about why there is no text, rather than writing one. */
    it('says how the meal was entered when rawInput is null', () => {
      const [section] = toTimelineSections([meal({ rawInput: null })]);
      expect(section?.events[0]?.description).toBe('Logged as individual items.');
    });
  });

  describe('confidence', () => {
    it.each([
      ['confident', 'success', 'Confident'],
      ['estimate', 'neutral', 'Estimate'],
      ['uncertain', 'neutral', 'Uncertain'],
      ['unresolved', 'warning', 'Needs a look'],
    ] as const)('maps %s to %s', (band, statusType, badge) => {
      const [section] = toTimelineSections([meal({ confidenceBand: band })]);
      expect(section?.events[0]).toMatchObject({ statusType, statusBadge: badge });
    });
  });

  describe('the AURA note', () => {
    it('leads with what could not be resolved', () => {
      const [section] = toTimelineSections([
        meal({ unresolved: ['bánh mì đặc biệt'], confidenceBand: 'unresolved' }),
      ]);

      const note = section?.events[0]?.note;
      expect(note?.title).toBe('AURA Note');
      expect(note?.content).toContain('bánh mì đặc biệt');
      // The standing caveat is still there, underneath.
      expect(note?.content).toContain('estimates based on typical portions');
    });

    it('carries the notice alone when everything resolved', () => {
      const [section] = toTimelineSections([meal()]);
      expect(section?.events[0]?.note?.content).toBe(
        'Nutrition figures are estimates based on typical portions.',
      );
    });

    it('omits the note entirely when the server sent nothing to say', () => {
      const [section] = toTimelineSections([meal({ notice: '', unresolved: [] })]);
      expect(section?.events[0]?.note).toBeUndefined();
    });
  });

  /**
   * The rule that matters most. `showCalories: false` means the server omits `kcal`
   * from the payload; turning that absence into a `0` would show a fabricated number
   * to the one person who explicitly asked not to see the real one.
   */
  describe('calories', () => {
    it('shows kcal when the server sent a figure', () => {
      const [section] = toTimelineSections([meal({ totals: nutrients({ kcal: 390 }) })]);
      expect(section?.events[0]?.extraPill?.text).toContain('390 kcal');
    });

    it('shows no calories at all when the key is absent', () => {
      const [section] = toTimelineSections([meal({ totals: nutrients() })]);
      const text = section?.events[0]?.extraPill?.text ?? '';

      expect(text).not.toContain('kcal');
      expect(text).not.toContain('0 kcal');
      // The macros the server did send are still shown.
      expect(text).toContain('P 8.1g');
    });

    it('does not turn a null kcal into zero', () => {
      const [section] = toTimelineSections([meal({ totals: nutrients({ kcal: null }) })]);
      const text = section?.events[0]?.extraPill?.text ?? '';

      // No energy segment of any kind — not "0 kcal", not "null kcal", nothing.
      expect(text).not.toMatch(/kcal/);
      expect(text).toBe('P 8.1g · C 84.6g · F 0.9g · Fibre 1.2g');
    });

    it('drops the pill when nothing at all resolved', () => {
      const [section] = toTimelineSections([
        meal({
          totals: { proteinG: null, carbsG: null, fatG: null, fiberG: null },
          confidenceBand: 'unresolved',
        }),
      ]);
      expect(section?.events[0]?.extraPill).toBeUndefined();
    });

    it('omits individual macros the server could not resolve', () => {
      const [section] = toTimelineSections([
        meal({ totals: nutrients({ kcal: 120, fiberG: null }) }),
      ]);
      const text = section?.events[0]?.extraPill?.text ?? '';

      expect(text).toContain('120 kcal');
      expect(text).not.toContain('Fibre');
    });
  });
});

/**
 * A payload captured verbatim from a running backend, not hand-written.
 *
 * The unit tests above use fixtures the test author shaped, which means they can only
 * ever prove the adapter is self-consistent. This one proves it handles what the
 * server actually sends — including the details nobody thinks to invent, like
 * `detectedName: ""` on a meal created from structured items rather than a sentence.
 */
describe('a real GET /api/meals/today payload', () => {
  const captured = {
    id: 'cc1b4c19-71a1-4304-9814-d2f954de5bdf',
    eventId: '1d49b98a-c867-4162-ae67-47adc242bbbb',
    mealType: 'breakfast',
    status: 'confirmed',
    rawInput: null,
    items: [
      {
        id: '80297aca-2ec7-4de1-87b7-4cca71f9c3c3',
        foodId: 'a206e392-b359-4d88-b6e4-179f5274f767',
        detectedName: '',
        displayNameVi: 'Cơm trắng',
        displayNameEn: 'Steamed white rice',
        quantity: 1,
        unit: 'bowl',
        gramsResolved: 150,
        portionLabel: 'medium',
        nutrition: { kcal: 195, proteinG: 4.05, carbsG: 42.3, fatG: 0.45, fiberG: 0.6 },
        source: 'local',
        confidence: 0.85,
        confidenceBand: 'confident',
        userConfirmed: false,
      },
    ],
    totals: { kcal: 195, proteinG: 4.05, carbsG: 42.3, fatG: 0.45, fiberG: 0.6 },
    confidence: 0.85,
    confidenceBand: 'confident',
    userConfirmed: false,
    userEdited: false,
    isEstimate: true,
    createdAt: '2026-09-10T01:59:30.617Z',
    unresolved: [],
    notice:
      'Nutrition figures are estimates based on typical portions — adjust anything that looks off.',
  } as unknown as Meal;

  it('renders as one breakfast card with real numbers and no invented time', () => {
    const [section] = toTimelineSections([captured]);

    expect(section).toMatchObject({ id: 'breakfast', period: 'Breakfast', timeRange: '' });
    expect(section?.events[0]).toMatchObject({
      time: '',
      title: 'Breakfast',
      description: 'Logged as individual items.',
      statusBadge: 'Confident',
      statusType: 'success',
      tags: ['Cơm trắng · 1 bowl'],
    });
    expect(section?.events[0]?.extraPill?.text).toBe(
      '195 kcal · P 4.05g · C 42.3g · F 0.45g · Fibre 0.6g',
    );
    expect(section?.events[0]?.note?.content).toContain('estimates based on typical portions');
  });

  it('drops only the energy when the same meal comes back with calories hidden', () => {
    // Byte-for-byte what the server sends once showCalories is false: the key is gone.
    const { kcal: _hidden, ...withoutKcal } = captured.totals;
    const [section] = toTimelineSections([{ ...captured, totals: withoutKcal }]);

    expect(section?.events[0]?.extraPill?.text).toBe(
      'P 4.05g · C 42.3g · F 0.45g · Fibre 0.6g',
    );
  });
});
