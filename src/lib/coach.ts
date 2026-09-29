import { ApiError, NetworkError } from './api';
import { formatWait } from './insights';

/**
 * A chat failure → what the Coach screen says about it.
 *
 * Presentation only, and pure. Every judgement encoded here is one the backend already
 * published: which statuses it can return (`lib/errors.ts`), and — for the two provider
 * failures — what it says the caller should do about each. Nothing here inspects a
 * message, classifies a topic or decides whether a reply was safe. The safety engine is
 * the server's, and it answers with a `200`.
 */

/**
 * The backend's own cap (`agentChatBodySchema`: `minLength: 1`, `maxLength: 2000`).
 *
 * Duplicated as a number because it has to be: OpenAPI carries `maxLength`, TypeScript
 * cannot express it, so `openapi-typescript` generates a plain `string` and there is no
 * generated constant to import. The input uses it to stop a message that the server is
 * certain to reject, which is a round trip and a wasted slot out of thirty an hour.
 */
export const AGENT_MESSAGE_MAX_LENGTH = 2000;

export interface ChatFailure {
  /** One sentence, safe to show. Never a stack, a provider name or a token. */
  message: string;
  /** A `Retry-After` in words — "3 min" — or null when the server sent none. */
  wait: string | null;
  /**
   * Whether sending the identical message again could plausibly work.
   *
   * False for the three that cannot: a 400 fails the same validation, a 401 has no
   * session to use, and a 502 is the backend saying the provider refused and will
   * refuse again — `ai.service.ts` splits 502 from 503 on precisely this question and
   * documents 502 as the one where "the caller is not invited to try again".
   */
  retryable: boolean;
  /** Quote this to find the request in the server log. */
  requestId: string | undefined;
}

/**
 * What to say about a failed send.
 *
 * The server's own `message` is preferred wherever it is written for a person; these
 * sentences take over only where it is not, or where the status means something the
 * bare message does not convey.
 */
export function describeChatFailure(error: ApiError | NetworkError): ChatFailure {
  if (error instanceof NetworkError) {
    return { message: error.message, wait: null, retryable: true, requestId: undefined };
  }

  const base = {
    wait: formatWait(error.retryAfterSeconds),
    requestId: error.requestId,
  };

  switch (error.status) {
    case 400:
      return { ...base, message: error.message, retryable: false };

    // Deliberately not a sign-out. `AuthProvider` owns the session; a chat screen that
    // ended it would take the whole app down over one failed message.
    case 401:
      return {
        ...base,
        message: 'Your session is no longer valid. Sign in again to keep chatting.',
        retryable: false,
      };

    case 422:
      return {
        ...base,
        message: "AURA's reply did not pass the server's checks, so it was not shown.",
        retryable: true,
      };

    case 429:
      return {
        ...base,
        message: 'You have reached the chat limit for now.',
        retryable: true,
      };

    case 502:
      return {
        ...base,
        message: 'The AI service could not complete this request.',
        retryable: false,
      };

    case 503:
      return {
        ...base,
        message: 'The AI service is temporarily unavailable.',
        retryable: true,
      };

    default:
      return { ...base, message: error.message, retryable: true };
  }
}

/**
 * Whether a message is one the endpoint would accept.
 *
 * Mirrors the server's `minLength`/`maxLength` and nothing else — no topic check, no
 * keyword list. What a message is *about* is the backend's call, and it answers out of
 * scope with a `boundary` reply rather than a rejection.
 */
export function isSendableMessage(text: string): boolean {
  const trimmed = text.trim();
  return trimmed.length > 0 && trimmed.length <= AGENT_MESSAGE_MAX_LENGTH;
}

/**
 * The label for a section's kind.
 *
 * The backend keeps `fact`, `interpretation` and `general` apart on purpose and enforces
 * the difference in the model's output: a `fact` cites evidence, an `interpretation` is
 * explicitly tentative, a `general` is education that is not about this person and cites
 * nothing. Rendering all three identically would discard the one distinction the server
 * spends its validation budget on.
 */
export function sectionKindLabel(kind: 'fact' | 'interpretation' | 'general'): string {
  if (kind === 'fact') return 'From your data';
  if (kind === 'interpretation') return 'A possible reading';
  return 'General';
}
