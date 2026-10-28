/**
 * `Idempotency-Key`s for the logging writes (API_DESIGN.md §1).
 *
 * The server keeps the first answer to a key for 24 hours and replays it for any retry
 * with the same key, so a request that went out but whose answer never came back can be
 * sent again without logging the thing twice.
 *
 * What makes it correct is which key goes with which request: the **same** key for every
 * attempt at one logical action, a **new** one for the next action. `SubmissionKey` holds
 * that rule — the key stays while the request's body is unchanged, and is dropped once a
 * save succeeds or the body changes (a corrected amount is a new action, and reusing the
 * key would earn a 409 for "same key, different request").
 */

export function newIdempotencyKey(): string {
  // `randomUUID` exists only in secure contexts; a LAN dev server over plain HTTP has
  // `getRandomValues` but not it.
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export class SubmissionKey {
  private current: { body: string; key: string } | null = null;

  /** The key for this body: the one already in use if the body is unchanged, else a new one. */
  for(body: unknown): string {
    const serialised = JSON.stringify(body);
    if (this.current?.body !== serialised) this.current = { body: serialised, key: newIdempotencyKey() };
    return this.current.key;
  }

  /** The action succeeded; the next save is a new one. */
  done(): void {
    this.current = null;
  }
}
