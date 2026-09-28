import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { useCheckin } from '../hooks/useCheckin';
import { ApiError, DAY_TAGS, NetworkError, type DayTag } from '../lib/api';
import {
  DAY_TAG_LABEL,
  findTodaysCheckin,
  formFromCheckin,
  isMood,
  sameForm,
  toCheckinInput,
  type CheckinForm,
} from '../lib/checkin';
import {
  eventsToSection,
  formatClock,
  formatDayHeading,
  greetingName,
  pickSpotlight,
  planHeadline,
  summarisePlan,
} from '../lib/today';
import type { TodayMealsState } from '../hooks/useTodayMeals';
import type { TodayPlanState } from '../hooks/useTodayPlan';

/**
 * The request id, when the failure came back from the server rather than from a dead
 * socket. Quoting it lets a support conversation find the exact request in the log.
 */
function requestIdOf(error: ApiError | NetworkError | null): string | undefined {
  return error instanceof ApiError ? error.requestId : undefined;
}

/** Badge colours, reused from the timeline's own badge palette. */
const TONE_CLASS = {
  success: 'bg-[#adedd0] text-[#306d56]',
  neutral: 'bg-[#eee7e1] text-[#56423b]',
  warning: 'bg-[#ffdad6] text-[#93000a]',
} as const;

interface TodayViewProps {
  /** Today's Story: meals, from `GET /api/meals/today`. */
  today: TodayMealsState;
  /** The plan comparison and the day's other events, from the API. */
  plan: TodayPlanState;
  onOpenLogModal: (initialPrompt?: string) => void;
  onSelectMood: (mood: string) => void;
  selectedMood: string;
}

