import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LogModal } from './index';

/**
 * The meal composer, exercised through the API calls it makes.
 *
 * `fetch` is stubbed and the real `apiRequest` runs, so what these tests assert is
 * the actual request the backend would receive — the URL, the method and the exact
 * body. That is the part that matters: the write schemas are `.strict()`, so a
 * stray field is a 400 in production, and no amount of mocking our own client
 * would catch it.
 */

vi.mock('../../lib/supabase', () => ({
  getSupabase: () => ({ auth: {} }),
  getAccessToken: async () => 'a.supabase.jwt',
}));

const fetchMock = vi.fn();
const onSaved = vi.fn();
const onClose = vi.fn();

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

const errorBody = (code: string, message: string, extra: Record<string, unknown> = {}) => ({
  error: { code, message, requestId: '01JBTEST', ...extra },
});

const RICE = {
  foodId: 'a206e392-b359-4d88-b6e4-179f5274f767',
  nameVi: 'Cơm trắng',
  nameEn: 'Steamed white rice',
  category: 'rice_grain',
  provider: 'local',
  dataQuality: 'high',
  per100g: { kcal: 130, proteinG: 2.7, carbsG: 28.2, fatG: 0.3, fiberG: 0.4 },
  matchConfidence: 0.9,
  portions: [{ id: 'p1', label: '1 bowl', labelVi: '1 chén', grams: 150, isDefault: true }],
  sourceReference: 'USDA FoodData Central',
};

/** A calculation response, with energy present. */
const calculation = (overrides: Record<string, unknown> = {}) => ({
  items: [
    {
      detectedName: '',
      foodId: RICE.foodId,
      displayNameVi: 'Cơm trắng',
      gramsResolved: 150,
      nutrition: { kcal: 195, proteinG: 4.05, carbsG: 42.3, fatG: 0.45, fiberG: 0.6 },
      source: 'local',
      confidence: 0.85,
      confidenceBand: 'confident',
      trace: 'portion row "1 bowl" → 150 g',
    },
  ],
  totals: { kcal: 195, proteinG: 4.05, carbsG: 42.3, fatG: 0.45, fiberG: 0.6 },
  unresolved: [],
  isEstimate: true,
  notice: 'Nutrition figures are estimates based on typical portions.',
  ...overrides,
});

