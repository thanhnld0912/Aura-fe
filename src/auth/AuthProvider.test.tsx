import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AuthChangeEvent, Session } from '@supabase/supabase-js';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider, useAuth } from './AuthProvider';

/**
 * The auth flow, exercised through the behaviour a user would see.
 *
 * Supabase is replaced by a fake that emits the same events in the same order the
 * real client does — `INITIAL_SESSION` on subscribe, `SIGNED_IN` after a password
 * sign-in, `TOKEN_REFRESHED` on renewal, `SIGNED_OUT` on sign-out. That is the whole
 * contract this provider depends on, so faking it is faking an interface rather than
 * assuming an implementation.
 */

interface FakeAuth {
  emit: (event: AuthChangeEvent, session: Session | null) => void;
  signInWithPassword: ReturnType<typeof vi.fn>;
  signOut: ReturnType<typeof vi.fn>;
  setSession: (session: Session | null) => void;
  getSession: () => Promise<{ data: { session: Session | null } }>;
}

const fake = vi.hoisted(() => ({ current: null as unknown as FakeAuth }));

vi.mock('../lib/supabase', () => ({
  getSupabase: () => ({ auth: fake.current }),
  getAccessToken: async () => 'a.supabase.jwt',
}));

function sessionFor(userId: string, token = 'a.supabase.jwt'): Session {
  return {
    access_token: token,
    refresh_token: 'refresh',
    expires_in: 3600,
    token_type: 'bearer',
    user: { id: userId, email: 'thanh@example.com' },
  } as unknown as Session;
}

function createFakeAuth(initial: Session | null): FakeAuth {
  const listeners: Array<(event: AuthChangeEvent, session: Session | null) => void> = [];
  let session = initial;

  const auth = {
    onAuthStateChange(callback: (event: AuthChangeEvent, session: Session | null) => void) {
      listeners.push(callback);
      // The real client delivers INITIAL_SESSION asynchronously, after reading storage.
      setTimeout(() => callback('INITIAL_SESSION', session), 0);
      return { data: { subscription: { unsubscribe: () => listeners.splice(0, listeners.length) } } };
    },
    emit(event: AuthChangeEvent, next: Session | null) {
      session = next;
      for (const listener of [...listeners]) listener(event, next);
    },
    setSession(next: Session | null) {
      session = next;
    },
    // The retry path asks Supabase for the current session rather than trusting a
    // captured one, so the fake has to answer.
    async getSession() {
      return { data: { session }, error: null };
    },
    signInWithPassword: vi.fn(async ({ email }: { email: string; password: string }) => {
      if (email !== 'thanh@example.com') {
        return { data: { session: null }, error: { message: 'Invalid login credentials' } };
      }
      const next = sessionFor('user-1');
      setTimeout(() => auth.emit('SIGNED_IN', next), 0);
      return { data: { session: next }, error: null };
    }),
    signOut: vi.fn(async () => {
      setTimeout(() => auth.emit('SIGNED_OUT', null), 0);
      return { error: null };
    }),
  };

  return auth as unknown as FakeAuth;
}

const auraUser = {
  id: 'user-1',
  email: 'thanh@example.com',
  displayName: 'Thanh',
  avatarUrl: null,
  timezone: 'Asia/Ho_Chi_Minh',
  locale: 'vi',
  dateOfBirth: null,
  streakDays: 5,
  createdAt: '2026-01-01T00:00:00.000Z',
};

const fetchMock = vi.fn();

/** Shows the pieces of auth state a test needs to assert on. */
const Probe: React.FC = () => {
  const { status, user, problem, signOut, retry } = useAuth();
  return (
    <div>
      <span data-testid="status">{status}</span>
      <span data-testid="user">{user?.email ?? 'none'}</span>
      <span data-testid="problem">{problem ?? ''}</span>
      <button type="button" onClick={() => void signOut()}>
        Sign out
      </button>
      <button type="button" onClick={retry}>
        Retry
      </button>
    </div>
  );
};

const SignInForm: React.FC = () => {
  const { signIn } = useAuth();
  const [error, setError] = React.useState('');
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        void signIn(String(data.get('email')), String(data.get('password'))).catch(
          (failure: Error) => setError(failure.message),
        );
      }}
    >
      <input aria-label="Email" name="email" defaultValue="thanh@example.com" />
      <input aria-label="Password" name="password" type="password" defaultValue="correct" />
      <button type="submit">Sign in</button>
      <span data-testid="form-error">{error}</span>
    </form>
  );
};

