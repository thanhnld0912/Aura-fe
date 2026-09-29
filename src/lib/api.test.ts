import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, NetworkError, apiRequest, exchangeSession, fetchEvents, fetchWeeklyReport, requestWeeklyStory, type EventPage } from './api';
import { insufficientWeek, storyResult, sufficientWeek } from '../test/weekly';

/**
 * What the API client must get right: the token is attached automatically, it comes
 * from Supabase rather than from anywhere the user could paste it, and the bootstrap
 * call deliberately does not use it.
 */

const { getAccessToken } = vi.hoisted(() => ({ getAccessToken: vi.fn() }));
vi.mock('./supabase', () => ({ getAccessToken }));

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
  getAccessToken.mockReset();
  getAccessToken.mockResolvedValue('a.supabase.jwt');
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('apiRequest', () => {
  it('attaches the current Supabase token as a bearer credential', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { user: { id: 'u1' } }));

    await apiRequest('/users/me');

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://localhost:3001/api/users/me');
    expect((init.headers as Record<string, string>)['Authorization']).toBe(
      'Bearer a.supabase.jwt',
    );
  });

  /**
   * The token is read per request rather than captured once, which is what makes a
   * silent refresh invisible to every caller.
   */
  it('asks Supabase again on the next call, so a refreshed token is used', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, {}));

    await apiRequest('/users/me');
    getAccessToken.mockResolvedValue('a.refreshed.jwt');
    await apiRequest('/users/me');

    const second = fetchMock.mock.calls[1]?.[1] as RequestInit;
    expect((second.headers as Record<string, string>)['Authorization']).toBe(
      'Bearer a.refreshed.jwt',
    );
  });

  it('does not call the server at all when there is no session', async () => {
    getAccessToken.mockResolvedValue(null);

    await expect(apiRequest('/users/me')).rejects.toBeInstanceOf(ApiError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('unwraps the AURA error envelope, keeping the request id', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(401, {
        error: { code: 'UNAUTHENTICATED', message: 'Authentication required', requestId: '01JB' },
      }),
    );

    const failure = await apiRequest('/users/me').catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ApiError);
    expect(failure).toMatchObject({
      status: 401,
      code: 'UNAUTHENTICATED',
      requestId: '01JB',
      isUnauthenticated: true,
    });
  });

  it('reports a 500 as a server failure rather than a sign-out', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(500, { error: { code: 'INTERNAL_ERROR', message: 'An error occurred' } }),
    );

    const failure = (await apiRequest('/users/me').catch((e: unknown) => e)) as ApiError;
    expect(failure.status).toBe(500);
    expect(failure.isUnauthenticated).toBe(false);
  });

  it('distinguishes an unreachable server from a rejected request', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(apiRequest('/users/me')).rejects.toBeInstanceOf(NetworkError);
  });

  it('returns nothing for a 204 instead of trying to parse a body', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    await expect(apiRequest('/auth/logout', { method: 'POST' })).resolves.toBeUndefined();
  });
});

describe('exchangeSession', () => {
  it('sends the token in the body and no Authorization header', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { user: { id: 'u1', isNewUser: true } }));

    await exchangeSession('a.supabase.jwt');

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://localhost:3001/api/auth/session');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ accessToken: 'a.supabase.jwt' });
    expect((init.headers as Record<string, string>)['Authorization']).toBeUndefined();
    // The bootstrap must not depend on already having a session.
    expect(getAccessToken).not.toHaveBeenCalled();
  });
});

describe('fetchEvents', () => {
  const page: EventPage = { data: [], nextCursor: 'MjAyNi0wOS0yOFQxNTo0NToz+/=' };

  it('asks for the first page with no parameters, authenticated, and returns the page as sent', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, page));

    await expect(fetchEvents()).resolves.toEqual(page);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://localhost:3001/api/events');
    expect(init.method).toBe('GET');
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer a.supabase.jwt');
  });

  it('sends the cursor back exactly as received, and nothing else', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { data: [], nextCursor: null }));

    await fetchEvents({ cursor: page.nextCursor! });

    const url = new URL(fetchMock.mock.calls[0]![0] as string);
    expect(url.pathname).toBe('/api/events');
    expect([...url.searchParams.keys()]).toEqual(['cursor']);
    expect(url.searchParams.get('cursor')).toBe(page.nextCursor);
  });

  it('surfaces a server failure and a 401 once each, without retrying', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(500, { error: { code: 'INTERNAL_ERROR', message: 'Boom', requestId: '01E' } }),
    );
    await expect(fetchEvents()).rejects.toMatchObject({ status: 500, requestId: '01E' });

    fetchMock.mockResolvedValueOnce(
      jsonResponse(401, { error: { code: 'UNAUTHENTICATED', message: 'Authentication required', requestId: '01F' } }),
    );
    await expect(fetchEvents({ cursor: 'abc' })).rejects.toMatchObject({ status: 401, isUnauthenticated: true });

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('weekly insights', () => {
  it('asks for this week with no parameters, authenticated, and returns the report as sent', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, sufficientWeek()));

    await expect(fetchWeeklyReport()).resolves.toEqual(sufficientWeek());

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://localhost:3001/api/insights/weekly');
    expect(init.method).toBe('GET');
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer a.supabase.jwt');
  });

  it('returns an insufficient_data week as data, not as an error', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, insufficientWeek()));
    await expect(fetchWeeklyReport()).resolves.toMatchObject({ coverage: { status: 'insufficient_data' } });
  });

  it('requests the story by POST with an empty body — the server picks the week', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, storyResult('insufficient_data', insufficientWeek())));

    await expect(requestWeeklyStory()).resolves.toMatchObject({ status: 'insufficient_data', story: null });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://localhost:3001/api/insights/weekly/story');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({});
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer a.supabase.jwt');
  });

  it('surfaces a 401, a missing provider and the daily limit once each, without retrying', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(401, { error: { code: 'UNAUTHENTICATED', message: 'Authentication required', requestId: '01A' } }),
    );
    await expect(fetchWeeklyReport()).rejects.toMatchObject({ status: 401, isUnauthenticated: true });

    fetchMock.mockResolvedValueOnce(
      jsonResponse(503, { error: { code: 'PROVIDER_UNAVAILABLE', message: 'Weekly stories are not available right now', requestId: '01B' } }),
    );
    await expect(requestWeeklyStory()).rejects.toMatchObject({ status: 503, code: 'PROVIDER_UNAVAILABLE', requestId: '01B' });

    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: { code: 'RATE_LIMITED', message: 'Too many requests', requestId: '01C' } }), {
        status: 429,
        headers: { 'Content-Type': 'application/json', 'Retry-After': '7200' },
      }),
    );
    await expect(requestWeeklyStory()).rejects.toMatchObject({ status: 429, retryAfterSeconds: 7200 });

    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
