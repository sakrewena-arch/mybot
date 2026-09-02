import type OpenAI from 'openai';
import { AppError, toErrorMessage } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

/**
 * Multi-provider router for OpenAI-compatible APIs.
 *
 * Each provider has its own client (base URL + key + model). When one provider
 * hits a quota / rate-limit / transient error, it is put on a cooldown
 * ("exhaustedUntil") and the next healthy provider answers transparently.
 * Providers are tried round-robin so load is spread evenly and quotas recharge
 * in the background.
 *
 * The conversation thread is NEVER lost during failover: the context is always
 * rebuilt from the DB history before calling any provider, so whichever
 * provider answers, the flow continues naturally.
 */

export interface AiProviderConfig {
  name: string;
  apiKey: string;
  baseUrl: string;
  model: string;
  /** false → the endpoint doesn't support response_format json_object (the
   * router will still extract the JSON decision from the text). */
  supportsJsonMode?: boolean;
}

interface LiveProvider {
  config: AiProviderConfig;
  client: OpenAI;
  exhaustedUntil: number;
  consecutiveFailures: number;
}

/** Backoff (ms) applied to a provider after an error. */
function backoffMs(error: unknown, consecutiveFailures: number): number {
  const status =
    typeof error === 'object' && error !== null
      ? (error as { status?: unknown }).status
      : undefined;

  if (status === 429) return 60_000; // rate limit / quota window (1 min)
  if (status === 402) return 30 * 60_000; // insufficient balance (needs recharge)
  if (status === 529 || status === 503) return 60_000; // overloaded

  // network / 5xx / unknown → exponential backoff capped at 10 min
  return Math.min(10 * 60_000, 5_000 * 2 ** (consecutiveFailures - 1));
}

export interface ProviderRouterResult<T> {
  value: T;
  providerName: string;
}

export interface ProviderRouter {
  executeWithFailover<T>(
    fn: (client: OpenAI, config: AiProviderConfig) => Promise<T>,
  ): Promise<ProviderRouterResult<T>>;
  /** Current status per provider (used for logs/debug). */
  statuses(): Array<{ name: string; ready: boolean; retryAt: string | null }>;
}

export function createProviderRouter(
  configs: AiProviderConfig[],
  createClient: (config: AiProviderConfig) => OpenAI,
): ProviderRouter {
  const providers: LiveProvider[] = configs.map((config) => ({
    config,
    client: createClient(config),
    exhaustedUntil: 0,
    consecutiveFailures: 0,
  }));

  if (providers.length === 0) {
    throw new AppError('No AI provider configured', 'NO_AI_PROVIDER');
  }

  let head = 0;

  return {
    async executeWithFailover(fn) {
      const attempts = providers.length;
      for (let i = 0; i < attempts; i += 1) {
        const index = (head + i) % providers.length;
        const alive = providers[index]!;
        const now = Date.now();

        if (alive.exhaustedUntil > now) continue; // quota not recharged yet

        try {
          const value = await fn(alive.client, alive.config);
          alive.consecutiveFailures = 0;
          head = (index + 1) % providers.length; // spread next calls
          return { value, providerName: alive.config.name };
        } catch (error) {
          alive.consecutiveFailures += 1;
          const backOff = backoffMs(error, alive.consecutiveFailures);
          alive.exhaustedUntil = now + backOff;
          logger.warn(
            {
              provider: alive.config.name,
              error: toErrorMessage(error),
              backOffMs: backOff,
            },
            'AI provider failed — fallback to next',
          );
        }
      }

      throw new AppError(
        `All AI providers are temporarily unavailable (${providers
          .map((p) => p.config.name)
          .join(', ')})`,
        'AI_ALL_EXHAUSTED',
      );
    },

    statuses() {
      const now = Date.now();
      return providers.map((p) => ({
        name: p.config.name,
        ready: p.exhaustedUntil <= now,
        retryAt: p.exhaustedUntil > now ? new Date(p.exhaustedUntil).toISOString() : null,
      }));
    },
  };
}