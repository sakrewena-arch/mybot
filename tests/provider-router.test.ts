import { describe, it, expect, vi } from 'vitest';
import type OpenAI from 'openai';
import { createResponseService } from '../src/ai/response.service.js';
import type { GenerateReplyInput } from '../src/ai/response.service.js';
import type { AiProviderConfig } from '../src/ai/provider-router.js';

const makeCfg = (name: string, model = 'test-model'): AiProviderConfig => ({
  name,
  apiKey: `key-${name}`,
  baseUrl: `https://api.${name}.test/v1`,
  model,
  supportsJsonMode: true,
});

function fakeClient(behavior: { throwStatus?: number; content?: string }) {
  return {
    chat: {
      completions: {
        create: vi.fn(async () => {
          if (behavior.throwStatus) {
            throw Object.assign(new Error(`http ${behavior.throwStatus}`), {
              status: behavior.throwStatus,
            });
          }
          return {
            choices: [
              {
                message: {
                  content:
                    behavior.content ??
                    '{"reply":"ok","shouldSendPaidMedia":false,"mediaId":null,"reason":null}',
                },
              },
            ],
          };
        }),
      },
    },
  } as unknown as OpenAI;
}

function serviceWith(clients: Record<string, ReturnType<typeof fakeClient>>) {
  return createResponseService({
    providers: Object.keys(clients).map((name) => makeCfg(name)),
    createClient: (cfg) => clients[cfg.name]!,
    temperature: 0.8,
    maxTokens: 400,
  });
}

const input = {
  settings: { systemPrompt: 'Assistant', defaultLanguage: 'en' },
  preferLanguage: 'en',
  history: [],
  profile: {
    firstName: 'A',
    lastName: null,
    username: null,
    languageCode: 'en',
    messageCount: 1,
    lastInteractionAt: null,
    ownedMediaIds: [],
  },
  catalog: [],
  mediaDecisionMode: true,
} satisfies GenerateReplyInput;

describe('AI provider failover', () => {
  it('falls back to the next provider when the first hits a quota error (429)', async () => {
    const a = fakeClient({ throwStatus: 429 });
    const b = fakeClient({});
    const service = serviceWith({ a, b });

    const result = await service.generateReply(input);

    expect(result.provider).toBe('b');
    expect(result.text).toBe('ok');
    expect(a.chat.completions.create).toHaveBeenCalled();
    expect(b.chat.completions.create).toHaveBeenCalled();
  });

  it('skips an exhausted provider on subsequent calls (cooldown)', async () => {
    const a = fakeClient({ throwStatus: 429 });
    const b = fakeClient({});
    const service = serviceWith({ a, b });

    await service.generateReply(input); // a fails → b answers
    const second = await service.generateReply(input); // a is on cooldown → b again

    expect(second.provider).toBe('b');
    expect(a.chat.completions.create).toHaveBeenCalledTimes(1);
    expect(b.chat.completions.create).toHaveBeenCalledTimes(2);
  });

  it('returns a graceful message when every provider is exhausted', async () => {
    const a = fakeClient({ throwStatus: 429 });
    const b = fakeClient({ throwStatus: 500 });
    const service = serviceWith({ a, b });

    const result = await service.generateReply(input);

    expect(result.provider).toBe('none');
    expect(result.shouldSendPaidMedia).toBe(false);
    expect(result.text.length).toBeGreaterThan(0);
  });

  it('spreads load round-robin between healthy providers', async () => {
    const a = fakeClient({});
    const b = fakeClient({});
    const service = serviceWith({ a, b });

    const first = await service.generateReply(input);
    const second = await service.generateReply(input);

    expect(first.provider).toBe('a');
    expect(second.provider).toBe('b');
  });

  it('re-uses a provider after its quota recovers (backoff expires)', async () => {
    const a = fakeClient({ throwStatus: 429 });
    const b = fakeClient({});
    const service = serviceWith({ a, b });

    await service.generateReply(input); // a → exhausted 60s, b answers

    // Simulate quota recharge by waiting for the 60s backoff to elapse.
    vi.useFakeTimers();
    try {
      vi.setSystemTime(Date.now() + 61_000);
      const result = await service.generateReply(input);
      // a is first in line again
      expect(result.provider).toBe('b'); // b still healthy and a still tries first (fails again) → b
      expect(a.chat.completions.create).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});