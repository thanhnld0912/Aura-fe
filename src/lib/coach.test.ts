import { describe, expect, it } from 'vitest';
import { ApiError, NetworkError } from './api';
import {
  AGENT_MESSAGE_MAX_LENGTH,
  describeChatFailure,
  isSendableMessage,
  sectionKindLabel,
} from './coach';

/**
 * The pure half of the Coach integration: what a failure is called, and what may be
 * sent. Every status asserted here is one AURA-BE can actually return for this route.
 */

const apiError = (
  status: number,
  options: { code?: string; message?: string; requestId?: string; retryAfterSeconds?: number } = {},
) =>
  new ApiError(options.message ?? 'Request failed.', status, options.code ?? 'UNKNOWN', {
    requestId: options.requestId,
    retryAfterSeconds: options.retryAfterSeconds,
  });

describe('describeChatFailure', () => {
  it('passes a network failure through with its own wording, and invites a retry', () => {
    const failure = describeChatFailure(new NetworkError(new Error('offline')));

    expect(failure.message).toContain('Could not reach the AURA server');
    expect(failure.retryable).toBe(true);
    expect(failure.wait).toBeNull();
    expect(failure.requestId).toBeUndefined();
  });

  it("keeps the server's own sentence for a 400 and does not offer a retry", () => {
    const failure = describeChatFailure(
      apiError(400, { code: 'VALIDATION_ERROR', message: 'message must be 2000 characters or fewer' }),
    );

    expect(failure.message).toBe('message must be 2000 characters or fewer');
    expect(failure.retryable).toBe(false);
  });

  it('explains a 401 without offering a retry, and never asks anyone to be signed out', () => {
    const failure = describeChatFailure(apiError(401, { code: 'UNAUTHENTICATED' }));

    expect(failure.message).toContain('Sign in again');
    expect(failure.retryable).toBe(false);
  });

  it('says a 422 reply was withheld by the server, and allows another attempt', () => {
    const failure = describeChatFailure(apiError(422, { code: 'AI_SCHEMA_ERROR' }));

    expect(failure.message).toContain("did not pass the server's checks");
    expect(failure.retryable).toBe(true);
  });

  it('turns a 429 Retry-After into words and keeps the retry available', () => {
    const failure = describeChatFailure(
      apiError(429, { code: 'RATE_LIMITED', retryAfterSeconds: 180, requestId: 'req-7' }),
    );

    expect(failure.message).toContain('chat limit');
    expect(failure.wait).toBe('3 min');
    expect(failure.requestId).toBe('req-7');
    expect(failure.retryable).toBe(true);
  });

  it('does not invite a retry on a 502, which the backend says would fail identically', () => {
    const failure = describeChatFailure(apiError(502, { code: 'PROVIDER_ERROR' }));

    expect(failure.message).toBe('The AI service could not complete this request.');
    expect(failure.retryable).toBe(false);
  });

  it('calls a 503 temporary and lets it be tried again', () => {
    const failure = describeChatFailure(apiError(503, { code: 'PROVIDER_UNAVAILABLE' }));

    expect(failure.message).toBe('The AI service is temporarily unavailable.');
    expect(failure.retryable).toBe(true);
  });

  it('carries the request id through whatever the status', () => {
    expect(describeChatFailure(apiError(500, { requestId: 'req-42' })).requestId).toBe('req-42');
  });
});

describe('isSendableMessage', () => {
  it('rejects empty and whitespace-only messages, which the server answers with a 400', () => {
    expect(isSendableMessage('')).toBe(false);
    expect(isSendableMessage('   \n ')).toBe(false);
  });

  it('accepts a message at the contract cap and rejects one past it', () => {
    expect(isSendableMessage('a'.repeat(AGENT_MESSAGE_MAX_LENGTH))).toBe(true);
    expect(isSendableMessage('a'.repeat(AGENT_MESSAGE_MAX_LENGTH + 1))).toBe(false);
  });

  it('judges length only — what a message is about is the backend\'s call', () => {
    expect(isSendableMessage('what is the capital of France')).toBe(true);
  });
});

describe('sectionKindLabel', () => {
  it('keeps the three section kinds distinguishable', () => {
    const labels = [sectionKindLabel('fact'), sectionKindLabel('interpretation'), sectionKindLabel('general')];
    expect(new Set(labels).size).toBe(3);
  });
});
