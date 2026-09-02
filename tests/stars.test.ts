import { describe, it, expect } from 'vitest';
import {
  encodeMediaPayload,
  decodeMediaPayload,
  encodeInvoicePayload,
  decodeInvoicePayload,
  isValidStarCount,
  STARS_CURRENCY,
  MIN_STARS,
  MAX_STARS,
} from '../src/bot/payments/stars.js';

describe('stars payload', () => {
  it('round-trips the paid media payload', () => {
    const payload = encodeMediaPayload(42);
    expect(decodeMediaPayload(payload)).toBe(42);
  });

  it('returns null for a malformed payload', () => {
    expect(decodeMediaPayload('not-json')).toBeNull();
    expect(decodeMediaPayload('{"mediaId":"abc"}')).toBeNull();
    expect(decodeMediaPayload('{"foo":1}')).toBeNull();
  });

  it('round-trips the invoice payload', () => {
    expect(encodeInvoicePayload(7)).toBe('media:7');
    expect(decodeInvoicePayload('media:7')).toBe(7);
    expect(decodeInvoicePayload('media:0')).toBeNull();
    expect(decodeInvoicePayload('thing:7')).toBeNull();
  });

  it('validates star counts', () => {
    expect(isValidStarCount(MIN_STARS)).toBe(true);
    expect(isValidStarCount(MAX_STARS)).toBe(true);
    expect(isValidStarCount(0)).toBe(false);
    expect(isValidStarCount(MAX_STARS + 1)).toBe(false);
    expect(isValidStarCount(1.5)).toBe(false);
  });

  it('uses the XTR currency', () => {
    expect(STARS_CURRENCY).toBe('XTR');
  });
});