import { describe, expect, it } from 'vitest';
import { earlierStreakFact, insufficientWeek, patternFacts, streakFact, sufficientWeek } from '../test/weekly';
import {
  LIMITATION_LABEL,
  comparisonLines,
  dayCells,
  formatRate,
  formatSleep,
  formatWait,
  formatWeekRange,
  PATTERN_FACTS_LANGUAGE,
  STREAK_WINDOW_DAYS,
  insightsLanguage,
  patternFactsView,
  statCards,
  weekProgress,
} from './insights';

describe('period', () => {
  it("shows the backend's own week, whatever the browser timezone", () => {
    expect(formatWeekRange({ weekStart: '2026-09-28', weekEnd: '2026-10-04' })).toBe('Sep 28 – Oct 4');
    expect(weekProgress(sufficientWeek().period)).toBe('Day 4 of 7');
    expect(weekProgress({ ...sufficientWeek().period, isComplete: true, daysElapsed: 7 })).toBe('Complete week');
  });
});

describe('number formatting', () => {
  it('keeps null as no-data and a real zero as zero', () => {
    expect(formatRate(null)).toBeNull();
    expect(formatRate(0)).toBe('0%');
    expect(formatRate(0.666)).toBe('67%');
    expect(formatSleep(null)).toBeNull();
    expect(formatSleep(425)).toBe('7h 05m');
    expect(formatSleep(40)).toBe('40m');
  });

  it('turns a Retry-After into words, and nothing into nothing', () => {
    expect(formatWait(undefined)).toBeNull();
    expect(formatWait(90)).toBe('2 min');
    expect(formatWait(3 * 3600 + 5)).toBe('4 h');
  });
});

describe('statCards', () => {
  it("shows the backend's figures as they came", () => {
    const cards = Object.fromEntries(statCards(sufficientWeek()).map((card) => [card.label, card]));
    expect(cards['Movement']).toMatchObject({ value: '2 days active', detail: '1 walk · 1 workout done' });
    expect(cards['Meals Logged']).toMatchObject({ value: '5 logged', detail: 'On 3 of 4 days' });
    expect(cards['Plan Adherence']).toMatchObject({ value: '67%', detail: '2 of 3 planned items happened' });
    expect(cards['Sleep Rest']).toMatchObject({ value: null, detail: 'No sleep logged' });
  });

  it('never turns a section with no data into a zero', () => {
    const cards = statCards(insufficientWeek());
    expect(cards.map((card) => card.value)).toEqual([null, null, null, null]);
    for (const card of cards) expect(card.detail).not.toMatch(/\b0\b/);
  });
});

describe('comparisonLines', () => {
  it("words the backend's delta and direction, and leaves out what it could not compare", () => {
    expect(comparisonLines(sufficientWeek().comparison)).toEqual([
      'Days with any log: 75%, up 18 points from last week',
    ]);
  });

  it('says "about the same" only when the backend called it flat', () => {
    const lines = comparisonLines({
      previousWeekStart: '2026-09-14',
      status: 'available',
      metrics: [{ metric: 'habit_completion', status: 'available', current: 0.5, previous: 0.45, delta: 0.05, direction: 'flat' }],
    });
    expect(lines).toEqual(['Habit completion: 50%, about the same as last week']);
  });

  it('has nothing to say when nothing could be compared', () => {
    expect(comparisonLines(insufficientWeek().comparison)).toEqual([]);
  });
});

describe('dayCells', () => {
  it('keeps "not logged" apart from "not yet"', () => {
    expect(dayCells(sufficientWeek()).map((d) => `${d.weekday}:${d.state}`)).toEqual([
      'Mon:logged',
      'Tue:not_logged',
      'Wed:logged',
      'Thu:logged',
      'Fri:upcoming',
      'Sat:upcoming',
      'Sun:upcoming',
    ]);
  });
});

describe('LIMITATION_LABEL', () => {
  it('words every limitation code the contract defines, without blame', () => {
    for (const label of Object.values(LIMITATION_LABEL)) {
      expect(label).not.toMatch(/fail|should|must|bad/i);
    }
  });
});

