import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthState } from '../auth/AuthProvider';
import type { TodayMealsState } from '../hooks/useTodayMeals';
import type { Loadable, TodayPlanState } from '../hooks/useTodayPlan';
import { ApiError, type DayEvent, type PlanComparison } from '../lib/api';
import { TodayView } from './TodayView';

/**
 * TodayView renders what the hooks hand it — and, now that the plan and the day's
 * events come from the API, none of the prototype's fixed figures.
 */

const profile = vi.hoisted(() => ({ displayName: 'Minh' as string | null }));

vi.mock('../auth/AuthProvider', () => ({
  useAuth: (): AuthState =>
    ({
      status: 'signed-in',
      user: { id: 'user-1', displayName: profile.displayName, timezone: 'Asia/Ho_Chi_Minh', streakDays: 3 },
    }) as unknown as AuthState,
}));

// The check-in card reads `GET /api/checkins` through the real API client; answer it
// with an empty history so these plan and timeline tests never touch the network.
vi.mock('../lib/supabase', () => ({
  getSupabase: () => ({ auth: {} }),
  getAccessToken: async () => 'a.supabase.jwt',
}));

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify({ data: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } })),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const meals = (overrides: Partial<TodayMealsState> = {}): TodayMealsState => ({
  status: 'success',
  sections: [],
  error: null,
  reload: vi.fn(),
  ...overrides,
});

const ok = <T,>(data: T): Loadable<T> => ({ status: 'success', data, error: null });

const withPlan = (items: PlanComparison['items'], adherencePct: number | null): PlanComparison =>
  ({ localDate: '2026-09-18', adherencePct, items, unplanned: [] }) as PlanComparison;

const plan = (overrides: Partial<TodayPlanState> = {}): TodayPlanState => ({
  plan: ok<PlanComparison | null>(null),
  events: ok<DayEvent[]>([]),
  reload: vi.fn(),
  ...overrides,
});

const view = (props: { today?: TodayMealsState; plan?: TodayPlanState } = {}) =>
  render(
    <TodayView
      today={props.today ?? meals()}
      plan={props.plan ?? plan()}
      onOpenLogModal={vi.fn()}
      onSelectMood={vi.fn()}
      selectedMood="good"
    />,
  );

describe('TodayView', () => {
  it('shows none of the prototype fixtures', () => {
    view();
    for (const fixture of [
      'Hey Thanh',
      'Friday, September 4',
      '16:45 PM',
      '72%',
      'Balance On Track',
      '3 things done',
      'Gym at 18:00',
      'Walked for 40 minutes at 18:30',
      'AURA Reflection',
      'Harmonious rhythm',
    ]) {
      expect(screen.queryByText(fixture, { exact: false }), fixture).not.toBeInTheDocument();
    }
  });

  it('greets by the profile name, and plainly when there is none', () => {
    const { unmount } = view();
    expect(screen.getByText('Hey Minh 👋')).toBeInTheDocument();
    unmount();

    profile.displayName = null;
    view();
    expect(screen.getByText('Hey there 👋')).toBeInTheDocument();
    profile.displayName = 'Minh';
  });

  it('says there is no plan, and shows no percentage', () => {
    view();
    expect(screen.getByText(/No plan for today yet/)).toBeInTheDocument();
    expect(screen.getByText(/nothing to compare yet/)).toBeInTheDocument();
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('renders the server comparison: counts, percentage and the spotlight', () => {
    view({
      plan: plan({
        plan: ok<PlanComparison | null>(
          withPlan(
            [
              {
                planItemId: 'a',
                planned: { title: 'Gym', time: '18:00', type: 'workout', durationMin: 60 },
                actual: { id: 'e1', title: 'Walk', time: '18:30', type: 'walk', durationMin: 40 },
                adherence: 'shifted',
                shiftMinutes: 30,
              },
              {
                planItemId: 'b',
                planned: { title: 'Dinner', time: '19:30', type: 'meal', durationMin: null },
                actual: null,
                adherence: 'pending',
                shiftMinutes: null,
              },
            ] as PlanComparison['items'],
            100,
          ),
        ),
      }),
    });

    expect(screen.getByText('1 of 2 planned things done so far.')).toBeInTheDocument();
    expect(screen.getByText('100%')).toBeInTheDocument();
    expect(screen.getByText(/0 things done/)).toBeInTheDocument();
    expect(screen.getByText(/1 changed/)).toBeInTheDocument();
    expect(screen.getByText(/1 upcoming/)).toBeInTheDocument();
    expect(screen.getByText('Shifted 30 min')).toBeInTheDocument();
    expect(screen.getByText('Gym at 18:00')).toBeInTheDocument();
    expect(screen.getByText('Walk at 18:30')).toBeInTheDocument();
  });

  it('lists the day\'s other events at their real time', () => {
    view({
      plan: plan({
        events: ok<DayEvent[]>([
          { id: 'e1', type: 'walk', occurredAt: '2026-09-18T11:30:00.000Z', title: 'Evening walk', durationMin: 40, note: null } as DayEvent,
        ]),
      }),
    });
    expect(screen.getByText('Other moments')).toBeInTheDocument();
    expect(screen.getByText('18:30')).toBeInTheDocument();
    expect(screen.getByText('🚶 Evening walk')).toBeInTheDocument();
    expect(screen.queryByText('Nothing logged yet today.')).not.toBeInTheDocument();
  });

  it('shows a plan failure with its request id and a retry, not fixture content', async () => {
    const reload = vi.fn();
    view({
      plan: plan({
        plan: { status: 'error', data: null, error: new ApiError('Boom', 500, 'INTERNAL_ERROR', { requestId: '01REQ' }) },
        reload,
      }),
    });
    expect(screen.getByText("Could not load today's plan.")).toBeInTheDocument();
    expect(screen.getByText('Request 01REQ')).toBeInTheDocument();
    await userEvent.click(screen.getAllByRole('button', { name: 'Try again' })[0]!);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('waits for both reads before calling the day empty', () => {
    const { unmount } = view({ plan: plan({ events: { status: 'loading', data: [], error: null } }) });
    expect(screen.queryByText('Nothing logged yet today.')).not.toBeInTheDocument();
    expect(screen.getByText('Syncing…')).toBeInTheDocument();
    unmount();

    view();
    expect(screen.getByText('Nothing logged yet today.')).toBeInTheDocument();
  });
});
