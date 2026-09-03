/** Human-like reply timing helper. */

export interface HumanizeConfig {
  enabled: boolean;
  baseMs: number;
  extraMaxMs: number;
  msPerChar: number;
  maxMs: number;
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

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}