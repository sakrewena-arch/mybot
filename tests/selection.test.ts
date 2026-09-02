import { describe, it, expect } from 'vitest';
import { selectMediaToPropose, isCooldownElapsed } from '../src/media/selection.js';
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