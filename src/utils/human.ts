/** Human-like reply timing helper. */

export interface HumanizeConfig {
  enabled: boolean;
  baseMs: number;
  extraMaxMs: number;
  msPerChar: number;
  maxMs: number;
  /** Delay before the owner "notices" / reads the message (base, ms). */
  readBaseMs?: number;
  /** Random upper bound for the read delay (ms). */
  readMaxMs?: number;
}

/**
 * Computes a believable "writing" delay before answering.
 *
 * The delay scales with the length of the reply (a human would type) plus a
 * fixed base and a random jitter — while staying under `maxMs`.
 * Passing no config (or a disabled one) yields 0 (automated tests / tools).
 */
export function humanReplyDelayMs(textLength: number, config?: HumanizeConfig): number {
  if (!config || config.enabled !== true) return 0;
  const base = config.baseMs;
  const jitter = Math.random() * Math.max(0, config.extraMaxMs);
  const typing = Math.max(0, textLength) * config.msPerChar;
  return Math.round(Math.min(config.maxMs, base + jitter + typing));
}

/**
 * Computes the delay BEFORE the owner appears to have seen the message.
 *
 * A real person does not read notifications instantly: she takes a few
 * minutes before opening the chat. This delay is applied before the message
 * is marked as read and before the AI is asked anything.
 */
export function humanReadDelayMs(config?: HumanizeConfig): number {
  if (!config || config.enabled !== true) return 0;
  const base = Math.max(0, config.readBaseMs ?? 0);
  const max = Math.max(base, config.readMaxMs ?? base);
  const jitter = Math.random() * (max - base);
  return Math.round(base + jitter);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}