const savedMeal = (overrides: Record<string, unknown> = {}) => ({
  id: 'meal-123',
  eventId: 'event-1',
  mealType: 'lunch',
  status: 'confirmed',
  rawInput: null,
  items: [
    {
      id: 'item-1',
      foodId: RICE.foodId,
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
  createdAt: '2026-09-10T02:00:00.000Z',
  unresolved: [],
  notice: 'Nutrition figures are estimates based on typical portions.',
  ...overrides,
});

const callsTo = (fragment: string): Array<[string, RequestInit]> =>
  fetchMock.mock.calls.filter(([url]) => String(url).includes(fragment)) as Array<
    [string, RequestInit]
  >;

const bodyOf = (call: [string, RequestInit]): unknown => JSON.parse(call[1].body as string);

const open = (props: Partial<React.ComponentProps<typeof LogModal>> = {}) =>
  render(<LogModal isOpen onClose={onClose} onSaved={onSaved} {...props} />);

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
  onSaved.mockReset();
  onClose.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Types into the search box and lets the debounce elapse. */
async function searchFor(term: string): Promise<void> {
  await userEvent.type(screen.getByLabelText(/Find a food/), term);
  await waitFor(() => expect(callsTo('/nutrition/search').length).toBeGreaterThan(0), {
    timeout: 2000,
  });
}

async function pickRice(): Promise<void> {
  await userEvent.click(screen.getByRole('button', { name: /Quick add/ }));
  fetchMock.mockImplementation(async (url: string) => {
    if (String(url).includes('/nutrition/search')) return json(200, { data: [RICE] });
    if (String(url).includes('/nutrition/calculate')) return json(200, calculation());
    return json(200, savedMeal());
  });
  await searchFor('com');
  await userEvent.click(await screen.findByRole('button', { name: /Steamed white rice/ }));
}

describe('Quick Add', () => {
  it('debounces the search into a single request', async () => {
    open();
    await userEvent.click(screen.getByRole('button', { name: /Quick add/ }));
    fetchMock.mockImplementation(async () => json(200, { data: [RICE] }));

    await userEvent.type(screen.getByLabelText(/Find a food/), 'com trang');

    await waitFor(() => expect(callsTo('/nutrition/search')).toHaveLength(1), { timeout: 2000 });
    expect(callsTo('/nutrition/search')[0]?.[0]).toContain('q=com+trang');
  });

  it('says so when nothing matched, instead of showing something', async () => {
    open();
    await userEvent.click(screen.getByRole('button', { name: /Quick add/ }));
    fetchMock.mockImplementation(async () => json(200, { data: [] }));

    await searchFor('zzz');

    expect(await screen.findByText(/No food matched/)).toBeInTheDocument();
  });

  it('turns a chosen food into an editable row', async () => {
    open();
    await pickRice();

    expect(screen.getByLabelText('Amount')).toHaveValue(1);
    // The food's default portion is a bowl, so that is where the row starts.
    expect(screen.getByLabelText('Unit')).toHaveValue('bowl');
    expect(screen.getByText(/AURA knows/)).toHaveTextContent('1 chén ≈ 150 g');
  });

  it('asks the server for the nutrition, sending only what the schema accepts', async () => {
    open();
    await pickRice();
    await userEvent.click(screen.getByRole('button', { name: /Work out the nutrition/ }));

    await waitFor(() => expect(callsTo('/nutrition/calculate')).toHaveLength(1));
    expect(bodyOf(callsTo('/nutrition/calculate')[0]!)).toEqual({
      items: [{ foodId: RICE.foodId, quantity: 1, unit: 'bowl' }],
    });
  });

  it('does not recalculate a set of items that has not changed', async () => {
    open();
    await pickRice();
    const calculate = screen.getByRole('button', { name: /Work out the nutrition/ });

    await userEvent.click(calculate);
    await waitFor(() => expect(callsTo('/nutrition/calculate')).toHaveLength(1));
    await userEvent.click(calculate);
    await userEvent.click(calculate);

    expect(callsTo('/nutrition/calculate')).toHaveLength(1);
  });

  it('ignores a slow calculation that a newer one has already superseded', async () => {
    open();
    await pickRice();

    // Two calculations, resolved out of order: the first (1 bowl) answers *after*
    // the second (3 bowls). Whichever reply lands last must not be the one on screen
    // — the review would then describe an amount the user has already moved on from.
    let releaseFirst: (() => void) | undefined;
    const firstLanded = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let call = 0;

    fetchMock.mockImplementation(async (url: string) => {
      if (!String(url).includes('/nutrition/calculate')) return json(200, { data: [RICE] });
      call += 1;
      if (call === 1) {
        await firstLanded;
        return json(200, calculation({ totals: { kcal: 195, proteinG: 4.05, carbsG: 42.3, fatG: 0.45, fiberG: 0.6 } }));
      }
      return json(200, calculation({ totals: { kcal: 585, proteinG: 12.15, carbsG: 126.9, fatG: 1.35, fiberG: 1.8 } }));
    });

    await userEvent.click(screen.getByRole('button', { name: /Work out the nutrition/ }));
    await waitFor(() => expect(callsTo('/nutrition/calculate')).toHaveLength(1));

    // The amount changes while that request is still open.
    const amount = screen.getByLabelText('Amount');
    await userEvent.clear(amount);
    await userEvent.type(amount, '3');

    await userEvent.click(screen.getByRole('button', { name: /Work out the nutrition/ }));
    await waitFor(() => expect(callsTo('/nutrition/calculate')).toHaveLength(2));
    expect(await screen.findByText(/~585 kcal/)).toBeInTheDocument();

    releaseFirst?.();
    await firstLanded;

    // The stale answer must not repaint the review.
    await waitFor(() => expect(screen.getByText(/~585 kcal/)).toBeInTheDocument());
    expect(screen.queryByText(/~195 kcal/)).not.toBeInTheDocument();
  });

  it('renders the backend figures verbatim, without rounding them', async () => {
    open();
    await pickRice();
    await userEvent.click(screen.getByRole('button', { name: /Work out the nutrition/ }));

    // 4.05 stays 4.05. An earlier draft of the adapter rounded it to 4.1.
    expect((await screen.findAllByText('4.05g')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('42.3g').length).toBeGreaterThan(0);
    expect(screen.getByText('~195 kcal')).toBeInTheDocument();
    expect(screen.getByText(/portion row "1 bowl"/)).toBeInTheDocument();
  });

  /**
   * `showCalories: false` means the server omits the key. Rendering a zero there
   * would show a fabricated number to the one person who asked not to see the real
   * one.
   */
  it('shows no energy at all when the server omitted kcal', async () => {
    open();
    await userEvent.click(screen.getByRole('button', { name: /Quick add/ }));
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).includes('/nutrition/search')) return json(200, { data: [RICE] });
      return json(
        200,
        calculation({
          items: [
            {
              ...calculation().items[0],
              nutrition: { proteinG: 4.05, carbsG: 42.3, fatG: 0.45, fiberG: 0.6 },
            },
          ],
          totals: { proteinG: 4.05, carbsG: 42.3, fatG: 0.45, fiberG: 0.6 },
        }),
      );
    });
    await searchFor('com');
    await userEvent.click(await screen.findByRole('button', { name: /Steamed white rice/ }));
    await userEvent.click(screen.getByRole('button', { name: /Work out the nutrition/ }));

    await screen.findAllByText('4.05g');
    expect(screen.queryByText(/kcal/)).not.toBeInTheDocument();
    expect(screen.queryByText('Est. Energy')).not.toBeInTheDocument();
  });

  it('keeps a null macro as unknown rather than zero', async () => {
    open();
    await userEvent.click(screen.getByRole('button', { name: /Quick add/ }));
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).includes('/nutrition/search')) return json(200, { data: [RICE] });
      return json(
        200,
        calculation({
          totals: { kcal: null, proteinG: null, carbsG: 42.3, fatG: 0.45, fiberG: 0.6 },
        }),
      );
    });
    await searchFor('com');
    await userEvent.click(await screen.findByRole('button', { name: /Steamed white rice/ }));
    await userEvent.click(screen.getByRole('button', { name: /Work out the nutrition/ }));

    const breakdown = (await screen.findByText('Mindful Breakdown')).closest('div')
      ?.parentElement as HTMLElement;
    expect(within(breakdown).getAllByText('—').length).toBeGreaterThan(0);
    expect(within(breakdown).queryByText('0g')).not.toBeInTheDocument();
  });

  it('posts the meal with exactly the items chosen and no nutrition', async () => {
    open();
    await pickRice();
    await userEvent.click(screen.getByRole('button', { name: /Work out the nutrition/ }));
    await screen.findAllByText('4.05g');

    await userEvent.click(screen.getByRole('button', { name: /Looks right/ }));

    await waitFor(() => expect(callsTo('/meals')).toHaveLength(1));
    const body = bodyOf(callsTo('/meals')[0]!) as Record<string, unknown>;
    expect(body).toEqual({
      mealType: 'lunch',
      items: [{ foodId: RICE.foodId, quantity: 1, unit: 'bowl' }],
      status: 'confirmed',
    });

    const serialised = JSON.stringify(body);
    for (const forbidden of ['kcal', 'calories', 'nutrition', 'grams', 'portionId']) {
      expect(serialised).not.toContain(forbidden);
    }
  });

  it('tells the parent exactly once, so the day reloads once', async () => {
    open();
    await pickRice();
    await userEvent.click(screen.getByRole('button', { name: /Work out the nutrition/ }));
    await screen.findAllByText('4.05g');
    await userEvent.click(screen.getByRole('button', { name: /Looks right/ }));

    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(onSaved).toHaveBeenCalledWith('meal-123');
  });

  it('shows a validation error inline, field by field', async () => {
    open();
    await pickRice();
    await userEvent.click(screen.getByRole('button', { name: /Work out the nutrition/ }));
    await screen.findAllByText('4.05g');

    fetchMock.mockImplementation(async () =>
      json(
        400,
        errorBody('VALIDATION_ERROR', 'quantity must be greater than 0', {
          details: [{ path: 'items.0.quantity', issue: 'too_small' }],
        }),
      ),
    );
    await userEvent.click(screen.getByRole('button', { name: /Looks right/ }));

    expect(await screen.findByText('quantity must be greater than 0')).toBeInTheDocument();
    expect(screen.getByText(/items.0.quantity/)).toBeInTheDocument();
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('keeps the draft when the network drops', async () => {
    open();
    await pickRice();
    await userEvent.click(screen.getByRole('button', { name: /Work out the nutrition/ }));
    await screen.findAllByText('4.05g');

    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    await userEvent.click(screen.getByRole('button', { name: /Looks right/ }));

    expect(await screen.findByText(/Could not reach the AURA server/)).toBeInTheDocument();
    // The chosen food is still on screen; nothing has to be picked again.
    expect(screen.getByLabelText('Amount')).toHaveValue(1);
    expect(onSaved).not.toHaveBeenCalled();
  });
});

