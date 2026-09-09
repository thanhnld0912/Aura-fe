import { getConfig } from './config';
import { getAccessToken } from './supabase';

/**
 * The AURA API client.
 *
 * Every authenticated call attaches `Authorization: Bearer <supabase access token>`,
 * taken from the Supabase client at the moment of the call rather than from a copy
 * held somewhere. That is the whole design: there is one source of truth for the
 * token, it refreshes itself, and no code path exists in which a token is pasted in
 * by hand or read out of a bespoke localStorage key that nothing keeps up to date.
 *
 * The frontend never verifies a JWT and never reaches PostgreSQL. It presents the
 * token; the backend decides what it means.
 */

/** The error envelope every AURA endpoint returns (API_DESIGN.md §1). */
interface ErrorEnvelope {
  error?: { code?: string; message?: string; requestId?: string };
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    /** Quote this when reporting a problem — it finds the request in the server log. */
    readonly requestId?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  /** A 401 means the session is gone or was never valid; the caller signs out. */
  get isUnauthenticated(): boolean {
    return this.status === 401;
  }
}

/** Raised when the request never reached the server at all. */
export class NetworkError extends Error {
  constructor(cause: unknown) {
    super('Could not reach the AURA server. Is it running on the expected port?');
    this.name = 'NetworkError';
    this.cause = cause;
  }
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  /** The bootstrap call sends its token in the body and needs no header. */
  authenticated?: boolean;
  signal?: AbortSignal;
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, authenticated = true, signal } = options;

  const headers: Record<string, string> = { 'X-AURA-Version': '1' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  if (authenticated) {
    const token = await getAccessToken();
    // No session, so do not bother the server: the answer is already known, and a
    // request without the header produces a 401 that looks like a server problem.
    if (!token) throw new ApiError('You are signed out.', 401, 'UNAUTHENTICATED');
    headers['Authorization'] = `Bearer ${token}`;
  }

  let response: Response;
  try {
    response = await fetch(`${getConfig().apiBaseUrl}${path}`, {
      method,
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      ...(signal ? { signal } : {}),
    });
  } catch (cause) {
    throw new NetworkError(cause);
  }

  if (response.status === 204) return undefined as T;

  const payload: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    const envelope = (payload ?? {}) as ErrorEnvelope;
    throw new ApiError(
      envelope.error?.message ?? `Request failed (${response.status}).`,
      response.status,
      envelope.error?.code ?? 'UNKNOWN',
      envelope.error?.requestId,
    );
  }

  return payload as T;
}

// ── The endpoints the auth flow needs ──────────────────────────────────────────

/** The AURA user, as `POST /api/auth/session` and `GET /api/users/me` return it. */
export interface AuraUser {
  id: string;
  email: string;
  displayName: string | null;
  avatarUrl: string | null;
  timezone: string;
  locale: string;
  dateOfBirth: string | null;
  streakDays: number;
  createdAt: string;
}

export interface SessionResponse {
  user: AuraUser & { isNewUser: boolean };
}

/**
 * The bootstrap. Exchanges a verified Supabase token for the AURA identity, creating
 * the user row on first contact.
 *
 * `authenticated: false` is not a weakening — the token is in the body, and the
 * server verifies it exactly as strictly as it verifies a header. It has to work
 * without an AURA session, because obtaining one is what it does.
 */
export async function exchangeSession(accessToken: string): Promise<SessionResponse> {
  return apiRequest<SessionResponse>('/auth/session', {
    method: 'POST',
    body: { accessToken },
    authenticated: false,
  });
}

export async function fetchCurrentUser(): Promise<{ user: AuraUser }> {
  return apiRequest<{ user: AuraUser }>('/users/me');
}

/** Revokes the refresh token server-side. Best-effort: see AuthProvider.signOut. */
export async function endSession(): Promise<void> {
  await apiRequest<void>('/auth/logout', { method: 'POST' });
}