export const TodayView: React.FC<TodayViewProps> = ({
  today,
  plan,
  onOpenLogModal,
  onSelectMood,
  selectedMood,
}) => {
  const { user } = useAuth();
  const timeZone = user?.timezone ?? undefined;
  const name = greetingName(user);

  const comparison = plan.plan.status === 'success' ? plan.plan.data : null;
  const summary = comparison ? summarisePlan(comparison) : null;
  const spotlight = pickSpotlight(comparison);
  const moments =
    plan.events.status === 'success' ? eventsToSection(plan.events.data, timeZone) : null;
  const sections = moments ? [...today.sections, moments] : today.sections;

  // When the day was last read from the server — the only honest time to print beside
  // "synced". Recomputed on each successful load, never ticking on its own.
  const syncedAt = useMemo(
    () => (plan.events.status === 'success' ? new Date() : null),
    [plan.events.status, plan.events.data],
  );
  const dayHeading = formatDayHeading(syncedAt ?? new Date(), timeZone);
  const ringPct = summary?.adherencePct ?? null;

  const [selectedTag, setSelectedTag] = useState<DayTag | null>('normal');
  const [showNoteInput, setShowNoteInput] = useState(false);
  const [checkInNote, setCheckInNote] = useState('');

  // ── Check-in: persisted through `POST /api/checkins`, never assumed ───────────
  // A successful save reloads today's events, which is how the check-in reaches
  // "Other moments" — the server's event, through the same read as every other one.
  const checkin = useCheckin({ onSaved: plan.reload });

  /** What the server holds for today: the last save, else today's from the recent list. */
  const fromServer =
    checkin.recent.status === 'success' && plan.events.status === 'success'
      ? findTodaysCheckin(checkin.recent.data, plan.events.data)
      : null;
  const savedCheckin = checkin.lastSaved ?? fromServer;
  const savedForm = savedCheckin ? formFromCheckin(savedCheckin) : null;

  const form: CheckinForm | null = isMood(selectedMood)
    ? { mood: selectedMood, dayTag: selectedTag, note: checkInNote }
    : null;
  const dirty = !savedForm || !form || !sameForm(form, savedForm);
  const saving = checkin.saveStatus === 'saving';

  /**
   * Show today's saved answer once, unless the person has already started changing it.
   * Without this a reload would show the defaults as "not saved" — and since the server
   * clears any field a save leaves out, saving them would erase this morning's note.
   */
  const touched = useRef(false);
  const prefilled = useRef(false);
  useEffect(() => {
    if (!fromServer || prefilled.current || touched.current) return;
    prefilled.current = true;
    const saved = formFromCheckin(fromServer);
    onSelectMood(saved.mood);
    setSelectedTag(saved.dayTag);
    setCheckInNote(saved.note);
  }, [fromServer, onSelectMood]);

  const handleSaveCheckin = async () => {
    if (!form || saving) return;
    const saved = await checkin.save(toCheckinInput(form));
    if (saved) setShowNoteInput(false);
  };

  const status = saving
    ? { text: 'Saving…', className: 'text-[#8a726a]' }
    : checkin.saveStatus === 'error'
      ? { text: "Couldn't save", className: 'text-[#93000a]' }
      : !dirty
        ? { text: 'Saved', className: 'text-[#2b6952]' }
        : savedCheckin
          ? { text: 'Unsaved changes', className: 'text-[#9f4118]' }
          : { text: 'Not saved yet', className: 'text-[#8a726a]' };

  const moodOptions = [
    { id: 'low', emoji: '🥱', label: 'Low energy' },
    { id: 'okay', emoji: '😐', label: 'Okay' },
    { id: 'good', emoji: '🙂', label: 'Good' },
    { id: 'great', emoji: '✨', label: 'Great' },
  ];


  return (
    <div className="w-full max-w-4xl mx-auto px-4 py-8 space-y-8 animate-in fade-in duration-300">
      {/* Top Header & Body Clock sync */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs font-bold text-[#9f4118] uppercase tracking-wider">
            <span>Daily Rhythm</span>
            <span>•</span>
            <span className="text-[#56423b] font-medium">{dayHeading}</span>
          </div>
          <h1 className="text-3xl sm:text-4xl font-extrabold text-[#1e1b17] tracking-tight mt-1">
            {name ? `Hey ${name} 👋` : 'Hey there 👋'}
          </h1>
        </div>
        <div className="flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-[#faf2ec] border border-[#eee7e1] text-xs font-semibold text-[#56423b] self-start sm:self-center shadow-xs">
          <span className="w-2 h-2 rounded-full bg-[#2b6952] animate-pulse" />
          <span>
            {syncedAt
              ? `Synced with body clock · ${formatClock(syncedAt, timeZone)}`
              : plan.events.status === 'error'
                ? 'Not synced'
                : 'Syncing…'}
          </span>
        </div>
      </div>

      {/* Hero Card: Today • Gentle Flow */}
      <div className="bg-gradient-to-br from-[#faf2ec] via-white to-[#ffdbce]/20 rounded-3xl p-6 sm:p-8 border border-[#eee7e1] shadow-[0_12px_36px_-8px_rgba(45,42,38,0.06)] relative overflow-hidden">
        <div className="flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="flex-1 space-y-3">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold uppercase tracking-wider text-[#9f4118]">
                Today • Gentle Flow
              </span>
              {/* The prototype's "Balance On Track" badge judged the day; nothing in the
                  API makes that judgement, so no badge is shown in its place. */}
            </div>

            {plan.plan.status === 'loading' && (
              <p className="text-base sm:text-lg text-[#8a726a] font-medium leading-relaxed">
                Gathering today's plan…
              </p>
            )}

            {plan.plan.status === 'error' && (
              <div className="space-y-2">
                <p className="text-base sm:text-lg text-[#1e1b17] font-medium leading-relaxed">
                  Could not load today's plan.
                </p>
                <p className="text-xs text-[#56423b]">{plan.plan.error?.message}</p>
                {requestIdOf(plan.plan.error) && (
                  <p className="text-[10px] text-[#bda99f] font-mono break-all">
                    Request {requestIdOf(plan.plan.error)}
                  </p>
                )}
                <button
                  type="button"
                  onClick={plan.reload}
                  className="px-4 py-1.5 rounded-full bg-[#ff8a5b] text-white text-xs font-bold hover:bg-[#f5763f] transition-colors"
                >
                  Try again
                </button>
              </div>
            )}

            {plan.plan.status === 'success' && (
              <>
                <p className="text-base sm:text-lg text-[#1e1b17] font-medium leading-relaxed">
                  {planHeadline(summary)}
                </p>
                {summary && summary.total > 0 && (
                  <div className="flex flex-wrap items-center gap-2 pt-1 text-xs text-[#56423b]">
                    <span className="px-2.5 py-1 bg-white rounded-full border border-[#eee7e1] font-semibold text-[#1e1b17]">
                      ✓ {summary.done} {summary.done === 1 ? 'thing' : 'things'} done
                    </span>
                    <span className="px-2.5 py-1 bg-[#ffdbce]/60 rounded-full border border-[#ffdbce] font-semibold text-[#7f2b01]">
                      ⚡ {summary.changed} changed
                    </span>
                    <span className="px-2.5 py-1 bg-[#faf2ec] rounded-full border border-[#eee7e1] font-semibold">
                      ⏳ {summary.upcoming} upcoming
                    </span>
                  </div>
                )}
              </>
            )}
          </div>

          {/* Adherence ring — the server's percentage, or a dash while there is none */}
          <div className="flex flex-col items-center justify-center relative flex-shrink-0">
            <div className="relative w-28 h-28 flex items-center justify-center">
              <svg className="w-full h-full transform -rotate-90" viewBox="0 0 100 100">
                <circle
                  cx="50"
                  cy="50"
                  r="42"
                  stroke="#eee7e1"
                  strokeWidth="8"
                  fill="transparent"
                />
                <circle
                  cx="50"
                  cy="50"
                  r="42"
                  stroke="#9f4118"
                  strokeWidth="8"
                  strokeDasharray="264"
                  strokeDashoffset={264 - (264 * (ringPct ?? 0)) / 100}
                  strokeLinecap="round"
                  fill="transparent"
                  className="transition-all duration-1000 ease-out"
                />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
                <span className="text-2xl font-black text-[#1e1b17] leading-none">
                  {ringPct === null ? '—' : `${ringPct}%`}
                </span>
                <span className="text-[10px] font-bold text-[#8a726a] uppercase tracking-wider mt-0.5">
                  Flow
                </span>
              </div>
            </div>
            <span className="text-[11px] text-[#56423b] mt-2 font-medium">
              {plan.plan.status !== 'success'
                ? ''
                : ringPct !== null
                  ? 'Plan followed so far'
                  : summary && summary.total > 0
                    ? 'Nothing due yet'
                    : 'No plan to follow'}
            </span>
          </div>
        </div>

        {/* Inspirational quote foot */}
        <div className="mt-6 pt-4 border-t border-[#eee7e1]/80 flex items-center gap-2 text-xs text-[#56423b] italic">
          <span>“You don't have to live perfectly. Just tell AURA what actually happened.”</span>
        </div>
      </div>

      {/* < 20 SEC CHECK-IN */}
      <div className="bg-white rounded-3xl p-6 border border-[#eee7e1] shadow-xs space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="w-6 h-6 rounded-full bg-[#ffdbce] text-[#7f2b01] flex items-center justify-center text-xs font-bold">
              ⚡
            </span>
            <h2 className="text-base font-bold text-[#1e1b17]">&lt; 20 SEC CHECK-IN</h2>
          </div>
          {/* Only claims "Saved" once the server has answered with the saved check-in. */}
          <div className="flex items-center gap-2">
            <span className={`text-xs font-semibold ${status.className}`} role="status">
              {status.text}
            </span>
            <button
              type="button"
              onClick={handleSaveCheckin}
              disabled={!form || saving || !dirty}
              className="px-4 py-1 rounded-full text-xs font-bold bg-[#9f4118] text-white disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {saving ? 'Saving…' : checkin.saveStatus === 'error' ? 'Try again' : 'Save check-in'}
            </button>
          </div>
        </div>

        {/* Mood Selection Buttons */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
          {moodOptions.map((mood) => {
            const isSelected = selectedMood === mood.id;
            return (
              <button
                key={mood.id}
                onClick={() => {
                  touched.current = true;
                  onSelectMood(mood.id);
                }}
                aria-pressed={isSelected}
                className={`p-3 rounded-2xl border text-center transition-all duration-200 flex flex-col items-center gap-1.5 ${
                  isSelected
                    ? 'bg-[#ffdbce]/50 border-[#ff8a5b] text-[#7f2b01] shadow-xs scale-[1.02]'
                    : 'bg-[#faf2ec] border-transparent hover:border-[#eee7e1] text-[#56423b]'
                }`}
                type="button"
              >
                <span className="text-2xl">{mood.emoji}</span>
                <span className="text-xs font-bold">{mood.label}</span>
              </button>
            );
          })}
        </div>

        {/* Tag pills */}
        <div className="flex flex-wrap items-center gap-2 pt-1">
          {DAY_TAGS.map((tag) => {
            const isSelected = selectedTag === tag;
            return (
              <button
                key={tag}
                onClick={() => {
                  touched.current = true;
                  setSelectedTag(tag);
                }}
                aria-pressed={isSelected}
                className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-all ${
                  isSelected
                    ? 'bg-[#1e1b17] text-white'
                    : 'bg-[#faf2ec] text-[#56423b] hover:bg-[#eee7e1]'
                }`}
                type="button"
              >
                {DAY_TAG_LABEL[tag]}
              </button>
            );
          })}
          <button
            onClick={() => setShowNoteInput(!showNoteInput)}
            className="px-3 py-1.5 rounded-full text-xs font-semibold bg-white border border-[#eee7e1] text-[#9f4118] hover:bg-[#faf2ec] transition-colors"
            type="button"
          >
            + Add a note
          </button>
        </div>

        {/* A failed save keeps every selection and the note as they were. */}
        {checkin.saveStatus === 'error' && (
          <div className="px-3 py-2 rounded-2xl bg-[#ffdad6]/40 border border-[#ffdad6] text-xs text-[#93000a]">
            <p>Your check-in was not saved. {checkin.saveError?.message}</p>
            {requestIdOf(checkin.saveError) && (
              <p className="text-[10px] text-[#bda99f] font-mono break-all mt-0.5">
                Request {requestIdOf(checkin.saveError)}
              </p>
            )}
          </div>
        )}

        {/* Expandable note input */}
        {showNoteInput && (
          <div className="p-3 bg-[#faf2ec] rounded-2xl border border-[#eee7e1] space-y-2 animate-in fade-in duration-150">
            <textarea
              placeholder="How are you feeling right now? Anything mindful on your mind?"
              value={checkInNote}
              onChange={(e) => {
                touched.current = true;
                setCheckInNote(e.target.value);
              }}
              // The contract's limit, so an over-long note is stopped here, not by a 400.
              maxLength={1000}
              className="w-full bg-white rounded-xl p-2.5 text-xs text-[#1e1b17] border border-[#eee7e1] focus:outline-none"
              rows={2}
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowNoteInput(false)}
                className="px-3 py-1 rounded-full text-xs text-[#56423b]"
              >
                Cancel
              </button>
              {/* The same save as the header button: the whole check-in, note included. */}
              <button
                type="button"
                onClick={handleSaveCheckin}
                disabled={!form || saving || !dirty}
                className="px-4 py-1 rounded-full text-xs font-bold bg-[#9f4118] text-white disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {saving ? 'Saving…' : !dirty ? 'Saved ✓' : 'Save Reflection'}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Plan vs. Actual Spotlight */}
      <div className="bg-gradient-to-r from-[#faf2ec] via-white to-[#faf2ec] rounded-3xl p-6 border border-[#eee7e1] shadow-xs space-y-4">
        <div className="flex items-center justify-between">
          <span className="text-xs font-bold uppercase tracking-wider text-[#9f4118]">
            Plan vs. Actual Spotlight
          </span>
          {spotlight && (
            <span className={`px-2 py-0.5 rounded-full text-[11px] font-bold ${TONE_CLASS[spotlight.tone]}`}>
              {spotlight.label}
            </span>
          )}
        </div>

        {plan.plan.status === 'loading' && (
          <p className="text-xs text-[#bda99f] font-medium">Comparing your plan with today…</p>
        )}

        {plan.plan.status === 'error' && (
          <p className="text-xs text-[#56423b]">
            The comparison is unavailable until today's plan loads.
          </p>
        )}

        {plan.plan.status === 'success' && !spotlight && (
          <p className="text-xs text-[#56423b] leading-relaxed">
            {comparison
              ? 'Your plan has no items to compare yet.'
              : 'No plan for today, so there is nothing to compare yet.'}
          </p>
        )}

        {spotlight && (
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4 p-4 rounded-2xl bg-[#fff8f3] border border-[#ffdbce]/60">
            <div className="flex-1">
              <span className="text-[11px] font-bold text-[#8a726a] uppercase">Planned</span>
              <p className="text-sm font-bold text-[#1e1b17] mt-0.5">
                {spotlight.planned.title} at {spotlight.planned.time}
              </p>
            </div>
            <div className="w-8 h-8 rounded-full bg-[#ffdbce] text-[#7f2b01] flex items-center justify-center self-center flex-shrink-0">
              <span className="material-symbols-outlined text-[18px]">arrow_forward</span>
            </div>
            <div className="flex-1">
              <span className="text-[11px] font-bold text-[#2b6952] uppercase">What actually happened</span>
              <p className="text-sm font-bold text-[#1e1b17] mt-0.5">
                {spotlight.actual
                  ? `${spotlight.actual.title} at ${spotlight.actual.time}`
                  : 'Nothing logged for it yet'}
              </p>
            </div>
          </div>
        )}

        {/* The prototype's "AURA Reflection" quote is not shown: no endpoint writes one
            for a plan item, and a canned reflection would read as AURA having looked. */}
      </div>

      {/* Today's Story — the first card served by the API rather than by fixtures. */}
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-extrabold text-[#1e1b17]">Today's Story</h2>
            {/* Meals from `GET /api/meals/today`; every other event type from
                `GET /api/events/today`, listed once under "Other moments". */}
            <p className="text-[11px] text-[#8a726a] mt-0.5">Meals and moments so far today</p>
          </div>
          <button
            onClick={() => onOpenLogModal()}
            className="text-xs font-bold text-[#9f4118] hover:underline flex items-center gap-1"
          >
            <span>+ Log moment</span>
          </button>
        </div>

        {today.status === 'loading' && (
          <div className="bg-white rounded-3xl p-10 border border-[#eee7e1] shadow-xs flex flex-col items-center gap-3">
            <div className="h-7 w-7 rounded-full border-2 border-[#ffdbce] border-t-[#ff8a5b] animate-spin" />
            <p className="text-xs text-[#bda99f] font-medium">Gathering today…</p>
          </div>
        )}

        {today.status === 'error' && (
          <div className="bg-white rounded-3xl p-6 border border-[#ffdbce] shadow-xs space-y-3">
            <div className="flex items-start gap-2.5">
              <span className="material-symbols-outlined text-[#9f4118] text-[20px]">
                cloud_off
              </span>
              <div className="min-w-0">
                <p className="text-sm font-bold text-[#1e1b17]">Could not load today's meals</p>
                <p className="text-xs text-[#56423b] leading-relaxed mt-0.5">
                  {today.error?.message}
                </p>
                {requestIdOf(today.error) && (
                  <p className="text-[10px] text-[#bda99f] mt-1 font-mono break-all">
                    Request {requestIdOf(today.error)}
                  </p>
                )}
              </div>
            </div>
            <button
              type="button"
              onClick={today.reload}
              className="px-4 py-1.5 rounded-full bg-[#ff8a5b] text-white text-xs font-bold hover:bg-[#f5763f] transition-colors"
            >
              Try again
            </button>
          </div>
        )}

        {today.status === 'success' && sections.length === 0 && plan.events.status !== 'loading' && (
          <div className="bg-white rounded-3xl p-10 border border-[#eee7e1] shadow-xs text-center space-y-1">
            <p className="text-sm font-bold text-[#1e1b17]">Nothing logged yet today.</p>
            <p className="text-xs text-[#8a726a]">
              Use <span className="font-semibold text-[#9f4118]">+ Log moment</span> when you
              are ready.
            </p>
          </div>
        )}

        {today.status === 'success' && plan.events.status === 'error' && (
          <div className="flex items-center justify-between gap-3 px-4 py-2.5 rounded-2xl bg-white border border-[#ffdbce] text-xs text-[#56423b]">
            <span>
              Other moments could not be loaded.
              {requestIdOf(plan.events.error) && (
                <span className="text-[10px] text-[#bda99f] font-mono ml-1">
                  Request {requestIdOf(plan.events.error)}
                </span>
              )}
            </span>
            <button type="button" onClick={plan.reload} className="font-bold text-[#9f4118] hover:underline">
              Try again
            </button>
          </div>
        )}

        {today.status === 'success' &&
          sections.map((section) => (
          <div key={section.id} className="bg-white rounded-3xl p-6 border border-[#eee7e1] shadow-xs space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-[#eee7e1]/80">
              <div className="flex items-center gap-2">
                <span className="text-xl">{section.icon}</span>
                <h3 className="text-base font-bold text-[#1e1b17]">{section.period}</h3>
              </div>
              {/* Empty for meals: the API sends no time range, and one will not be
                  guessed here. */}
              {section.timeRange && (
                <span className="text-xs font-semibold text-[#8a726a]">{section.timeRange}</span>
              )}
            </div>

            <div className="space-y-4">
              {section.events.map((event) => (
                <div key={event.id} className="flex items-start gap-4 p-3 rounded-2xl hover:bg-[#faf2ec]/50 transition-colors">
                  {/* The column disappears rather than showing a made-up clock time:
                      `GET /api/meals/today` returns no occurrence time at all. */}
                  {event.time && (
                    <div className="text-xs font-bold text-[#8a726a] w-12 pt-0.5 flex-shrink-0">
                      {event.time}
                    </div>
                  )}
                  <div className="flex-1 space-y-1.5">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h4 className="text-sm font-bold text-[#1e1b17]">{event.title}</h4>
                      {event.statusBadge && (
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                            event.statusType === 'warning'
                              ? 'bg-[#ffdad6] text-[#93000a]'
                              : event.statusType === 'success'
                              ? 'bg-[#adedd0] text-[#306d56]'
                              : event.statusType === 'urgent'
                              ? 'bg-[#ffdbce] text-[#7f2b01]'
                              : 'bg-[#eee7e1] text-[#56423b]'
                          }`}
                        >
                          {event.statusBadge}
                        </span>
                      )}
                    </div>

                    {event.description && (
                      <p className="text-xs text-[#56423b] leading-relaxed whitespace-pre-line">
                        {event.description}
                      </p>
                    )}

                    {event.tags && event.tags.length > 0 && (
                      <div className="flex flex-wrap items-center gap-1.5 pt-1">
                        {event.tags.map((tag, idx) => (
                          <span
                            key={idx}
                            className="px-2 py-0.5 bg-[#faf2ec] rounded-full text-[11px] font-medium text-[#1e1b17] border border-[#eee7e1]"
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                    )}

                    {event.extraPill && (
                      <div className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-[#ffdbce]/40 rounded-full text-[11px] font-semibold text-[#7f2b01]">
                        <span className="material-symbols-outlined text-[14px]">
                          {event.extraPill.icon}
                        </span>
                        <span>{event.extraPill.text}</span>
                      </div>
                    )}

                    {event.note && (
                      <div className="p-3 bg-[#faf2ec] rounded-xl border border-[#eee7e1] mt-2">
                        <span className="text-[11px] font-bold text-[#9f4118]">
                          {event.note.title}:
                        </span>
                        <p className="text-xs text-[#56423b] mt-0.5">{event.note.content}</p>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {section.summaryFootnote && (
              <div className="pt-3 border-t border-[#eee7e1]/60 text-[11px] text-[#8a726a] flex items-center justify-between">
                <span>{section.summaryFootnote}</span>
                <span className="text-[#2b6952] font-semibold">✓ Logged</span>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Need a quick adjustment? chips */}
      <div className="p-6 bg-gradient-to-r from-[#ffdbce]/30 via-[#faf2ec] to-[#adedd0]/30 rounded-3xl border border-[#eee7e1] flex flex-col sm:flex-row items-center justify-between gap-4">
        <div>
          <h4 className="text-sm font-bold text-[#1e1b17]">Need a quick adjustment?</h4>
          <p className="text-xs text-[#56423b]">Tap to quickly log or tweak today's remaining flow.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => onOpenLogModal('Đã ăn bữa tối nhẹ.')}
            className="px-3.5 py-1.5 rounded-full bg-white hover:bg-[#faf2ec] text-xs font-semibold text-[#1e1b17] shadow-xs border border-[#eee7e1]"
            type="button"
          >
            🍱 Ate
          </button>
          <button
            onClick={() => onOpenLogModal('Vừa hoàn thành 30 phút đi bộ nhẹ nhàng.')}
            className="px-3.5 py-1.5 rounded-full bg-white hover:bg-[#faf2ec] text-xs font-semibold text-[#1e1b17] shadow-xs border border-[#eee7e1]"
            type="button"
          >
            🏋️ Workout
          </button>
          <button
            onClick={() => onOpenLogModal('Đã uống 1 ly nước ấm 350ml.')}
            className="px-3.5 py-1.5 rounded-full bg-white hover:bg-[#faf2ec] text-xs font-semibold text-[#1e1b17] shadow-xs border border-[#eee7e1]"
            type="button"
          >
            💧 Water
          </button>
          <button
            onClick={() => onOpenLogModal('Chuẩn bị đi ngủ lúc 22:30.')}
            className="px-3.5 py-1.5 rounded-full bg-white hover:bg-[#faf2ec] text-xs font-semibold text-[#1e1b17] shadow-xs border border-[#eee7e1]"
            type="button"
          >
            😴 Sleep
          </button>
        </div>
      </div>
    </div>
  );
};
