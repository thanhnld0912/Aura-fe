import type { AuthChangeEvent, Session } from '@supabase/supabase-js';
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { ApiError, NetworkError, endSession, exchangeSession, type AuraUser } from '../lib/api';
import { getSupabase } from '../lib/supabase';

/**
 * The single place that knows whether anyone is signed in.
 *
 * The shape of the flow, once:
 *
 *   Supabase Auth  --(access token)-->  AURA API  --(AURA user)-->  this provider
 *
 * Supabase owns the session; this provider only reacts to it. Everything comes
 * through `onAuthStateChange`, including the session restored from storage on a page
 * refresh, which arrives as `INITIAL_SESSION`. Reading the session once at startup
 * instead would work until the first silent token refresh, and then quietly stop.
 *
 * ## Why the bootstrap is guarded so carefully
 *
 * `onAuthStateChange` is a notification of *state*, not of an *occurrence*. Supabase
 * re-announces the current session whenever it has reason to: `GoTrueClient`
 * re-runs `_recoverAndRefresh()` on every hidden→visible transition of the tab and
 * ends it with an unconditional `SIGNED_IN`, and its BroadcastChannel replays
 * `SIGNED_IN` from other tabs on the same origin. So `SIGNED_IN` means "this is who
 * is signed in", not "someone just signed in", and treating it as the latter turns
 * every alt-tab into a `POST /api/auth/session` — which is rate limited to 10 per
 * 15 minutes per IP, and rightly so.
 *
 * Hence: the bootstrap is keyed on the **identity**, and one identity is exchanged
 * at most once. Not a boolean, which the next event would race, and not a "has
 * finished" check, which two events arriving together would both pass.
 */

export type AuthStatus =
  | 'loading' // restoring whatever Supabase has in storage
  | 'signed-out'
  | 'connecting' // Supabase says yes; asking the AURA API who that is
  | 'blocked' // a valid Supabase session the AURA API would not accept or could not be asked
  | 'signed-in';

export interface AuthState {
  status: AuthStatus;
  session: Session | null;
  user: AuraUser | null;
  /** Set in the `blocked` state. Safe to show; never contains a token. */
  problem: string | null;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  /** Re-attempts a bootstrap that failed. The only path that retries. */
  retry: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

/**
 * What has happened to the bootstrap for one identity.
 *
 * `pending` and `settled` both block a second attempt: `pending` stops two events
 * arriving together from racing, `settled` stops a re-announcement of an identity we
 * already know about. A failure counts as settled, so a rejected bootstrap is not
 * quietly retried on the next tab focus — the person presses **Try again**.
 */
interface BootstrapGuard {
  identity: string;
  state: 'pending' | 'settled';
}

/**
 * Development-only tracing, safe by construction: it can only ever print an event
 * name and a truncated user id. No token, no email, no password passes through here.
 *
 * `console.info`, not `console.debug`. `console.debug` writes at Chrome's **Verbose**
 * level, which the console's default filter hides — so every line below was being
 * emitted and then dropped by the browser, which made a working auth flow look like a
 * silent one.
 *
 * The `DEV` guard means none of this survives `vite build`: in a production bundle
 * `import.meta.env.DEV` is the literal `false`, so the body is eliminated and the
 * calls minified away entirely. To watch the flow, run `npm run dev`. Anything
 * serving `dist/` — `npm run preview` included — prints nothing here however badly
 * the bootstrap goes.
 */
function trace(message: string, identity?: string): void {
  if (!import.meta.env.DEV) return;
  const who = identity ? `${identity.slice(0, 8)}…` : 'none';
  console.info(`[AUTH] ${message} user=${who}`);
}

/**
 * Supabase's messages are written for developers. These are the ones a person can
 * act on; anything unrecognised falls through to the original, which is still better
 * than a generic apology that hides what happened.
 */
function describeSignInFailure(message: string): string {
  const text = message.toLowerCase();
  if (text.includes('invalid login credentials')) {
    return 'That email and password do not match an account.';
  }
  if (text.includes('email not confirmed')) {
    return 'This account still needs its email confirmed. Check your inbox.';
  }
  if (text.includes('rate limit') || text.includes('too many')) {
    return 'Too many attempts just now. Wait a minute and try again.';
  }
  if (text.includes('fetch') || text.includes('network')) {
    return 'Could not reach the authentication service. Check your connection.';
  }
  return message;
}

export function AuthProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<AuraUser | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  /**
   * A ref, not state, for two reasons: it must be readable and writable
   * synchronously — two events can arrive in the same tick, and a state update
   * scheduled by the first would not be visible to the second — and it must survive
   * StrictMode's remount, which resets state but keeps refs.
   */
  const guard = useRef<BootstrapGuard | null>(null);

