import { describe, it, expect } from 'vitest';
import {
  selectMediaToPropose,
  isCooldownElapsed,
  detectPhotoRequest,
} from '../src/media/selection.js';
import type { ActiveMedia } from '../src/media/selection.js';

const catalog: ActiveMedia[] = [
  { id: 1, title: 'photo-a', description: null, type: 'PHOTO', priceStars: 10, triggerType: 'MESSAGE_COUNT', triggerValue: 5 },
  { id: 2, title: 'video-b', description: null, type: 'VIDEO', priceStars: 20, triggerType: 'TIME', triggerValue: null },
  { id: 3, title: 'photo-c', description: null, type: 'PHOTO', priceStars: 30, triggerType: 'AI', triggerValue: null },
];

describe('selectMediaToPropose', () => {
  it('returns null when the mode is none or manual', () => {
    expect(selectMediaToPropose({ catalog, ownedIds: new Set(), mode: 'none' })).toBeNull();
    expect(selectMediaToPropose({ catalog, ownedIds: new Set(), mode: 'manual' })).toBeNull();
  });

  it('never proposes an owned media', () => {
    const result = selectMediaToPropose({
      catalog,
      ownedIds: new Set([1]),
      mode: 'message_count',
      messageCount: 10,
    });
    expect(result?.id).not.toBe(1);
  });

  it('waits until the message_count threshold is reached', () => {
    expect(
      selectMediaToPropose({ catalog, ownedIds: new Set(), mode: 'message_count', messageCount: 3 }),
    ).toBeNull();
    const result = selectMediaToPropose({
      catalog,
      ownedIds: new Set(),
      mode: 'message_count',
      messageCount: 5,
    });
    expect(result?.id).toBe(1);
  });

  it('falls back to any media when no MESSAGE_COUNT media exist', () => {
    const onlyTime = catalog.filter((m) => m.triggerType !== 'MESSAGE_COUNT');
    const result = selectMediaToPropose({
      catalog: onlyTime,
      ownedIds: new Set(),
      mode: 'message_count',
      messageCount: 2,
    });
    expect(result).not.toBeNull();
  });

  it('time mode prefers TIME media', () => {
    const result = selectMediaToPropose({ catalog, ownedIds: new Set(), mode: 'time' });
    expect(result?.id).toBe(2);
  });

  it('ai mode only accepts a suggested id that exists and is unowned', () => {
    expect(
      selectMediaToPropose({ catalog, ownedIds: new Set(), mode: 'ai', suggestedMediaId: 99 }),
    ).toBeNull();
    expect(
      selectMediaToPropose({ catalog, ownedIds: new Set(), mode: 'ai', suggestedMediaId: null }),
    ).toBeNull();
    expect(
      selectMediaToPropose({ catalog, ownedIds: new Set([3]), mode: 'ai', suggestedMediaId: 3 }),
    ).toBeNull();
    const result = selectMediaToPropose({
      catalog,
      ownedIds: new Set(),
      mode: 'ai',
      suggestedMediaId: 3,
    });
    expect(result?.id).toBe(3);
  });

  it('returns null on an empty catalog', () => {
    expect(selectMediaToPropose({ catalog: [], ownedIds: new Set(), mode: 'ai', suggestedMediaId: 1 })).toBeNull();
  });

  it('auto mode picks any eligible media', () => {
    const result = selectMediaToPropose({ catalog, ownedIds: new Set(), mode: 'auto' });
    expect(result?.id).toBe(1);
  });

  it('auto mode never picks a media with trigger NONE', () => {
    const withNone: ActiveMedia[] = [
      { id: 9, title: 'manual-only', description: null, type: 'PHOTO', priceStars: 5, triggerType: 'NONE', triggerValue: null },
      ...catalog,
    ];
    const result = selectMediaToPropose({ catalog: withNone, ownedIds: new Set(), mode: 'auto' });
    expect(result?.id).not.toBe(9);
    expect(result?.id).toBe(1);
  });

  it('photo_request mode prefers a PHOTO', () => {
    const videosOnly: ActiveMedia[] = [catalog[1]!];
    const mixed = selectMediaToPropose({ catalog, ownedIds: new Set(), mode: 'photo_request' });
    expect(mixed?.type).toBe('PHOTO');
    const fallback = selectMediaToPropose({ catalog: videosOnly, ownedIds: new Set(), mode: 'photo_request' });
    expect(fallback?.type).toBe('VIDEO');
  });
});

describe('detectPhotoRequest', () => {
  it('detects French photo requests', () => {
    expect(detectPhotoRequest('envoie une photo de toi')).toBe(true);
    expect(detectPhotoRequest('tu peux m\'envoyer des photos ?')).toBe(true);
    expect(detectPhotoRequest('montre moi tes photos')).toBe(true);
    expect(detectPhotoRequest('je veux voir des photos de toi')).toBe(true);
    expect(detectPhotoRequest('ta photo stp')).toBe(true);
    expect(detectPhotoRequest('donne-moi une photo')).toBe(true);
    expect(detectPhotoRequest('nudes')).toBe(true);
  });

  it('detects English photo requests', () => {
    expect(detectPhotoRequest('send me a pic')).toBe(true);
    expect(detectPhotoRequest('can you send me a photo?')).toBe(true);
    expect(detectPhotoRequest('show me your pictures')).toBe(true);
    expect(detectPhotoRequest('i want to see you')).toBe(true);
    expect(detectPhotoRequest('ur pics please')).toBe(true);
    expect(detectPhotoRequest('give me nudes')).toBe(true);
  });

  it('ignores casual chat that only mentions a photo', () => {
    expect(detectPhotoRequest('hey how are you')).toBe(false);
    expect(detectPhotoRequest('je t\'envoie une photo de mon chien')).toBe(false);
    expect(detectPhotoRequest('regarde, j\'ai une photo ici')).toBe(false);
    expect(detectPhotoRequest('')).toBe(false);
    expect(detectPhotoRequest('   ')).toBe(false);
  });
});

describe('isCooldownElapsed', () => {
  const now = new Date('2026-01-01T00:00:00Z');

  it('allows when there is no previous proposal', () => {
    expect(isCooldownElapsed({ lastProposalAt: null, now, cooldownMs: 30 * 60 * 1000 })).toBe(true);
  });

  it('blocks when within the cooldown window', () => {
    const last = new Date(now.getTime() - 10 * 60 * 1000);
    expect(isCooldownElapsed({ lastProposalAt: last, now, cooldownMs: 30 * 60 * 1000 })).toBe(false);
  });

  it('allows after the cooldown window', () => {
    const last = new Date(now.getTime() - 31 * 60 * 1000);
    expect(isCooldownElapsed({ lastProposalAt: last, now, cooldownMs: 30 * 60 * 1000 })).toBe(true);
  });

  it('allows when cooldown is disabled (0)', () => {
    expect(
      isCooldownElapsed({ lastProposalAt: now, now, cooldownMs: 0 }),
    ).toBe(true);
  });
});