describe('Describe', () => {
  const parsed = (overrides: Record<string, unknown> = {}) => ({
    meal: savedMeal({ id: 'draft-9', status: 'draft', eventId: null, rawInput: 'hai chén cơm' }),
    ambiguous: [],
    parser: 'rule-based',
    ...overrides,
  });

  async function parse(text = 'hai chén cơm'): Promise<void> {
    await userEvent.type(screen.getByLabelText('Describe your meal'), text);
    await userEvent.click(screen.getByRole('button', { name: /Let AURA read it/ }));
  }

  it('parses on the server and reviews the draft it returns', async () => {
    open();
    fetchMock.mockImplementation(async () => json(200, parsed()));
    await parse();

    await waitFor(() => expect(callsTo('/meals/parse')).toHaveLength(1));
    expect(bodyOf(callsTo('/meals/parse')[0]!)).toEqual({
      text: 'hai chén cơm',
      mealType: 'lunch',
    });
    expect((await screen.findAllByText('Cơm trắng')).length).toBeGreaterThan(0);
    expect(screen.getByText('~195 kcal')).toBeInTheDocument();
  });

  it('shows the fragments the parser could not read', async () => {
    open();
    fetchMock.mockImplementation(async () => json(200, parsed({ ambiguous: ['bánh gì đó'] })));
    await parse();

    expect(await screen.findByText(/could not read these parts/)).toBeInTheDocument();
    expect(screen.getByText('bánh gì đó')).toBeInTheDocument();
  });

  it('keeps the text when the parse fails, so it can be reworded', async () => {
    open();
    fetchMock.mockImplementation(async () =>
      json(400, errorBody('VALIDATION_ERROR', 'text: no foods could be read from that')),
    );
    await parse('qwertyuiop');

    expect(await screen.findByText(/no foods could be read/)).toBeInTheDocument();
    expect(screen.getByLabelText('Describe your meal')).toHaveValue('qwertyuiop');
  });

  it('patches the corrected amounts, then confirms', async () => {
    open();
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (String(url).includes('/meals/parse')) return json(200, parsed());
      if (init?.method === 'PATCH') return json(200, savedMeal({ id: 'draft-9', status: 'draft' }));
      return json(200, savedMeal({ id: 'draft-9' }));
    });
    await parse();
    await screen.findAllByText('Cơm trắng');

    await userEvent.clear(screen.getByLabelText('Amount'));
    await userEvent.type(screen.getByLabelText('Amount'), '2');
    await userEvent.click(screen.getByRole('button', { name: 'Update amounts' }));

    await waitFor(() => {
      const patches = fetchMock.mock.calls.filter(([, init]) => (init as RequestInit)?.method === 'PATCH');
      expect(patches).toHaveLength(1);
      expect(String(patches[0]?.[0])).toContain('/meals/draft-9');
    });

    await userEvent.click(screen.getByRole('button', { name: /Looks right/ }));
    await waitFor(() => expect(callsTo('/meals/draft-9/confirm')).toHaveLength(1));
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  /** PATCH marks a meal user-edited. An untouched draft must not claim that. */
  it('confirms without patching when nothing was changed', async () => {
    open();
    fetchMock.mockImplementation(async (url: string) =>
      String(url).includes('/meals/parse')
        ? json(200, parsed())
        : json(200, savedMeal({ id: 'draft-9' })),
    );
    await parse();
    await screen.findAllByText('Cơm trắng');

    await userEvent.click(screen.getByRole('button', { name: /Looks right/ }));

    await waitFor(() => expect(callsTo('/meals/draft-9/confirm')).toHaveLength(1));
    expect(fetchMock.mock.calls.filter(([, i]) => (i as RequestInit)?.method === 'PATCH')).toHaveLength(0);
  });

  /**
   * Each parse persists its own draft. If a slow first parse answers after a second
   * one, the composer must not adopt the abandoned draft — `confirm` would then
   * promote a meal the user never reviewed.
   */
  it('confirms the draft it is showing, not one a late parse replaced', async () => {
    open();

    let releaseFirst: (() => void) | undefined;
    const firstLanded = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let parses = 0;

    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).includes('/meals/parse')) {
        parses += 1;
        if (parses === 1) {
          await firstLanded;
          return json(200, parsed({ meal: savedMeal({ id: 'draft-STALE', status: 'draft', eventId: null }) }));
        }
        return json(200, parsed({ meal: savedMeal({ id: 'draft-FRESH', status: 'draft', eventId: null }) }));
      }
      return json(200, savedMeal({ id: 'draft-FRESH' }));
    });

    await parse('hai chén cơm');
    await waitFor(() => expect(callsTo('/meals/parse')).toHaveLength(1));

    // Reworded while the first reading is still open.
    await userEvent.type(screen.getByLabelText('Describe your meal'), ' và cá kho');
    await userEvent.click(screen.getByRole('button', { name: /Let AURA read it/ }));
    await waitFor(() => expect(callsTo('/meals/parse')).toHaveLength(2));
    await screen.findAllByText('Cơm trắng');

    releaseFirst?.();
    await firstLanded;

    await userEvent.click(screen.getByRole('button', { name: /Looks right/ }));

    await waitFor(() => expect(callsTo('/meals/draft-FRESH/confirm')).toHaveLength(1));
    expect(callsTo('/meals/draft-STALE/confirm')).toHaveLength(0);
  });

  it('reports a rate limit and does not retry it', async () => {
    open();
    fetchMock.mockImplementation(
      async () =>
        new Response(JSON.stringify(errorBody('RATE_LIMITED', 'Too many requests')), {
          status: 429,
          headers: { 'Content-Type': 'application/json', 'Retry-After': '881' },
        }),
    );
    await parse();

    expect(await screen.findByText('Too many requests. Please try again later.')).toBeInTheDocument();
    expect(callsTo('/meals/parse')).toHaveLength(1);

    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(callsTo('/meals/parse')).toHaveLength(1);
  });
});