function renderAuth(initial: Session | null = null): void {
  fake.current = createFakeAuth(initial);
  render(
    <AuthProvider>
      <Probe />
      <SignInForm />
    </AuthProvider>,
  );
}

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(
    new Response(JSON.stringify({ user: { ...auraUser, isNewUser: false } }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('signing in', () => {
  it('ends signed out when Supabase has no stored session', async () => {
    renderAuth(null);
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('signed-out'));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('exchanges the Supabase token for the AURA user on a successful sign-in', async () => {
    renderAuth(null);
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('signed-out'));

    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('signed-in'));
    expect(screen.getByTestId('user')).toHaveTextContent('thanh@example.com');

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://localhost:3001/api/auth/session');
    expect(JSON.parse(init.body as string)).toEqual({ accessToken: 'a.supabase.jwt' });
  });

  it('surfaces a wrong password as a readable message and stays signed out', async () => {
    renderAuth(null);
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('signed-out'));

    await userEvent.clear(screen.getByLabelText('Email'));
    await userEvent.type(screen.getByLabelText('Email'), 'someone@else.test');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    await waitFor(() =>
      expect(screen.getByTestId('form-error')).toHaveTextContent(
        'That email and password do not match an account.',
      ),
    );
    expect(screen.getByTestId('status')).toHaveTextContent('signed-out');
  });
});

describe('restoring a session', () => {
  /** A page refresh: the session comes back from storage as INITIAL_SESSION. */
  it('restores the AURA user without asking anyone to sign in again', async () => {
    renderAuth(sessionFor('user-1'));

    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('signed-in'));
    expect(screen.getByTestId('user')).toHaveTextContent('thanh@example.com');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not re-bootstrap when the token is merely refreshed', async () => {
    renderAuth(sessionFor('user-1'));
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('signed-in'));

    fake.current.emit('TOKEN_REFRESHED', sessionFor('user-1', 'a.newer.jwt'));

    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('signed-in'));
    // Still the one call from the initial restore: the API client reads the token per
    // request, so a new token needs no round trip.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('signs out when the backend rejects an otherwise valid Supabase session', async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({ error: { code: 'UNAUTHENTICATED', message: 'Authentication required' } }),
        { status: 401, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    renderAuth(sessionFor('user-1'));

    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('signed-out'));
    expect(fake.current.signOut).toHaveBeenCalled();
  });

  it('reports an unreachable backend without discarding the session', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));

    renderAuth(sessionFor('user-1'));

    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('blocked'));
    expect(screen.getByTestId('problem')).toHaveTextContent('Could not reach the AURA server');
    expect(fake.current.signOut).not.toHaveBeenCalled();
  });
});

describe('signing out', () => {
  it('revokes at the backend, then ends the Supabase session', async () => {
    renderAuth(sessionFor('user-1'));
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('signed-in'));

    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));

    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('signed-out'));
    expect(screen.getByTestId('user')).toHaveTextContent('none');
    expect(fake.current.signOut).toHaveBeenCalled();

    // The backend is told first, while the token is still good — that is what revokes
    // the refresh token at Supabase.
    const [url, init] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(url).toBe('http://localhost:3001/api/auth/logout');
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer a.supabase.jwt');
  });

  it('still signs out locally when the backend call fails', async () => {
    renderAuth(sessionFor('user-1'));
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('signed-in'));

    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));

    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('signed-out'));
    expect(fake.current.signOut).toHaveBeenCalled();
  });
});

/**
 * The bootstrap must happen once per identity, no matter how many times Supabase
 * announces that identity.
 *
 * This is not hypothetical. `GoTrueClient._onVisibilityChanged` calls
 * `_recoverAndRefresh()` every time the tab goes from hidden to visible, and that
 * path ends in an unconditional `_notifyAllSubscribers('SIGNED_IN', currentSession)`
 * — the same session, re-announced. A tab switched to a few dozen times emits a few
 * dozen SIGNED_IN events, and `POST /api/auth/session` is rate limited to 10 per
 * 15 minutes per IP.
 */
