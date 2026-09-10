import { getConfig } from './config';
import type {
  AuraUser,
  CalculationResult,
  CreateMealInput,
  ErrorDetail,
  ErrorEnvelope,
  Food,
  Meal,
  MealItemInput,
  MealType,
  ParsedMealResult,
  SessionResponse,
} from './contract';
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

/**
 * A failed response, as far as we are willing to assume.
 *
 * Every field optional, deliberately. `ErrorEnvelope` describes what the API sends;
 * this describes what arrived, which is not the same claim — a proxy, a gateway or a
 * truncated body can produce a 502 whose payload has no `error` key at all. Reading
 * that through the strict type would let `envelope.error.code` typecheck and then
 * throw at runtime, so the parse keeps its own view and the caller falls back.
 *
 * Derived rather than re-listed: a field added to the contract shows up here without
 * anyone remembering to copy it.
 */
type ErrorPayload = { error?: Partial<ErrorEnvelope['error']> };

export interface ApiErrorContext {
  /** Quote this when reporting a problem — it finds the request in the server log. */
  requestId?: string | undefined;
  /** Per-field problems from a 400, so a form can mark the offending input. */
  details?: ErrorDetail[] | undefined;
  /** Seconds from the `Retry-After` header on a 429. Advice to show, never to act on. */
  retryAfterSeconds?: number | undefined;
}

export class ApiError extends Error {
  readonly requestId: string | undefined;
  readonly details: ErrorDetail[] | undefined;
  readonly retryAfterSeconds: number | undefined;

  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    context: ApiErrorContext = {},
  ) {
    super(message);
    this.name = 'ApiError';
    this.requestId = context.requestId;
    this.details = context.details;
    this.retryAfterSeconds = context.retryAfterSeconds;
  }

  /** A 401 means the session is gone or was never valid; the caller signs out. */
  get isUnauthenticated(): boolean {
    return this.status === 401;
  }

  /** The first problem reported for a field, if the server named one. */
  detailFor(path: string): string | undefined {
    return this.details?.find((detail) => detail.path === path)?.issue;
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

/**
 * The backend contract.
 *
 * Re-exported from `contract.ts`, which projects these out of the OpenAPI types
 * generated from AURA-BE's Zod schemas (`ARCHITECTURE.md` §10, Option B). They used
 * to be declared here by hand; callers import them from the same place either way,
 * so nothing downstream had to move.
 *
 * The error envelope is now among them: the backend documents it as a component, so
 * `ErrorDetail` is generated rather than transcribed. What stays hand-written above is
 * the *runtime* — `ApiError`, `NetworkError`, `ApiErrorContext`, `RequestOptions` —
 * which is behaviour, not contract, and has no counterpart in an OpenAPI document.
 */
export type {
  AuraUser,
  CalculatedItem,
  CalculationResult,
  ConfidenceBand,
  CreateMealInput,
  ErrorCode,
  ErrorDetail,
  ErrorEnvelope,
  Food,
  FoodPortion,
  Meal,
  MealItem,
  MealItemInput,
  MealStatus,
  MealType,
  MealUnit,
  Nutrients,
  ParsedMealResult,
  SessionResponse,
  SizeLabel,
  UpdateMealInput,
} from './contract';
export { MEAL_UNITS, SIZE_LABELS } from './contract';

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

  /** `Retry-After` is in the CORS expose list, so the browser lets us read it. */
  const retryAfterOf = (response: Response): number | undefined => {
    const header = response.headers.get('retry-after');
    if (!header) return undefined;
    const seconds = Number(header);
    return Number.isFinite(seconds) ? seconds : undefined;
  };

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
    const envelope = (payload ?? {}) as ErrorPayload;
    throw new ApiError(
      envelope.error?.message ?? `Request failed (${response.status}).`,
      response.status,
      envelope.error?.code ?? 'UNKNOWN',
      {
        requestId: envelope.error?.requestId,
        details: envelope.error?.details,
        retryAfterSeconds: retryAfterOf(response),
      },
    );
  }

  return payload as T;
}

// ── The endpoints the auth flow needs ──────────────────────────────────────────

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

// ── Meals ──────────────────────────────────────────────────────────────────────

/**
 * The meals the server considers to be today's.
 *
 * Called without a `date`, deliberately. "Today" is a question about the user's
 * calendar, and the server answers it from the timezone on their profile; a browser
 * computing its own local date would file a 00:30 meal under the wrong day for anyone
 * travelling, and would disagree with every total the backend has already stored.
 */
export async function fetchTodayMeals(): Promise<Meal[]> {
  const { data } = await apiRequest<{ data: Meal[] }>('/meals/today');
  return data;
}

// ── Food search and nutrition calculation ──────────────────────────────────────

/**
 * Food search. Unauthenticated by design — food data is public reference material,
 * not user content — but it still goes through `apiRequest` so there is exactly one
 * place that talks to the API.
 */
export async function searchFoods(
  query: string,
  options: { limit?: number; signal?: AbortSignal } = {},
): Promise<Food[]> {
  const params = new URLSearchParams({ q: query });
  if (options.limit !== undefined) params.set('limit', String(options.limit));

  const { data } = await apiRequest<{ data: Food[] }>(`/nutrition/search?${params.toString()}`, {
    authenticated: false,
    ...(options.signal ? { signal: options.signal } : {}),
  });
  return data;
}

/**
 * Resolve and calculate without persisting.
 *
 * Runs the *same* resolver as saving, so what the review screen shows cannot disagree
 * with what gets stored. Display the result verbatim.
 */
export async function calculateNutrition(
  items: MealItemInput[],
  options: { signal?: AbortSignal } = {},
): Promise<CalculationResult> {
  return apiRequest<CalculationResult>('/nutrition/calculate', {
    method: 'POST',
    body: { items },
    ...(options.signal ? { signal: options.signal } : {}),
  });
}

// ── Writing meals ──────────────────────────────────────────────────────────────

/** Creates a meal. `confirmed` also creates the timeline event; `draft` does not. */
export async function createMeal(input: CreateMealInput): Promise<Meal> {
  return apiRequest<Meal>('/meals', { method: 'POST', body: input });
}

/**
 * Natural language to a reviewable **draft**, never straight to a logged meal.
 *
 * The parser behind this is deterministic and runs on the server; Phase 4 replaces
 * the implementation behind the same interface, so this contract does not move. The
 * frontend never calls a model provider.
 */
export async function parseMeal(text: string, mealType: MealType): Promise<ParsedMealResult> {
  return apiRequest<ParsedMealResult>('/meals/parse', {
    method: 'POST',
    body: { text, mealType },
  });
}

/** Replaces a meal's items. Re-resolves, and teaches the resolver what the user meant. */
export async function updateMeal(mealId: string, items: MealItemInput[]): Promise<Meal> {
  return apiRequest<Meal>(`/meals/${mealId}`, { method: 'PATCH', body: { items } });
}

/** Promotes a draft to a logged meal, which is what creates its timeline event. */
export async function confirmMeal(mealId: string): Promise<Meal> {
  return apiRequest<Meal>(`/meals/${mealId}/confirm`, { method: 'POST' });
}
