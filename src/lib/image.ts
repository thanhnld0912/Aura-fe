/**
 * What the photo endpoint accepts, checked before a request is spent on a file.
 *
 * Pure, and deliberately thin. This screens the two things the browser already knows
 * for certain — the declared type and the byte count — and nothing else. It does not
 * decode the image, measure it, or form any opinion about what is in it: the server
 * checks the bytes rather than the declared type, enforces the real dimension limit,
 * and is the only thing that decides whether a photo is usable.
 *
 * The point is not validation. It is that `POST /api/meals/analyze-image` sits in the
 * `ai-vision` bucket at **20 a day**, so a file that is certainly going to come back
 * 413 or 415 should not cost one of them.
 */

/** `MAX_UPLOAD_BYTES`, 8 MiB by default. Over this the server answers 413. */
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

/** The three the endpoint documents. Anything else is a 415. */
export const ACCEPTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

/** For the file input's `accept`, so the picker filters before anyone chooses. */
export const IMAGE_ACCEPT_ATTRIBUTE = ACCEPTED_IMAGE_TYPES.join(',');

/** The backend's cap on the optional hint (`analyzeImageFieldsSchema`). */
export const MAX_IMAGE_DESCRIPTION_LENGTH = 500;

/** "6.2 MB". One decimal, which is all anyone needs to see why a file was refused. */
export function formatFileSize(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  if (mb >= 0.1) return `${mb.toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/**
 * Why this file cannot be sent, or `null` when there is no reason it cannot.
 *
 * `null` is not a promise that the server will accept it — only that none of the two
 * things checkable here would stop it.
 */
export function imageProblem(file: File): string | null {
  if (!(ACCEPTED_IMAGE_TYPES as readonly string[]).includes(file.type)) {
    return 'That file is not a JPEG, PNG or WebP image.';
  }
  if (file.size > MAX_IMAGE_BYTES) {
    return `That photo is ${formatFileSize(file.size)}. The limit is ${formatFileSize(MAX_IMAGE_BYTES)}.`;
  }
  return null;
}
