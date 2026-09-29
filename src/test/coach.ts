import type { AgentChatResponse } from '../lib/api';

/**
 * Agent chat fixtures, typed against the generated contract — so a field AURA-BE renames
 * breaks these at compile time rather than letting a test pass on a shape the server no
 * longer sends.
 *
 * The four `kind`s here are the four the contract enumerates, and the bodies match what
 * the backend actually builds for each: a model answer carries sections, suggestions,
 * caveats and evidence, while `boundary`, `support` and `disabled` come from
 * `agent/safety-responses.ts` as a single line of text with everything else empty and
 * `promptVersion: null`, because no model was asked.
 */

/** A full model answer, with every optional part populated. */
export function answerReply(): AgentChatResponse {
  return {
    kind: 'answer',
    intent: 'today',
    answer: {
      text: 'You logged lunch and dinner today, and moved for 40 minutes this evening.',
      evidence: ['metric:meals.lunch_days', 'metric:activity.minutes'],
    },
    sections: [
      {
        kind: 'fact',
        title: 'Meals',
        text: 'Two of three planned meals are logged.',
        evidence: ['metric:meals.lunch_days'],
      },
      {
        kind: 'interpretation',
        title: 'A gentler evening',
        text: 'The walk may have suited a tired day better than the planned session.',
        evidence: ['metric:activity.minutes'],
      },
      {
        kind: 'general',
        title: 'Steady rhythms',
        text: 'Regular meals tend to be easier to keep than strict ones.',
        evidence: [],
      },
    ],
    suggestions: [
      { text: 'A vegetable at lunch would round the day out.', evidence: ['metric:meals.lunch_days'] },
    ],
    caveats: [{ text: 'This describes what was logged, not a cause.', evidence: ['pattern:evening-walk'] }],
    usedContext: ['meals:today', 'events:today'],
    promptVersion: 'agent-chat-v1',
  };
}

/** The safety gate's crisis reply: written by people, no model call, nothing else set. */
export function supportReply(): AgentChatResponse {
  return {
    kind: 'support',
    intent: 'general',
    answer: {
      text: "I'm really sorry you're going through this, and you don't have to face it alone. Please reach out to someone you trust or a mental health professional now.",
      evidence: [],
    },
    sections: [],
    suggestions: [],
    caveats: [],
    usedContext: [],
    promptVersion: null,
  };
}

/** Out of AURA's scope. Also a 200, also just text. */
export function boundaryReply(): AgentChatResponse {
  return {
    kind: 'boundary',
    intent: 'general',
    answer: {
      text: 'I focus on health, nutrition, movement and habits in AURA. You can ask me about your meals, your plan or your week.',
      evidence: [],
    },
    sections: [],
    suggestions: [],
    caveats: [],
    usedContext: [],
    promptVersion: null,
  };
}

/** This person has AI features turned off in their own preferences. */
export function disabledReply(): AgentChatResponse {
  return {
    kind: 'disabled',
    intent: 'general',
    answer: {
      text: 'AI features are turned off in your settings. You can turn them back on in your preferences.',
      evidence: [],
    },
    sections: [],
    suggestions: [],
    caveats: [],
    usedContext: [],
    promptVersion: null,
  };
}

/** The error envelope, exactly as `lib/errors.ts` builds it. */
export function errorEnvelope(code: string, message: string, requestId = 'req-1'): unknown {
  return { error: { code, message, requestId } };
}
