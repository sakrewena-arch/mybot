import type { MediaTriggerType } from '@prisma/client';

export type MediaTypeName = 'PHOTO' | 'VIDEO';
export type MediaTriggerName = MediaTriggerType;

/** Media surfaced to the business logic (independent of the Prisma row type). */
export interface ActiveMedia {
  id: number;
  title: string;
  description: string | null;
  type: MediaTypeName;
  priceStars: number;
  triggerType: MediaTriggerName;
  triggerValue: number | null;
}

export type MediaSelectionMode = 'none' | 'message_count' | 'time' | 'ai' | 'manual';

/**
 * Pure selection logic: choose one eligible media for a proposal.
 * - `message_count`: prefer media configured with MESSAGE_COUNT whose
 *   threshold is reached; fall back to any other media.
 * - `time`: prefer TIME media; fall back to any other media.
 * - `ai`: only the suggested id is accepted (validated against the catalog).
 *
 * Media the user already owns are always excluded.
 */
export function selectMediaToPropose(params: {
  catalog: ActiveMedia[];
  ownedIds: ReadonlySet<number>;
  mode: MediaSelectionMode;
  messageCount?: number;
  suggestedMediaId?: number | null;
}): ActiveMedia | null {
  const { catalog, ownedIds, mode } = params;

  if (mode === 'none' || mode === 'manual') return null;

  const available = catalog.filter((media) => !ownedIds.has(media.id));
  if (available.length === 0) return null;

  if (mode === 'ai') {
    const suggested = params.suggestedMediaId;
    if (!suggested) return null;
    return available.find((media) => media.id === suggested) ?? null;
  }

  if (mode === 'message_count') {
    const count = params.messageCount ?? 0;
    const countTriggered = available.filter(
      (media) =>
        media.triggerType === 'MESSAGE_COUNT' && (media.triggerValue ?? 1) <= count,
    );
    if (countTriggered.length > 0) return countTriggered[0] ?? null;
    // If the catalog contains message-count media, wait until a threshold is
    // actually reached. Only fall back when no MESSAGE_COUNT media exist.
    const hasCountMedia = available.some((media) => media.triggerType === 'MESSAGE_COUNT');
    if (hasCountMedia) return null;
    return available[0] ?? null;
  }

  // mode === 'time'
  const byTrigger = available.find((media) => media.triggerType === 'TIME') ?? null;
  return byTrigger ?? available[0] ?? null;
}

/** Minimum spacing between two paid-media proposals for the same user. */
export function isCooldownElapsed(params: {
  lastProposalAt: Date | null;
  now: Date;
  cooldownMs: number;
}): boolean {
  if (params.cooldownMs <= 0) return true;
  if (!params.lastProposalAt) return true;
  return params.now.getTime() - params.lastProposalAt.getTime() >= params.cooldownMs;
}