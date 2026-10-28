import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ApiError,
  DAY_TAGS,
  NetworkError,
  createEvent,
  createWorkout,
  fetchRecentCheckins,
  fetchTodayEvents,
  saveCheckin,
  type Checkin,
  type DayTag,
  type Mood,
  type WorkoutType,
} from '../../lib/api';
import {
  buildRequest,
  emptyForm,
  readText,
  readWater,
  sleepTiming,
  type ActivityForms,
  type ActivityKind,
  type ActivityRequest,
  type CheckinActivityForm,
  type OtherForm,
  type SleepForm,
  type WalkForm,
  type WaterForm,
  type WorkoutForm,
} from '../../lib/activity';
import { DAY_TAG_LABEL, findTodaysCheckin } from '../../lib/checkin';
import { SubmissionKey } from '../../lib/idempotency';
import { copyFor } from './categories';
import { ErrorAlert } from './ErrorAlert';
import type { RequestError } from './state';

/**
 * Every category but food: one description, a few fields, one save.
 *
 * Mounted per category (`key={kind}` in the modal), so switching category starts a
 * fresh form — nothing typed into a workout's fields can end up on a walk. The
 * description is the exception: it belongs to the modal and survives the switch, and it
 * is only ever saved by the category on screen, as that category's note.
 *
 * The fields the description mentions are filled in as it is typed (`lib/activity.ts`),
 * except any the person has set themselves — those are theirs and are never overwritten.
 */

type AnyForm = ActivityForms[ActivityKind];
type Values = Record<string, unknown>;

interface ActivityComposerProps {
  kind: ActivityKind;
  text: string;
  onTextChange: (text: string) => void;
  /** Fired once, with the id of what the server created. */
  onSaved: (id: string) => void;
  onClose: () => void;
  /** While a save is in flight the modal holds the category selector still. */
  onBusyChange: (busy: boolean) => void;
}

function asKnownError(error: unknown): RequestError {
  if (error instanceof ApiError || error instanceof NetworkError) return error;
  return new ApiError('Something went wrong.', 0, 'UNKNOWN');
}

async function send(request: ActivityRequest, idempotencyKey: string): Promise<string> {
  const options = { idempotencyKey };
  switch (request.endpoint) {
    case 'events':
      return (await createEvent(request.body, options)).id;
    case 'workouts':
      return (await createWorkout(request.body, options)).eventId;
    case 'checkins':
      return (await saveCheckin(request.body, options)).id;
  }
}

/**
 * One automatic second attempt when the request never got an answer — a dropped
 * connection, not a refusal. Safe only because both attempts carry the same key: if the
 * first one did reach the server, the second gets its stored answer, not a second record.
 */
async function sendWithRetry(request: ActivityRequest, idempotencyKey: string): Promise<string> {
  try {
    return await send(request, idempotencyKey);
  } catch (failure) {
    if (!(failure instanceof NetworkError)) throw failure;
    return send(request, idempotencyKey);
  }
}

/** Untouched fields follow the description; touched ones are left as the person set them. */
function follow(kind: ActivityKind, form: AnyForm, defaults: AnyForm, touched: ReadonlySet<string>, text: string): AnyForm {
  const reading = readText(kind, text) as Values;
  const next: Values = { ...form };
  for (const [key, fallback] of Object.entries(defaults)) {
    if (touched.has(key)) continue;
    next[key] = key in reading ? reading[key] : fallback;
  }
  return next as unknown as AnyForm;
}

type CheckinLoad = { status: 'loading' } | { status: 'loaded'; existing: Checkin | null } | { status: 'error' };

