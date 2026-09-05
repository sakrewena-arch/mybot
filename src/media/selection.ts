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

export type MediaSelectionMode =
  | 'none'
  | 'auto'
  | 'message_count'
  | 'time'
  | 'ai'
  | 'photo_request'
  | 'manual';

/**
 * Pure selection logic: choose one eligible media for a proposal.
 * - `auto`: pick any not-owned, auto-proposable media (ignores per-media
 *   thresholds; respects triggerType NONE = never propose automatically).
 * - `photo_request`: like auto, but prefer a PHOTO when one exists.
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

  // Never auto-propose media explicitly configured with trigger NONE.
  const autoAvailable = available.filter((media) => media.triggerType !== 'NONE');

  if (mode === 'auto') {
    return autoAvailable[0] ?? null;
  }

  if (mode === 'photo_request') {
    const photo = autoAvailable.find((media) => media.type === 'PHOTO') ?? null;
    return photo ?? autoAvailable[0] ?? null;
  }

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

/**
 * Heuristic intent detection: does this user message ask Esther for a photo /
 * for her pictures / nudes (in English or French)? Used to trigger a paid-media
 * proposal right away, without waiting for the message-count threshold.
 *
 * Two tiers:
 * - strong patterns (send me a photo, photo de toi, ta photo, montre-moi, …)
 *   always count as a request;
 * - soft patterns (bare photo/pic + "please"/"stp") also count.
 */
const PHOTO_REQUEST_STRONG = [
  /\b(?:send|envoie|envoye|envoyes|envoies|envois)\b[^.!?\n]{0,40}\b(?:pic|pics|photos?|nudes?|vid[eé]os?|videos?)\b/i,
  /\b(?:pic|pics|photos?|nudes?)\b[^.!?\n]{0,30}\b(?:of you|de toi|de vous)\b/i,
  /\b(?:ta|tes|ton|your|ur)\b[^.!?\n]{0,6}\b(?:pic|pics|photos?|nudes?)\b/i,
  /\b(?:montre|show)\b[^.!?\n]{0,30}\b(?:toi|moi|me|photos?|pics|nudes?|you|yourself)\b/i,
  /\b(?:i want|i wanna|je veux|j'aimerais|jaimerais|j'aimerai)\b[^.!?\n]{0,40}\b(?:voir|see|photo|pics|nudes?|toi|you)\b/i,
  /\b(?:can you|could you|peux.?tu|pourrais.?tu|tu peux)\b[^.!?\n]{0,40}\b(?:send|envoyer|envoye|voir|see|photo|pics|nudes?|toi|you)\b/i,
  /\b(?:give me|donne.{0,3}moi)\b[^.!?\n]{0,25}\b(?:photo|pics|nudes?)\b/i,
  /\bm['’]envoie\b[^.!?\n]{0,20}\b(?:des |une |ta |tes )?(?:photos?|pics|nudes?)\b/i,
  /\bnudes?\b/i,
];

const PHOTO_REQUEST_SOFT = [
  /\b(?:pic|pics|photos?|nudes?)\b[^.!?\n]{0,15}\b(?:pls|please|stp|svp)\b/i,
  /\b(?:pls|please|stp|svp)\b[^.!?\n]{0,20}\b(?:pic|pics|photos?|nudes?)\b/i,
];

/**
 * The user is SENDING a photo TO Esther ("je t'envoie une photo", "i'll send
 * you a pic", "j'ai une photo de mon chien"…). Not a request.
 */
const OUTGOING_PHOTO_PATTERNS =
  /\b(?:je t'envoie|je tenvoie|je t envoye|j'ai une photo|j ai une photo|i'?ll send|ill send|i send you|i have a photo|voici|here'?s)\b/i;

/** Request-reinforcing words that override an "outgoing" statement. */
const REQUEST_REINFORCERS =
  /\b(?:de toi|of you|moi|montre|show|je veux|j'aimerais|i want|can you|peux|tu peux|pourrais|donne|give|ta|tes|ton|your|ur)\b/i;

export function detectPhotoRequest(text: string): boolean {
  const normalized = text.trim();
  if (normalized.length === 0) return false;

  const strong = PHOTO_REQUEST_STRONG.some((re) => re.test(normalized));
  if (!strong) {
    return PHOTO_REQUEST_SOFT.some((re) => re.test(normalized));
  }

  // "je t'envoie une photo de mon chien" matches the strong "envoie … photo"
  // pattern but is NOT a request → only keep it when a request word is present.
  if (OUTGOING_PHOTO_PATTERNS.test(normalized)) {
    return REQUEST_REINFORCERS.test(normalized);
  }

  return true;
}