describe('safety and regressions', () => {
  it('renders no invented calorie figure anywhere before a calculation', async () => {
    open();
    // The old modal opened on a fixture meal at 540 kcal with pre-filled macros.
    for (const invented of ['540', '510', '580', '490', '140', '95']) {
      expect(screen.queryByText(new RegExp(`${invented}\\s*kcal`))).not.toBeInTheDocument();
    }
    expect(screen.queryByText(/Est. Energy/)).not.toBeInTheDocument();
  });

  it('never sends two POSTs when Save is double-clicked', async () => {
    open();
    await pickRice();
    await userEvent.click(screen.getByRole('button', { name: /Work out the nutrition/ }));
    await screen.findAllByText('4.05g');

    const save = screen.getByRole('button', { name: /Looks right/ });
    await userEvent.click(save);
    await userEvent.click(save);
    await userEvent.click(save);

    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(callsTo('/meals')).toHaveLength(1);
  });

  it('sends one parse under StrictMode, not two', async () => {
    fetchMock.mockImplementation(async () =>
      json(200, { meal: savedMeal({ id: 'draft-9', status: 'draft' }), ambiguous: [], parser: 'rule-based' }),
    );
    render(
      <React.StrictMode>
        <LogModal isOpen onClose={onClose} onSaved={onSaved} />
      </React.StrictMode>,
    );

    await userEvent.type(screen.getByLabelText('Describe your meal'), 'cơm');
    await userEvent.click(screen.getByRole('button', { name: /Let AURA read it/ }));

    await waitFor(() => expect(callsTo('/meals/parse')).toHaveLength(1));
  });

  it('surfaces a 401 without signing anyone out', async () => {
    open();
    fetchMock.mockImplementation(async () =>
      json(401, errorBody('UNAUTHENTICATED', 'Authentication required')),
    );
    await userEvent.type(screen.getByLabelText('Describe your meal'), 'cơm');
    await userEvent.click(screen.getByRole('button', { name: /Let AURA read it/ }));

    expect(await screen.findByText('Authentication required')).toBeInTheDocument();
    // Nothing here calls signOut — AuthProvider owns the session.
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('offers no way to submit a photo', async () => {
    open();
    await userEvent.click(screen.getByRole('button', { name: /Take a photo/ }));

    expect(await screen.findByText(/Photo logging is coming soon/)).toBeInTheDocument();
    expect(document.querySelector('input[type="file"]')).toBeNull();
    expect(screen.queryByRole('button', { name: /Looks right/ })).not.toBeInTheDocument();
  });

  it('disables every category that has no backend behind it', async () => {
    open();
    for (const label of ['I worked out', 'I walked', 'I drank water', 'I slept', 'Check-in']) {
      expect(screen.getByRole('button', { name: new RegExp(label) })).toBeDisabled();
    }
    expect(screen.getByRole('button', { name: /I ate/ })).toBeEnabled();
  });

  it('renders nothing at all when closed', () => {
    const { container } = render(
      <LogModal isOpen={false} onClose={onClose} onSaved={onSaved} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  /**
   * The old modal called ten `useState`s after an early `return null`, so opening it
   * changed the hook count from 0 to 10 and React threw. The wrapper now calls no
   * hooks, so toggling `isOpen` on a mounted instance is just a mount.
   */
  it('survives being opened after being rendered closed', async () => {
    const { rerender } = render(
      <LogModal isOpen={false} onClose={onClose} onSaved={onSaved} />,
    );
    rerender(<LogModal isOpen onClose={onClose} onSaved={onSaved} />);

    expect(await screen.findByText('What happened?')).toBeInTheDocument();
  });
});