export const ActivityComposer: React.FC<ActivityComposerProps> = ({
  kind,
  text,
  onTextChange,
  onSaved,
  onClose,
  onBusyChange,
}) => {
  const copy = copyFor(kind);
  const defaults = useRef<AnyForm>(emptyForm(kind, new Date()));
  const touched = useRef(new Set<string>());
  const [form, setForm] = useState<AnyForm>(() => follow(kind, defaults.current, defaults.current, touched.current, text));

  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [error, setError] = useState<RequestError | null>(null);
  /** Field messages appear after the first attempt to save, then follow every edit. */
  const [attempted, setAttempted] = useState(false);
  /** Written synchronously, so a second click in the same frame already sees it. */
  const inFlight = useRef(false);
  /**
   * The server-side guard. "Try again" after a failure resends the same key, so a save
   * that did land but whose answer was lost is replayed rather than logged twice. Editing
   * the form first makes it a new action, with a new key.
   */
  const submission = useRef(new SubmissionKey());

  const handleText = (value: string) => {
    onTextChange(value);
    setForm((current) => follow(kind, current, defaults.current, touched.current, value));
  };

  const setField = useCallback((field: string, value: unknown) => {
    touched.current.add(field);
    setForm((current) => ({ ...current, [field]: value }) as AnyForm);
  }, []);

  // ── Check-in: today's answer first ───────────────────────────────────────────
  // The server keeps one check-in per day and clears any field a save leaves out, so
  // the form starts from what is already saved. Saving the defaults over it would
  // silently erase this morning's tag and note.
  const [checkinLoad, setCheckinLoad] = useState<CheckinLoad>(
    kind === 'check-in' ? { status: 'loading' } : { status: 'loaded', existing: null },
  );
  const textRef = useRef(text);
  textRef.current = text;
  useEffect(() => {
    if (kind !== 'check-in') return;
    let current = true;
    void (async () => {
      try {
        const [checkins, events] = await Promise.all([fetchRecentCheckins(), fetchTodayEvents()]);
        if (!current) return;
        const existing = findTodaysCheckin(checkins, events);
        if (existing) {
          const saved: CheckinActivityForm = {
            mood: existing.mood,
            dayTag: existing.dayTag ?? null,
            energy: existing.energy1to5 ?? null,
          };
          defaults.current = saved;
          setForm((now) => follow(kind, now, saved, touched.current, textRef.current));
          if (existing.note && textRef.current.trim() === '') onTextChange(existing.note);
        }
        setCheckinLoad({ status: 'loaded', existing });
      } catch {
        if (current) setCheckinLoad({ status: 'error' });
      }
    })();
    return () => {
      current = false;
    };
    // Once per mount: this is the form's starting point, not something to keep in sync.
  }, []);

  const result = buildRequest(kind, form, text, new Date());
  const errors = attempted && result.ok === false ? result.errors : {};
  const saving = status === 'saving';
  const saved = status === 'saved';

  const handleSave = async () => {
    if (inFlight.current || saved) return;
    setAttempted(true);
    const built = buildRequest(kind, form, text, new Date());
    if (!built.ok) return;

    inFlight.current = true;
    setStatus('saving');
    setError(null);
    onBusyChange(true);
    try {
      const id = await sendWithRetry(built.request, submission.current.for(built.request));
      submission.current.done();
      setStatus('saved');
      onBusyChange(false);
      onSaved(id);
      window.setTimeout(onClose, 900);
    } catch (failure) {
      // The form and the description stay exactly as they were, so a retry costs a click.
      inFlight.current = false;
      setStatus('error');
      setError(asKnownError(failure));
      onBusyChange(false);
    }
  };

  const locked = saving || saved;
  const field = { form, errors, setField, disabled: locked };

  return (
    <div className="space-y-4 mb-6">
      <div className="rounded-2xl bg-[#faf2ec] p-4 sm:p-5 border border-[#eee7e1]/80 space-y-4">
        <div>
          <label htmlFor="activity-text" className="flex items-center gap-1.5 text-[#56423b] text-xs font-semibold mb-2">
            <span className="material-symbols-outlined text-[16px] text-[#9f4118]" aria-hidden="true">
              forum
            </span>
            <span>{copy.heading}</span>
          </label>
          <textarea
            id="activity-text"
            value={text}
            onChange={(event) => handleText(event.target.value)}
            rows={kind === 'water' ? 2 : 3}
            disabled={locked}
            placeholder={copy.placeholder}
            aria-invalid={errors['text'] ? true : undefined}
            aria-describedby={errors['text'] ? 'activity-text-error' : 'activity-text-help'}
            className={inputClass(Boolean(errors['text']), 'w-full p-3 text-base')}
          />
          <FieldError id="activity-text-error" message={errors['text']} />
          <p id="activity-text-help" className="text-[11px] text-[#8a726a] leading-relaxed mt-1.5">
            {copy.helper}
          </p>
        </div>

        <div className="pt-3 border-t border-[#e8e1db]/60">
          {kind === 'workout' && <WorkoutFields {...field} />}
          {kind === 'walk' && <WalkFields {...field} />}
          {kind === 'water' && <WaterFields {...field} text={text} />}
          {kind === 'sleep' && <SleepFields {...field} />}
          {kind === 'check-in' && <CheckinFields {...field} load={checkinLoad} text={text} />}
          {kind === 'other' && <OtherFields {...field} />}
        </div>
      </div>

      {error && <ErrorAlert error={error} onDismiss={() => setError(null)} />}

      <button
        type="button"
        onClick={() => void handleSave()}
        disabled={locked || checkinLoad.status === 'loading'}
        className={`w-full py-3 px-6 rounded-full font-bold text-sm shadow-[0_10px_24px_-4px_rgba(255,138,91,0.4)] enabled:hover:scale-[1.01] enabled:active:scale-[0.98] transition-all flex items-center justify-center gap-2 text-white disabled:opacity-80 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-[#ff8a5b] focus-visible:ring-offset-2 ${
          saved ? 'bg-[#2b6952]' : 'bg-[#9f4118] enabled:hover:bg-[#ff8a5b]'
        }`}
      >
        {saving ? (
          <>
            <span className="material-symbols-outlined text-[20px] animate-spin" aria-hidden="true">sync</span>
            <span>Saving…</span>
          </>
        ) : saved ? (
          <>
            <span className="material-symbols-outlined text-[20px]" aria-hidden="true">task_alt</span>
            <span>Logged 🎉</span>
          </>
        ) : (
          <>
            <span className="material-symbols-outlined text-[20px]" aria-hidden="true">check_circle</span>
            <span>{copy.submit}</span>
          </>
        )}
      </button>
    </div>
  );
};

