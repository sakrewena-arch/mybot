import { z } from 'zod';

/**
 * Telegram Stars handling.
 *
 * - Stars are always charged in the synthetic currency `XTR`.
 * - `sendPaidMedia` charges `star_count` Stars to unlock the media. The
 *   purchase confirmation arrives as the `purchased_paid_media` update with
 *   our custom `payload` echoed back — that payload is the ONLY proof we
 *   process. A button click is never treated as a payment.
 */

export const STARS_CURRENCY = 'XTR';
export const MIN_STARS = 1;
export const MAX_STARS = 25000;

/** Payload embedded in sendPaidMedia → echoed back in purchased_paid_media. */
const mediaPayloadSchema = z.object({ mediaId: z.number().int().positive() });

export function encodeMediaPayload(mediaId: number): string {
  return JSON.stringify({ mediaId });
}

export function decodeMediaPayload(payload: string): number | null {
  try {
    return mediaPayloadSchema.parse(JSON.parse(payload) as unknown).mediaId;
  } catch {
    return null;
  }
}

/** Payload for invoice-based purchases: "media:<id>". */
export function encodeInvoicePayload(mediaId: number): string {
  return `media:${mediaId}`;
}

export function decodeInvoicePayload(payload: string): number | null {
  const match = /^media:(\d+)$/.exec(payload);
  if (!match) return null;
  const id = Number(match[1]);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

export function isValidStarCount(value: number): boolean {
  return Number.isInteger(value) && value >= MIN_STARS && value <= MAX_STARS;
}