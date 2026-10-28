import type { ActivityCategory } from '../../types';

/**
 * The category selector, and what each category's form says.
 *
 * Every category has a backend now: food through `/api/meals`, workouts through
 * `/api/workouts`, check-ins through `/api/checkins`, and the rest through `/api/events`.
 */

export interface CategoryCopy {
  label: string;
  icon: string;
  /** The form's heading, which also labels its text box. */
  heading: string;
  placeholder: string;
  helper: string;
  submit: string;
}

export const CATEGORIES: ReadonlyArray<{ key: ActivityCategory } & CategoryCopy> = [
  {
    key: 'eat',
    label: 'I ate',
    icon: '🍱',
    heading: 'Tell AURA what you ate',
    placeholder: 'Tôi ăn 2 chén cơm với thịt kho trứng và canh rau…',
    helper: 'Every nutrition figure comes from the food database.',
    submit: 'Let AURA read it',
  },
  {
    key: 'workout',
    label: 'I worked out',
    icon: '🏋️',
    heading: 'Describe your workout',
    placeholder: 'Tôi tập gym 45 phút… or “I cycled for 30 minutes at moderate intensity”',
    helper:
      'AURA fills in the type, duration and effort you mention — check them below. Nothing is estimated: no calories, no heart rate.',
    submit: 'Save workout',
  },
  {
    key: 'walk',
    label: 'I walked',
    icon: '🚶',
    heading: 'Describe your walk',
    placeholder: 'Vừa hoàn thành 30 phút đi bộ nhẹ nhàng… or “I walked 2.5 km in 35 minutes”',
    helper: 'How long is all AURA needs. Distance is optional.',
    submit: 'Save walk',
  },
  {
    key: 'water',
    label: 'I drank water',
    icon: '💧',
    heading: 'How much water did you drink?',
    placeholder: '500 ml… or “Tôi vừa uống 350 ml nước”',
    helper: 'Logged in ml. A glass or a cup is not converted — AURA asks instead of guessing its size.',
    submit: 'Log water',
  },
  {
    key: 'sleep',
    label: 'I slept',
    icon: '😴',
    heading: 'Describe your sleep',
    placeholder: 'Tôi ngủ được 7 tiếng… or “I went to bed at 11 PM and woke up at 6 AM”',
    helper: 'Times are in this device’s local time. A bedtime later than the wake-up is the night before.',
    submit: 'Save sleep',
  },
  {
    key: 'check-in',
    label: 'Check-in',
    icon: '😊',
    heading: 'How are you feeling?',
    placeholder: 'Anything on your mind? (optional)',
    helper: 'This is today’s check-in, so saving replaces it. It is how the day feels to you — not a measurement.',
    submit: 'Save check-in',
  },
  {
    key: 'other',
    label: 'Something else',
    icon: '✍️',
    heading: 'What happened?',
    placeholder: 'Tôi vừa nghỉ giải lao… or “I meditated for 10 minutes”',
    helper: 'Saved as you wrote it, even when AURA can’t tell what kind of thing it was.',
    submit: 'Save activity',
  },
];

export function copyFor(category: ActivityCategory): CategoryCopy {
  return CATEGORIES.find((entry) => entry.key === category)!;
}
