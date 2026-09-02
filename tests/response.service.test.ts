import { describe, it, expect, vi } from 'vitest';
import type OpenAI from 'openai';
import { createResponseService } from '../src/ai/response.service.js';
import type { GenerateReplyInput } from '../src/ai/response.service.js';

function baseInput(overrides: Partial<GenerateReplyInput> = {}): GenerateReplyInput {
  return {
    settings: { systemPrompt: 'You are the assistant.', defaultLanguage: 'en' },
    preferLanguage: 'en',
    history: [],
    profile: {
      firstName: 'Alice',
      lastName: null,
      username: 'alice',
      languageCode: 'en',
      messageCount: 3,
      lastInteractionAt: new Date(),
      ownedMediaIds: [],
    },
    catalog: [
      { id: 2, title: 'Premium video', description: null, type: 'VIDEO', priceStars: 50, triggerType: 'AI', triggerValue: null },
    ],
    mediaDecisionMode: true,
    ...overrides,
  };
}

function makeService(completion: unknown) {
  const openai = {
    chat: {
      completions: {
        create: vi.fn(async () => completion),
      },
    },
  } as unknown as OpenAI;
  const service = createResponseService({
    openai,
    config: { model: 'gpt-4o-mini', temperature: 0.8, maxTokens: 400 },
  });
  return service;
}

describe('response service (AI generation)', () => {
  it('parses a strict JSON reply with a media decision', async () => {
    const service = makeService({
      choices: [
        {
          message: {
            content:
              '{"reply":"Sure, here it is","shouldSendPaidMedia":true,"mediaId":2,"reason":"fits the topic"}',
          },
        },
      ],
    });

    const result = await service.generateReply(baseInput());

    expect(result.text).toBe('Sure, here it is');
    expect(result.shouldSendPaidMedia).toBe(true);
    expect(result.mediaId).toBe(2);
    expect(result.reason).toBe('fits the topic');
  });

  it('defaults to no media decision when keys are absent', async () => {
    const service = makeService({
      choices: [{ message: { content: '{"reply":"Got it"}' } }],
    });

    const result = await service.generateReply(baseInput());

    expect(result.text).toBe('Got it');
    expect(result.shouldSendPaidMedia).toBe(false);
    expect(result.mediaId).toBeNull();
    expect(result.reason).toBeNull();
  });

  it('passes plain text through when json mode is disabled', async () => {
    const service = makeService({
      choices: [{ message: { content: 'Just relaxing a little 😊' } }],
    });

    const result = await service.generateReply(baseInput({ mediaDecisionMode: false }));

    expect(result.text).toBe('Just relaxing a little 😊');
    expect(result.shouldSendPaidMedia).toBe(false);
  });

  it('falls back gracefully when the model returns non-JSON in json mode', async () => {
    const service = makeService({
      choices: [{ message: { content: '```json\nnot really json' } }],
    });

    const result = await service.generateReply(baseInput());

    expect(result.text).toBe('not really json');
    expect(result.shouldSendPaidMedia).toBe(false);
  });

  it('throws when the model returns an empty completion', async () => {
    const service = makeService({ choices: [{ message: { content: '' } }] });

    await expect(service.generateReply(baseInput())).rejects.toMatchObject({
      code: 'AI_EMPTY_REPLY',
    });
  });
});