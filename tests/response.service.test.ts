import { describe, it, expect, vi } from 'vitest';
import type OpenAI from 'openai';
import { createResponseService } from '../src/ai/response.service.js';
import type { GenerateReplyInput } from '../src/ai/response.service.js';
import type { AiProviderConfig } from '../src/ai/provider-router.js';

const providerConfig: AiProviderConfig = {
  name: 'primary',
  apiKey: 'test-key',
  baseUrl: 'https://api.openai.com/v1',
  model: 'gpt-4o-mini',
  supportsJsonMode: true,
};

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
  const fakeOpenAI = {
    chat: {
      completions: {
        create: vi.fn(async () => completion),
      },
    },
  } as unknown as OpenAI;

  const service = createResponseService({
    providers: [providerConfig],
    createClient: () => fakeOpenAI,
    temperature: 0.8,
    maxTokens: 400,
  });

  return { service, fakeOpenAI };
}

describe('response service (AI generation)', () => {
  it('parses a strict JSON reply with a media decision', async () => {
    const { service } = makeService({
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
    expect(result.provider).toBe('primary');
  });

  it('defaults to no media decision when keys are absent', async () => {
    const { service } = makeService({
      choices: [{ message: { content: '{"reply":"Got it"}' } }],
    });

    const result = await service.generateReply(baseInput());

    expect(result.text).toBe('Got it');
    expect(result.shouldSendPaidMedia).toBe(false);
    expect(result.mediaId).toBeNull();
    expect(result.reason).toBeNull();
  });

  it('passes plain text through when json mode is disabled', async () => {
    const { service } = makeService({
      choices: [{ message: { content: 'Just relaxing a little 😊' } }],
    });

    const result = await service.generateReply(baseInput({ mediaDecisionMode: false }));

    expect(result.text).toBe('Just relaxing a little 😊');
    expect(result.shouldSendPaidMedia).toBe(false);
    expect(result.provider).toBe('primary');
  });

  it('extracts JSON even when wrapped in markdown fences', async () => {
    const { service } = makeService({
      choices: [
        { message: { content: '```json\n{"reply":"ok","shouldSendPaidMedia":false}\n```' } },
      ],
    });

    const result = await service.generateReply(baseInput());

    expect(result.text).toBe('ok');
    expect(result.shouldSendPaidMedia).toBe(false);
  });

  it('extracts JSON from a provider that does not support json mode', async () => {
    const { service } = makeService({
      choices: [
        { message: { content: 'Sure! Here it is:\n{"reply":"here","shouldSendPaidMedia":false,"mediaId":null,"reason":""}' } },
      ],
    });

    const primary = { ...providerConfig, supportsJsonMode: false, name: 'nojson' };
    const service2 = createResponseService({
      providers: [primary],
      createClient: () => ({
        chat: {
          completions: {
            create: vi.fn(async () => ({
              choices: [
                { message: { content: 'Sure! {"reply":"here","shouldSendPaidMedia":false}' } },
              ],
            })),
          },
        },
      }) as unknown as OpenAI,
      temperature: 0.8,
      maxTokens: 400,
    });

    const result = await service2.generateReply(baseInput());
    expect(result.shouldSendPaidMedia).toBe(false);
    expect(result.provider).toBe('nojson');
    void service;
  });

  it('falls back gracefully when the model returns non-JSON in json mode', async () => {
    const { service } = makeService({
      choices: [{ message: { content: '```json\nnot really json' } }],
    });

    const result = await service.generateReply(baseInput());

    expect(result.text).toBe('not really json');
    expect(result.shouldSendPaidMedia).toBe(false);
  });

  it('returns no reply when the provider errors (empty completion)', async () => {
    const { service } = makeService({ choices: [{ message: { content: '' } }] });

    const result = await service.generateReply(baseInput());

    expect(result.provider).toBe('none');
    expect(result.text).toBe('');
    expect(result.shouldSendPaidMedia).toBe(false);
  });

  it('keeps reply text when the AI returns malformed JSON (never sends raw JSON)', async () => {
    const { service } = makeService({
      choices: [
        {
          message: {
            content: '{"reply":"still text","shouldSendPaidMedia":true,"mediaId":"abc"}',
          },
        },
      ],
    });

    const result = await service.generateReply(baseInput());

    expect(result.text).toBe('still text');
    expect(result.shouldSendPaidMedia).toBe(false);
    expect(result.mediaId).toBeNull();
  });

  it('extracts a [MEDIA:<id>] marker from a plain-text provider', async () => {
    const groq: AiProviderConfig = {
      name: 'groq',
      apiKey: 'test-key',
      baseUrl: 'https://api.groq.com/openai/v1',
      model: 'test-model',
      supportsJsonMode: false,
    };
    const fakeOpenAI = {
      chat: {
        completions: {
          create: vi.fn(async () => ({
            choices: [
              { message: { content: 'I have something for you 😉\n[MEDIA:2]' } },
            ],
          })),
        },
      },
    } as unknown as OpenAI;
    const service = createResponseService({
      providers: [groq],
      createClient: () => fakeOpenAI,
      temperature: 0.8,
      maxTokens: 400,
    });

    const result = await service.generateReply(baseInput());

    expect(result.text).toBe('I have something for you 😉');
    expect(result.shouldSendPaidMedia).toBe(true);
    expect(result.mediaId).toBe(2);
    expect(result.provider).toBe('groq');
  });

  it('sends the history as real user/assistant chat turns', async () => {
    let capturedMessages: unknown;
    const fakeOpenAI = {
      chat: {
        completions: {
          create: vi.fn(async (opts: { messages: unknown[] }) => {
            capturedMessages = opts.messages;
            return { choices: [{ message: { content: '{"reply":"ok"}' } }] };
          }),
        },
      },
    } as unknown as OpenAI;
    const service = createResponseService({
      providers: [providerConfig],
      createClient: () => fakeOpenAI,
      temperature: 0.8,
      maxTokens: 400,
    });

    await service.generateReply(
      baseInput({
        history: [
          { role: 'user', text: 'hi' },
          { role: 'assistant', text: 'hello 😊' },
        ],
      }),
    );

    const messages = capturedMessages as Array<{ role: string; content: string }>;
    expect(messages[0].role).toBe('system');
    expect(messages[1].role).toBe('user');
    expect(messages[1].content).toContain('## User profile');
    expect(messages[2]).toEqual({ role: 'user', content: 'hi' });
    expect(messages[3]).toEqual({ role: 'assistant', content: 'hello 😊' });
  });
});