  /**
   * The identity of the newest session seen. An in-flight bootstrap checks this
   * after awaiting, so a stale response cannot overwrite a newer sign-in. This is
   * the identity check that replaces the usual "is the component still mounted"
   * boolean, which says nothing about whether the answer is still the right one.
   */
  const currentIdentity = useRef<string | null>(null);

  const bootstrap = useCallback(async (next: Session): Promise<void> => {
    const identity = next.user.id;

    if (guard.current?.identity === identity) {
      trace(`bootstrap skipped duplicate (${guard.current.state})`, identity);
      return;
    }

    guard.current = { identity, state: 'pending' };
    trace('bootstrap start', identity);
    setStatus('connecting');
    setProblem(null);

    try {
      const { user: auraUser } = await exchangeSession(next.access_token);
      if (currentIdentity.current !== identity) {
        // A newer session landed while this was in flight, so this answer is about
        // someone else. Whichever event superseded it owns `status` and `guard` now.
        trace('bootstrap abandoned, identity moved on', identity);
        return;
      }

      guard.current = { identity, state: 'settled' };
      setUser(auraUser);
      setStatus('signed-in');
      trace('bootstrap success', identity);
    } catch (error) {
      if (currentIdentity.current !== identity) {
        trace('bootstrap abandoned, identity moved on', identity);
        return;
      }

      guard.current = { identity, state: 'settled' };
      setUser(null);
      trace('bootstrap failed', identity);

      if (error instanceof ApiError && error.isUnauthenticated) {
        // Supabase issued it and AURA refused it. Holding on to the session would
        // only produce the same 401 on every later call, so end it here. Safe to
        // call back into Supabase because this runs outside its event callback.
        setProblem('Your session is no longer valid. Please sign in again.');
        await getSupabase().auth.signOut();
        return;
      }

      setProblem(
        error instanceof NetworkError
          ? error.message
          : error instanceof ApiError
            ? `The AURA server could not start your session (${error.code}).`
            : 'Something went wrong starting your session.',
      );
      setStatus('blocked');
    }
  }, []);

  useEffect(() => {
    const supabase = getSupabase();
    trace('subscribed to Supabase auth');

    const handle = (event: AuthChangeEvent, next: Session | null): void => {
      trace(`event=${event}`, next?.user.id);
      currentIdentity.current = next?.user.id ?? null;
      setSession(next);

      if (!next) {
        // A sign-out clears the guard, so signing back in — even as the same
        // person — bootstraps again, as it must.
        guard.current = null;
        setUser(null);
        setProblem(null);
        setStatus('signed-out');
        return;
      }

      void bootstrap(next);
    };

    // Fires immediately with INITIAL_SESSION, which is how a refreshed page gets its
    // session back — so this one subscription covers both restore and every change.
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, next) => {
      /**
       * Deferred out of the callback deliberately. Supabase runs subscribers while
       * holding its auth lock, and calling back into the client from inside — which
       * the 401 path does, via `signOut()` — can deadlock. A macrotask is the
       * documented way out.
       */
      setTimeout(() => handle(event, next), 0);
    });

    return () => subscription.unsubscribe();
  }, [bootstrap]);

  const signIn = useCallback(async (email: string, password: string): Promise<void> => {
    const { error } = await getSupabase().auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    // Nothing is stored, logged or kept here. On success `onAuthStateChange` fires
    // with SIGNED_IN and the subscription above takes it from there.
    if (error) throw new Error(describeSignInFailure(error.message));
  }, []);

  const signOut = useCallback(async (): Promise<void> => {
    try {
      // Ask the backend first, while the token is still valid: this is what revokes
      // the refresh token at Supabase. A failure here must not strand the user in a
      // signed-in UI, so it is deliberately swallowed.
      await endSession();
    } catch {
      /* best effort */
    }
    await getSupabase().auth.signOut();
  }, []);

  /**
   * The one path that re-attempts a settled failure. Nothing does this on a timer or
   * in response to an event: a backend that is down, or a rate limit that has been
   * hit, must not be hammered by a client that keeps hoping.
   */
  const retry = useCallback(() => {
    guard.current = null;
    void (async () => {
      const { data } = await getSupabase().auth.getSession();
      if (data.session) {
        currentIdentity.current = data.session.user.id;
        await bootstrap(data.session);
      } else {
        setStatus('signed-out');
      }
    })();
  }, [bootstrap]);

  const value = useMemo<AuthState>(
    () => ({ status, session, user, problem, signIn, signOut, retry }),
    [status, session, user, problem, signIn, signOut, retry],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside an AuthProvider');
  return context;
}