describe('bootstrapping exactly once per identity', () => {
  const sessionCalls = (): number =>
    fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/auth/session')).length;

  it('ignores a SIGNED_IN that re-announces an identity already bootstrapped', async () => {
    renderAuth(sessionFor('user-1'));
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('signed-in'));

    // Twelve tab focuses. Before the fix this produced twelve POSTs and a 429.
    for (let i = 0; i < 12; i += 1) {
      fake.current.emit('SIGNED_IN', sessionFor('user-1'));
    }

    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('signed-in'));
    expect(sessionCalls()).toBe(1);
  });

  it('treats INITIAL_SESSION followed by SIGNED_IN as one arrival', async () => {
    renderAuth(sessionFor('user-1'));
    // The race that matters: SIGNED_IN lands while the INITIAL_SESSION bootstrap is
    // still in flight, so a "have I finished?" check would let it through.
    fake.current.emit('SIGNED_IN', sessionFor('user-1'));

    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('signed-in'));
    expect(sessionCalls()).toBe(1);
  });

  it('collapses simultaneous events for one identity into a single request', async () => {
    renderAuth(null);
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('signed-out'));

    const session = sessionFor('user-2');
    fake.current.emit('SIGNED_IN', session);
    fake.current.emit('TOKEN_REFRESHED', session);
    fake.current.emit('SIGNED_IN', session);
    fake.current.emit('INITIAL_SESSION', session);

    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('signed-in'));
    expect(sessionCalls()).toBe(1);
  });

  it('bootstraps again when the identity genuinely changes', async () => {
    renderAuth(sessionFor('user-1'));
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('signed-in'));

    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({ user: { ...auraUser, id: 'user-2', email: 'other@example.com' } }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    fake.current.emit('SIGNED_IN', sessionFor('user-2'));

    await waitFor(() => expect(screen.getByTestId('user')).toHaveTextContent('other@example.com'));
    expect(sessionCalls()).toBe(2);
  });

  it('is unmoved by a re-render', async () => {
    fake.current = createFakeAuth(sessionFor('user-1'));
    const { rerender } = render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('signed-in'));

    for (let i = 0; i < 5; i += 1) {
      rerender(
        <AuthProvider>
          <Probe />
        </AuthProvider>,
      );
    }

    expect(sessionCalls()).toBe(1);
  });

  /**
   * StrictMode mounts, unmounts and remounts every component in development. Refs
   * survive that, which is why the guard lives in one — a guard held in state would
   * be reset by the remount and let the second mount through.
   */
  it('survives StrictMode double mounting without a duplicate request', async () => {
    fake.current = createFakeAuth(sessionFor('user-1'));
    render(
      <React.StrictMode>
        <AuthProvider>
          <Probe />
        </AuthProvider>
      </React.StrictMode>,
    );

    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('signed-in'));
    expect(sessionCalls()).toBe(1);
  });

  it('sends nothing at all while signed out', async () => {
    renderAuth(null);
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('signed-out'));

    fake.current.emit('SIGNED_OUT', null);
    fake.current.emit('SIGNED_OUT', null);

    expect(sessionCalls()).toBe(0);
  });
});

describe('when the backend refuses the bootstrap', () => {
  const sessionCalls = (): number =>
    fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/auth/session')).length;

  const rateLimited = (): Response =>
    new Response(
      JSON.stringify({ error: { code: 'RATE_LIMITED', message: 'Too many requests' } }),
      { status: 429, headers: { 'Content-Type': 'application/json' } },
    );

  it('does not retry a rate limit by itself, which is what caused the pile-up', async () => {
    fetchMock.mockResolvedValue(rateLimited());
    renderAuth(sessionFor('user-1'));

    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('blocked'));
    expect(sessionCalls()).toBe(1);

    // Further events for the same identity must not turn a 429 into a retry storm.
    for (let i = 0; i < 8; i += 1) fake.current.emit('SIGNED_IN', sessionFor('user-1'));

    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('blocked'));
    expect(sessionCalls()).toBe(1);
  });

  it('retries only when a person asks it to', async () => {
    fetchMock.mockResolvedValue(rateLimited());
    renderAuth(sessionFor('user-1'));
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('blocked'));

    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ user: { ...auraUser, isNewUser: false } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));

    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('signed-in'));
    expect(sessionCalls()).toBe(2);
  });

  it('does not loop when the server is simply unreachable', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    renderAuth(sessionFor('user-1'));

    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('blocked'));
    for (let i = 0; i < 5; i += 1) fake.current.emit('SIGNED_IN', sessionFor('user-1'));

    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('blocked'));
    expect(sessionCalls()).toBe(1);
  });
});
