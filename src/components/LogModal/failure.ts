import { NetworkError } from '../../lib/api';
import { formatWait } from '../../lib/insights';
import type { RequestError } from './state';

/**
 * The server's own wording wherever it is written for a person — which, for the photo
 * failures (413, 415), it is: "The image is larger than the upload limit" needs no
 * help. Only the rate limit is rewritten, because "try again later" is not useful
 * advice when the photo bucket is twenty a day and the server said exactly how long.
 */
export function describeFailure(error: RequestError): string {
  if (error instanceof NetworkError) return error.message;
  if (error.status === 429) {
    const wait = formatWait(error.retryAfterSeconds);
    return wait
      ? `Too many requests. You can try again in about ${wait}.`
      : 'Too many requests. Please try again later.';
  }
  return error.message;
}
