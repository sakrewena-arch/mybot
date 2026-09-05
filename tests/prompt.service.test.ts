import { describe, it, expect } from 'vitest';
import { buildSystemPrompt, buildContextPrompt } from '../src/ai/prompt.service.js';

describe('prompt service', () => {
  it('builds a system prompt with language + media rules', () => {
    const prompt = buildSystemPrompt(
      {
        systemPrompt: 'You are the assistant.',
        defaultLanguage: 'en',
        preferLanguage: 'en',
      },
      { jsonMode: false },
    );
    expect(prompt).toContain('You are the assistant.');
    expect(prompt).toContain("Always answer in 'en'.");
    expect(prompt).toContain('never invent a price for it');
  });

  it('adds the strict JSON shape when jsonMode is enabled', () => {
    const prompt = buildSystemPrompt(
      {
        systemPrompt: 'Assistant',
        defaultLanguage: 'en',
        preferLanguage: 'user',
      },
      { jsonMode: true },
    );
    expect(prompt).toContain('Return STRICT JSON');
    expect(prompt).toContain('"reply"');
    expect(prompt).toContain('"shouldSendPaidMedia"');
    expect(prompt).toContain('"mediaId"');
  });

  it('exposes profile and catalog to the model (history travels as real turns)', () => {
    const prompt = buildContextPrompt({
      profile: {
        firstName: 'Alice',
        lastName: null,
        username: 'alice',
        languageCode: 'en',
        messageCount: 12,
        lastInteractionAt: new Date('2026-01-01T00:00:00Z'),
        ownedMediaIds: [3],
      },
      catalog: [
        {
          id: 2,
          title: 'Premium pack',
          description: 'Full pack',
          type: 'PHOTO',
          priceStars: 30,
          triggerType: 'AI',
          triggerValue: null,
        },
      ],
    });

    expect(prompt).toContain('Alice');
    expect(prompt).toContain('username: alice');
    expect(prompt).toContain('id=2');
    expect(prompt).toContain('price=30');
    expect(prompt).toContain('media already bought: #3');
    expect(prompt).not.toContain('id=3');
    expect(prompt).toContain('Reply to the LAST message only');
  });

  it('handles an empty catalog', () => {
    const prompt = buildContextPrompt({
      profile: {
        firstName: null,
        lastName: null,
        username: null,
        languageCode: null,
        messageCount: 0,
        lastInteractionAt: null,
        ownedMediaIds: [],
      },
      catalog: [],
    });
    expect(prompt).toContain('(empty)');
    expect(prompt).toContain('(none)');
  });
});