// ── Fields ─────────────────────────────────────────────────────────────────────

interface FieldProps<F> {
  form: AnyForm;
  errors: Partial<Record<string, string>>;
  setField: (field: keyof F & string, value: unknown) => void;
  disabled: boolean;
}

function inputClass(invalid: boolean, extra = 'w-full px-3 py-2 text-sm') {
  return `${extra} bg-white rounded-xl text-[#1e1b17] border placeholder:text-[#bda99f] focus:outline-none focus:border-[#ff8a5b] focus-visible:ring-1 focus-visible:ring-[#ff8a5b] disabled:opacity-60 transition-colors ${
    invalid ? 'border-[#93000a]' : 'border-[#eee7e1]'
  }`;
}

const FieldError: React.FC<{ id: string; message: string | undefined }> = ({ id, message }) =>
  message ? (
    <p id={id} className="text-xs font-semibold text-[#93000a] mt-1">
      {message}
    </p>
  ) : null;

const TextField: React.FC<{
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string | undefined;
  inputMode?: 'numeric' | 'decimal' | 'text';
  type?: 'text' | 'time';
  suffix?: string;
  placeholder?: string;
  disabled: boolean;
}> = ({ id, label, value, onChange, error, inputMode = 'text', type = 'text', suffix, placeholder, disabled }) => (
  <div className="min-w-0">
    <label htmlFor={id} className="block text-xs font-semibold text-[#56423b] mb-1">
      {label}
    </label>
    <div className="flex items-center gap-2">
      <input
        id={id}
        type={type}
        inputMode={type === 'time' ? undefined : inputMode}
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        className={inputClass(Boolean(error))}
      />
      {suffix && <span className="text-xs font-semibold text-[#56423b] flex-shrink-0">{suffix}</span>}
    </div>
    <FieldError id={`${id}-error`} message={error} />
  </div>
);

