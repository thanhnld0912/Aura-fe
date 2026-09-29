import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { ApiError, NetworkError, sendChatMessage, type AgentChatResponse } from '../lib/api';
import { isSendableMessage } from '../lib/coach';

/**
 * The Coach conversation: what has been said on this screen, and sending the next line.
 *
 * Nothing is requested on mount. Unlike every other hook in this folder there is no read
 * to do — `POST /api/agent/chat` is the only call, it costs a model run, and it happens
 * **only** when `send()` or `retry()` is called from a real interaction. Mounting,
 * re-rendering and StrictMode's double-invoke all send nothing, because no effect sends.
 *
 * ## The transcript is this screen's, and only this screen's
 *
 * The endpoint is stateless: no conversation id in the request, none in the reply, no
 * history sent to the model, nothing stored server-side. So `messages` is exactly what
 * has happened since this component mounted, it is gone on reload, and the UI must not
 * imply otherwise. It is not sent back on the next message either — there is no field
 * for it, and the request schema is strict.
 *
 * ## One send at a time
 *
 * `inFlight` is a ref written synchronously, so the second of two calls in the same
 * frame — a double click, Enter landing with the button press, a re-render mid-send —
 * sees it already set and returns. A queue would be worse than a refusal here: it would
 * spend a second slot out of thirty an hour on a message the person sent once.
 *
 * ## A failure keeps everything
 *
 * The user's line stays in the transcript, `pending` keeps the text, and `retry()` sends
 * that same text again **without appending a second copy of it**. Nothing retries on a
 * timer, and a 401 is surfaced like any other failure: `AuthProvider` owns the session,
 * and one refused message is not a reason to sign anybody out.
 */

export type ChatStatus = 'idle' | 'sending' | 'error';

export type CoachMessage =
  | { id: string; role: 'user'; text: string }
  | { id: string; role: 'assistant'; reply: AgentChatResponse };

export interface CoachChatState {
  /** This session's transcript, oldest first. Never restored, never persisted. */
  messages: CoachMessage[];
  status: ChatStatus;
  /** Non-null only when `status` is `error`. */
  error: ApiError | NetworkError | null;
  /** The message awaiting a reply, or the one that failed and `retry()` would resend. */
  pending: string | null;
  /** False while a send is in flight, or when the text is empty or over the server's cap. */
  canSend: (text: string) => boolean;
  send: (text: string) => void;
  /** Resends `pending`. Does nothing when there is none, or while one is in flight. */
  retry: () => void;
}

function asKnownError(error: unknown): ApiError | NetworkError {
  if (error instanceof ApiError || error instanceof NetworkError) return error;
  return new ApiError('Something went wrong sending your message.', 0, 'UNKNOWN');
}

export function useCoachChat(): CoachChatState {
  const { status: authStatus, user } = useAuth();
  const identity = authStatus === 'signed-in' ? (user?.id ?? null) : null;

  const [messages, setMessages] = useState<CoachMessage[]>([]);
  const [status, setStatus] = useState<ChatStatus>('idle');
  const [error, setError] = useState<ApiError | NetworkError | null>(null);
  const [pending, setPending] = useState<string | null>(null);

  /** Written synchronously, so a second call in the same frame already sees it. */
  const inFlight = useRef(false);
  /** Whose conversation this is. A reply for someone else is dropped, not shown. */
  const conversationFor = useRef<string | null>(null);
  /** Keys for React only. Not an id from the server — the server issues none. */
  const counter = useRef(0);
  const nextId = () => {
    counter.current += 1;
    return `m${counter.current}`;
  };

  // One person's conversation is never left on screen for the next. Signing out clears
  // it too: `identity` becomes null, and nothing here should outlive the session.
  useEffect(() => {
    if (conversationFor.current === identity) return;
    conversationFor.current = identity;
    setMessages([]);
    setStatus('idle');
    setError(null);
    setPending(null);
  }, [identity]);

  const run = useCallback(
    (message: string, append: boolean) => {
      if (inFlight.current) return;
      inFlight.current = true;

      const owner = identity;
      if (append) setMessages((prev) => [...prev, { id: nextId(), role: 'user', text: message }]);
      setPending(message);
      setStatus('sending');
      setError(null);

      void (async () => {
        try {
          const reply = await sendChatMessage(message);
          // Someone else signed in while this was in flight; their screen is not the
          // place for this answer.
          if (conversationFor.current !== owner) return;

          setMessages((prev) => [...prev, { id: nextId(), role: 'assistant', reply }]);
          setPending(null);
          setStatus('idle');
        } catch (failure) {
          if (conversationFor.current !== owner) return;

          // `pending` and the user's line both stay: this is what `retry()` resends,
          // and what the person can see they said.
          setError(asKnownError(failure));
          setStatus('error');
        } finally {
          inFlight.current = false;
        }
      })();
    },
    [identity],
  );

  const canSend = useCallback((text: string): boolean => {
    if (inFlight.current) return false;
    return isSendableMessage(text);
  }, []);

  const send = useCallback(
    (text: string) => {
      const message = text.trim();
      // The server would answer an empty or over-long message with a 400, and a message
      // that is merely off topic with a `boundary` reply. Only the first is stopped here.
      if (!isSendableMessage(message)) return;
      run(message, true);
    },
    [run],
  );

  const retry = useCallback(() => {
    if (pending === null) return;
    run(pending, false);
  }, [pending, run]);

  return { messages, status, error, pending, canSend, send, retry };
}
