import { afterEach, describe, expect, it, vi } from 'vitest';
import { SubmissionKey, newIdempotencyKey } from './idempotency';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('newIdempotencyKey', () => {
  it('is a fresh random UUID each time', () => {
    const a = newIdempotencyKey();
    expect(a).toMatch(UUID_V4);
    expect(newIdempotencyKey()).not.toBe(a);
  });

  it('still works where randomUUID does not exist (plain-HTTP dev servers)', () => {
    const real = globalThis.crypto;
    vi.stubGlobal('crypto', { getRandomValues: real.getRandomValues.bind(real) });
    expect(globalThis.crypto.randomUUID).toBeUndefined();
    expect(newIdempotencyKey()).toMatch(UUID_V4);
  });
});

describe('SubmissionKey', () => {
  it('keeps one key for every attempt at the same request', () => {
    const submission = new SubmissionKey();
    const first = submission.for({ type: 'water', metrics: { ml: 250 } });
    expect(submission.for({ type: 'water', metrics: { ml: 250 } })).toBe(first);
  });

  it('takes a new key when the request changes — a corrected amount is a new action', () => {
    const submission = new SubmissionKey();
    const first = submission.for({ ml: 250 });
    expect(submission.for({ ml: 500 })).not.toBe(first);
  });

  it('takes a new key after a success, even for an identical request', () => {
    const submission = new SubmissionKey();
    const first = submission.for({ ml: 250 });
    submission.done();
    expect(submission.for({ ml: 250 })).not.toBe(first);
  });
});