describe('patternFactsView', () => {
  it('reads Vietnamese only for a profile that asks for it', () => {
    expect(insightsLanguage('vi')).toBe('vi');
    expect(insightsLanguage('en')).toBe('en');
    expect(insightsLanguage(undefined)).toBe('en');
    expect(insightsLanguage('fr')).toBe('en');
  });

  it('shows the card in English by default, whatever the profile locale', () => {
    expect(PATTERN_FACTS_LANGUAGE).toBe('en');
    expect(patternFactsView(patternFacts('available'))).toEqual(patternFactsView(patternFacts('available'), 'en'));
    expect(patternFactsView(patternFacts('none'))).toEqual(patternFactsView(patternFacts('none'), 'en'));
    expect(patternFactsView(undefined).message).toBe('This information is not available right now.');
  });

  it('names the observation window in the empty state, not the week on screen', () => {
    expect(STREAK_WINDOW_DAYS).toBe(45);
    const { message } = patternFactsView(patternFacts('none'), 'en');
    expect(message).toContain(`last ${STREAK_WINDOW_DAYS} days`);
    expect(message).not.toMatch(/week|period|yet|at least|minimum|\b3\b|\b30\b/i);
  });

  it("uses a fact's own windowDays, not the constant", () => {
    const [line] = patternFactsView(patternFacts('available', streakFact({ windowDays: 60, observedDays: 40 })), 'en').items;
    expect(line).toMatchObject({
      scope: 'Your longest run in the last 60 days',
      observed: 'Something was logged on 40 of the last 60 days.',
    });
  });

  it('says "not available" for unavailable — never that there is no streak', () => {
    const view = patternFactsView(patternFacts('unavailable'), 'en');
    expect(view).toMatchObject({
      state: 'unavailable',
      heading: 'Logging consistency',
      message: 'This information is not available right now.',
      items: [],
    });
    expect(view.message).not.toMatch(/no (run|streak)/i);
  });

  it('treats a report with no patternFacts section as unavailable', () => {
    expect(patternFactsView(undefined, 'en').state).toBe('unavailable');
    expect(patternFactsView(null, 'vi')).toMatchObject({
      state: 'unavailable',
      message: 'Thông tin này hiện chưa khả dụng.',
    });
  });

  it('does not read "available" with nothing in it as an absence of streaks', () => {
    expect(patternFactsView({ status: 'available', items: [] }, 'en').state).toBe('unavailable');
  });

  it('gives none its own neutral wording, in both languages', () => {
    const en = patternFactsView(patternFacts('none'), 'en');
    const vi = patternFactsView(patternFacts('none'), 'vi');
    expect(en).toMatchObject({ state: 'none', message: 'No qualifying logging streak was found in the last 45 days.' });
    expect(vi).toMatchObject({
      state: 'none',
      heading: 'Tính đều đặn khi ghi nhận',
      message: 'Không tìm thấy chuỗi ngày ghi nhận đủ điều kiện trong 45 ngày gần nhất.',
    });
    for (const text of [en.message, vi.message]) {
      expect(text).not.toMatch(/fail|should|must|bad|missed|broke|thất bại|bỏ lỡ/i);
    }
  });

  it("shows a current run with the backend's dates, length and counts", () => {
    const view = patternFactsView(patternFacts('available'), 'en');
    expect(view).toMatchObject({ state: 'available', heading: 'Logging consistency', message: null });
    expect(view.items).toEqual([
      {
        id: streakFact().id,
        runLength: '12 days in a row',
        range: 'Sep 12 – Sep 23',
        scope: 'Your longest run in the last 45 days',
        current: true,
        status: 'This run is still going.',
        observed: 'Something was logged on 32 of the last 45 days.',
        caveat: 'This counts days you logged something, not what you did.',
      },
    ]);
  });

  it('shows an earlier longest run as over, on the day the backend says it ended', () => {
    const [line] = patternFactsView(patternFacts('available', earlierStreakFact()), 'en').items;
    expect(line).toMatchObject({
      runLength: '12 days in a row',
      range: 'Aug 20 – Aug 31',
      current: false,
      status: 'This run ended on Aug 31.',
    });
  });

  it("takes the run from the API's own fields, not from the surrounding figures", () => {
    // sampleSize, strength and the window dates disagree with the run on purpose.
    const fact = streakFact({
      run: { from: '2026-09-01', to: '2026-09-05', length: 5 },
      sampleSize: 99,
      strength: 1,
      observedDays: 30,
      current: false,
    });
    const [line] = patternFactsView(patternFacts('available', fact), 'en').items;
    expect(line).toMatchObject({
      runLength: '5 days in a row',
      range: 'Sep 1 – Sep 5',
      status: 'This run ended on Sep 5.',
      observed: 'Something was logged on 30 of the last 45 days.',
    });
  });

  it('localises the label, the caveat and the dates for Vietnamese', () => {
    const view = patternFactsView(patternFacts('available'), 'vi');
    expect(view.heading).toBe('Tính đều đặn khi ghi nhận');
    expect(view.source).toBe('Đếm từ nhật ký của bạn');
    expect(view.items[0]).toMatchObject({
      runLength: '12 ngày liên tiếp',
      range: '12 thg 9 – 23 thg 9',
      scope: 'Chuỗi dài nhất của bạn trong 45 ngày gần nhất',
      status: 'Chuỗi này vẫn đang tiếp diễn.',
      observed: 'Bạn có ghi nhận vào 32 trong 45 ngày gần nhất.',
      caveat: 'Chỉ tính những ngày bạn có ghi nhận dữ liệu, không phản ánh bạn đã làm gì trong những ngày đó.',
    });
    expect(patternFactsView(patternFacts('available', earlierStreakFact()), 'vi').items[0]!.status).toBe(
      'Chuỗi này kết thúc vào 31 thg 8.',
    );
  });

  it('adds no caveat the backend did not send, and falls back to its text for an unknown key', () => {
    expect(patternFactsView(patternFacts('available', streakFact({ caveat: null })), 'vi').items[0]!.caveat).toBeNull();
    const unknown = streakFact({ key: 'streak:something_else', subjectLabel: 'Another count', caveat: 'Server text.' });
    const view = patternFactsView(patternFacts('available', unknown), 'vi');
    expect(view.heading).toBe('Another count');
    expect(view.items[0]!.caveat).toBe('Server text.');
  });

  it('never words the streak as a pattern, a cause or a prediction', () => {
    for (const language of ['en', 'vi'] as const) {
      for (const fact of [streakFact(), earlierStreakFact()]) {
        const view = patternFactsView(patternFacts('available', fact), language);
        const text = [
          view.heading,
          view.source,
          ...view.items.flatMap((item) => [item.runLength, item.scope, item.status, item.observed]),
        ].join(' ');
        expect(text).not.toMatch(/correlat|associat|caus|predict|likely|because|tương quan|nguyên nhân|dự đoán/i);
      }
    }
  });
});