/** A row of pressable choices, one of which may be chosen; pressing the chosen one clears it. */
function Choices<T extends string | number>({
  id,
  legend,
  options,
  value,
  onChange,
  error,
  disabled,
  optional = false,
}: {
  /** Stable, so the error below can be referenced as `${id}-error`. */
  id: string;
  legend: string;
  options: ReadonlyArray<{ value: T; label: string }>;
  value: T | null;
  onChange: (value: T | null) => void;
  error?: string | undefined;
  disabled: boolean;
  optional?: boolean;
}) {
  return (
    // A fieldset is a group, which takes no `aria-invalid`; the error is its description,
    // so a screen reader announces it on entering the group.
    <fieldset id={id} className="min-w-0" aria-describedby={error ? `${id}-error` : undefined}>
      <legend className="text-xs font-semibold text-[#56423b] mb-1.5">{legend}</legend>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => {
          const active = option.value === value;
          return (
            <button
              key={String(option.value)}
              type="button"
              aria-pressed={active}
              disabled={disabled}
              onClick={() => onChange(active && optional ? null : option.value)}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#ff8a5b] disabled:opacity-60 disabled:cursor-not-allowed ${
                active
                  ? 'bg-[#9f4118] border-[#9f4118] text-white'
                  : 'bg-white border-[#eee7e1] text-[#56423b] enabled:hover:border-[#ff8a5b]'
              }`}
            >
              {option.label}
            </button>
          );
        })}
      </div>
      {error && (
        <p id={`${id}-error`} className="text-xs font-semibold text-[#93000a] mt-1">
          {error}
        </p>
      )}
    </fieldset>
  );
}

/** Walking has its own category, so it is not offered as a kind of workout. */
const WORKOUT_OPTIONS: ReadonlyArray<{ value: WorkoutType; label: string }> = [
  { value: 'gym', label: 'Gym / strength' },
  { value: 'run', label: 'Run' },
  { value: 'yoga', label: 'Yoga' },
  { value: 'sport', label: 'Sport' },
  { value: 'home', label: 'Home workout' },
  { value: 'other', label: 'Other' },
];

const EFFORT_OPTIONS: ReadonlyArray<{ value: number; label: string }> = [
  { value: 1, label: '1 · Very easy' },
  { value: 2, label: '2 · Easy' },
  { value: 3, label: '3 · Moderate' },
  { value: 4, label: '4 · Hard' },
  { value: 5, label: '5 · Very hard' },
];

const WorkoutFields: React.FC<FieldProps<WorkoutForm>> = ({ form, errors, setField, disabled }) => {
  const f = form as WorkoutForm;
  return (
    <div className="space-y-4">
      <Choices
        id="workout-type"
        legend="Kind of workout"
        options={WORKOUT_OPTIONS}
        value={f.workoutType}
        onChange={(value) => setField('workoutType', value)}
        error={errors['workoutType']}
        disabled={disabled}
      />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <TextField
          id="workout-name"
          label="Activity name (optional)"
          value={f.name}
          placeholder="Strength training"
          onChange={(value) => setField('name', value)}
          error={errors['name']}
          disabled={disabled}
        />
        <TextField
          id="workout-duration"
          label="Duration"
          value={f.durationMin}
          inputMode="numeric"
          suffix="min"
          placeholder="45"
          onChange={(value) => setField('durationMin', value)}
          error={errors['durationMin']}
          disabled={disabled}
        />
      </div>
      <Choices
        id="workout-effort"
        legend="How hard did it feel? (optional)"
        options={EFFORT_OPTIONS}
        value={f.effort}
        onChange={(value) => setField('effort', value)}
        disabled={disabled}
        optional
      />
    </div>
  );
};

const WalkFields: React.FC<FieldProps<WalkForm>> = ({ form, errors, setField, disabled }) => {
  const f = form as WalkForm;
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      <TextField
        id="walk-duration"
        label="Duration"
        value={f.durationMin}
        inputMode="numeric"
        suffix="min"
        placeholder="30"
        onChange={(value) => setField('durationMin', value)}
        error={errors['durationMin']}
        disabled={disabled}
      />
      <TextField
        id="walk-distance"
        label="Distance (optional)"
        value={f.distanceKm}
        inputMode="decimal"
        suffix="km"
        placeholder="2.5"
        onChange={(value) => setField('distanceKm', value)}
        error={errors['distanceKm']}
        disabled={disabled}
      />
    </div>
  );
};

const QUICK_ML = [150, 250, 350, 500] as const;

const WaterFields: React.FC<FieldProps<WaterForm> & { text: string }> = ({ form, errors, setField, disabled, text }) => {
  const f = form as WaterForm;
  const { clarification } = readWater(text);
  return (
    <div className="space-y-3">
      <Choices
        id="water-quick"
        legend="Quick amounts"
        options={QUICK_ML.map((ml) => ({ value: String(ml), label: `${ml} ml` }))}
        value={f.amountMl}
        onChange={(value) => setField('amountMl', value ?? '')}
        disabled={disabled}
      />
      <TextField
        id="water-amount"
        label="Amount"
        value={f.amountMl}
        inputMode="numeric"
        suffix="ml"
        placeholder="250"
        onChange={(value) => setField('amountMl', value)}
        error={errors['amountMl']}
        disabled={disabled}
      />
      {clarification && f.amountMl.trim() === '' && (
        <p role="status" className="text-xs font-semibold text-[#9f4118]">
          {clarification}
        </p>
      )}
    </div>
  );
};

const SleepFields: React.FC<FieldProps<SleepForm>> = ({ form, errors, setField, disabled }) => {
  const f = form as SleepForm;
  const fromTimes = f.bedtime.trim() !== '' && f.wakeTime.trim() !== '';
  const timing = fromTimes ? sleepTiming(f, new Date()) : null;
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <TextField
          id="sleep-bedtime"
          label="Went to bed (optional)"
          type="time"
          value={f.bedtime}
          onChange={(value) => setField('bedtime', value)}
          disabled={disabled}
        />
        <TextField
          id="sleep-wake"
          label="Woke up"
          type="time"
          value={f.wakeTime}
          onChange={(value) => setField('wakeTime', value)}
          disabled={disabled}
        />
        <TextField
          id="sleep-duration"
          label="Hours slept"
          value={timing?.durationMin ? String(Number((timing.durationMin / 60).toFixed(2))) : f.durationHours}
          inputMode="decimal"
          suffix="h"
          placeholder="7"
          onChange={(value) => setField('durationHours', value)}
          error={errors['duration']}
          disabled={disabled || fromTimes}
        />
      </div>
      {timing?.durationMin ? (
        <p className="text-xs text-[#56423b]">
          Worked out from your times: {Math.floor(timing.durationMin / 60)} h {timing.durationMin % 60} min.
        </p>
      ) : null}
      {/* Said as soon as the times disagree, not only after a save is attempted. */}
      {timing?.error && !errors['duration'] ? (
        <p role="status" className="text-xs font-semibold text-[#9f4118]">
          {timing.error}
        </p>
      ) : null}
    </div>
  );
};

const MOOD_OPTIONS: ReadonlyArray<{ value: Mood; label: string }> = [
  { value: 'low', label: '🥱 Low energy' },
  { value: 'okay', label: '😐 Okay' },
  { value: 'good', label: '🙂 Good' },
  { value: 'great', label: '✨ Great' },
];

const ENERGY_OPTIONS: ReadonlyArray<{ value: number; label: string }> = [1, 2, 3, 4, 5].map((value) => ({
  value,
  label: String(value),
}));

const CheckinFields: React.FC<FieldProps<CheckinActivityForm> & { load: CheckinLoad; text: string }> = ({
  form,
  errors,
  setField,
  disabled,
  load,
  text,
}) => {
  const f = form as CheckinActivityForm;
  // The saved note is only put in the box when the box was empty. When it already held
  // something — carried over from another category — the saved note is not on screen,
  // and saving would replace it, so it is shown here instead of being lost silently.
  const savedNote = load.status === 'loaded' ? load.existing?.note?.trim() : undefined;
  const replacesNote = Boolean(savedNote) && text.trim() !== savedNote;
  return (
    <div className="space-y-4">
      {load.status === 'loading' && (
        <p role="status" className="text-xs text-[#8a726a]">
          Loading today’s check-in…
        </p>
      )}
      {load.status === 'error' && (
        <p role="status" className="text-xs font-semibold text-[#9f4118]">
          Couldn’t load today’s check-in. Saving replaces it, including any tag or note it had.
        </p>
      )}
      {load.status === 'loaded' && load.existing && (
        <p role="status" className="text-xs text-[#2b6952]">
          You checked in earlier today — this is that answer. Saving updates it.
        </p>
      )}
      {replacesNote && (
        <p className="text-xs font-semibold text-[#9f4118]">
          Today’s saved note — “{savedNote}” — will be replaced by what is written above.
        </p>
      )}
      <Choices
        id="checkin-mood"
        legend="Mood"
        options={MOOD_OPTIONS}
        value={f.mood}
        onChange={(value) => setField('mood', value)}
        error={errors['mood']}
        disabled={disabled}
      />
      <Choices
        id="checkin-day-tag"
        legend="How did the day go? (optional)"
        options={DAY_TAGS.map((tag: DayTag) => ({ value: tag, label: DAY_TAG_LABEL[tag] }))}
        value={f.dayTag}
        onChange={(value) => setField('dayTag', value)}
        disabled={disabled}
        optional
      />
      <Choices
        id="checkin-energy"
        legend="Energy, 1 (low) to 5 (high) (optional)"
        options={ENERGY_OPTIONS}
        value={f.energy}
        onChange={(value) => setField('energy', value)}
        disabled={disabled}
        optional
      />
    </div>
  );
};

const OtherFields: React.FC<FieldProps<OtherForm>> = ({ form, errors, setField, disabled }) => {
  const f = form as OtherForm;
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      <TextField
        id="other-title"
        label="Title (optional)"
        value={f.title}
        placeholder="Meditation"
        onChange={(value) => setField('title', value)}
        error={errors['title']}
        disabled={disabled}
      />
      <TextField
        id="other-duration"
        label="Duration (optional)"
        value={f.durationMin}
        inputMode="numeric"
        suffix="min"
        placeholder="10"
        onChange={(value) => setField('durationMin', value)}
        error={errors['durationMin']}
        disabled={disabled}
      />
    </div>
  );
};
