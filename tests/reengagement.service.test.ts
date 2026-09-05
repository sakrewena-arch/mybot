import { describe, it, expect, vi } from 'vitest';
import type { Conversation, User, BusinessConnection } from '@prisma/client';
import type { EnvConfig } from '../src/config/env.js';
import type { ApiLike } from '../src/types/telegram.js';
import type { ReEngagementCandidate } from '../src/database/repositories/conversation.repository.js';
import {
  createReengagementService,
  selectReengagementCandidates,
} from '../src/services/reengagement.service.js';

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-09-06T12:00:00Z');

const user = {
  id: 1,
  telegramId: '1',
  username: 'alice',
  firstName: 'Alice',
  lastName: null,
  languageCode: 'en',
  createdAt: NOW,
  updatedAt: NOW,
} as User;

const businessConnection = {
  id: 1,
  businessConnectionId: 'conn-1',
  businessUserId: '99',
  userChatId: '555',
  isEnabled: true,
  canReply: true,
  permissions: {},
  createdAt: NOW,
  updatedAt: NOW,
} as BusinessConnection;

function makeCandidate(overrides: Partial<Conversation> = {}): ReEngagementCandidate {
  return {
    id: 10,
    userId: 1,
    businessConnectionId: 1,
    chatId: '555',
    messageCount: 5,
    lastMessageAt: new Date(NOW.getTime() - 5 * DAY),
    lastInboundAt: new Date(NOW.getTime() - 5 * DAY),
    lastOutboundAt: new Date(NOW.getTime() - 4 * DAY),
    followUpCount: 0,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
    user,
    businessConnection,
  };
}

const opts = {
  firstDelayMs: 3 * DAY,
  subsequentDelayMs: 6 * DAY,
  maxFollowUps: 3,
};

describe('selectReengagementCandidates', () => {
  it('picks a chat where Esther wrote last more than the first delay ago', () => {
    const row = makeCandidate({
      lastOutboundAt: new Date(NOW.getTime() - 4 * DAY),
      lastInboundAt: new Date(NOW.getTime() - 5 * DAY),
      followUpCount: 0,
    });
    expect(selectReengagementCandidates([row], NOW, opts)).toHaveLength(1);
  });

  it('skips a chat where the user replied after Esther (pending answer)', () => {
    const row = makeCandidate({
      lastOutboundAt: new Date(NOW.getTime() - 4 * DAY),
      lastInboundAt: new Date(NOW.getTime() - 3 * DAY),
    });
    expect(selectReengagementCandidates([row], NOW, opts)).toHaveLength(0);
  });

  it('skips a chat that is not old enough yet', () => {
    const row = makeCandidate({
      lastOutboundAt: new Date(NOW.getTime() - 1 * DAY),
    });
    expect(selectReengagementCandidates([row], NOW, opts)).toHaveLength(0);
  });

  it('uses the subsequent longer delay for later nudges', () => {
    const row = makeCandidate({
      lastOutboundAt: new Date(NOW.getTime() - 5 * DAY),
      followUpCount: 1,
    });
    expect(selectReengagementCandidates([row], NOW, opts)).toHaveLength(0);
    const due = makeCandidate({
      lastOutboundAt: new Date(NOW.getTime() - 7 * DAY),
      lastInboundAt: new Date(NOW.getTime() - 10 * DAY),
      followUpCount: 1,
    });
    expect(selectReengagementCandidates([due], NOW, opts)).toHaveLength(1);
  });

  it('stops after the max number of unanswered nudges', () => {
    const row = makeCandidate({ followUpCount: 3 });
    expect(selectReengagementCandidates([row], NOW, opts)).toHaveLength(0);
  });

  it('skips a chat with no outbound message yet', () => {
    const row = makeCandidate({ lastOutboundAt: null });
    expect(selectReengagementCandidates([row], NOW, opts)).toHaveLength(0);
  });
});

interface FakeDeps {
  env: EnvConfig;
  api: ApiLike;
  conversationRepository: {
    listForReengagement: ReturnType<typeof vi.fn>;
    recordOutbound: ReturnType<typeof vi.fn>;
    incrementFollowUp: ReturnType<typeof vi.fn>;
  };
  conversationService: {
    getRecentHistory: ReturnType<typeof vi.fn>;
  };
  settingsRepository: {
    getSettings: ReturnType<typeof vi.fn>;
  };
  responseService: {
    generateReply: ReturnType<typeof vi.fn>;
    isAiUnavailable: ReturnType<typeof vi.fn>;
  };
  mediaService: {
    listActiveCatalog: ReturnType<typeof vi.fn>;
  };
  purchaseService: {
    listOwnedMediaIds: ReturnType<typeof vi.fn>;
  };
}

function buildDeps(overrides: Partial<FakeDeps> = {}): FakeDeps {
  const env = {
    historyLimit: 10,
    preferLanguage: 'en',
    reengage: {
      enabled: true,
      firstDelayMs: 3 * DAY,
      subsequentDelayMs: 6 * DAY,
      maxMessages: 3,
      intervalMs: 60 * 60 * 1000,
    },
  } as unknown as EnvConfig;

  const deps: FakeDeps = {
    env,
    api: {
      sendMessage: vi.fn(async () => ({ message_id: 77 })),
    } as unknown as ApiLike,
    conversationRepository: {
      listForReengagement: vi.fn(async () => [makeCandidate()]),
      recordOutbound: vi.fn(async () => undefined),
      incrementFollowUp: vi.fn(async () => undefined),
    },
    conversationService: {
      getRecentHistory: vi.fn(async () => []),
    },
    settingsRepository: {
      getSettings: vi.fn(async () => ({
        id: 1,
        systemPrompt: 'You are Esther.',
        enabled: true,
        defaultLanguage: 'en',
        createdAt: NOW,
        updatedAt: NOW,
      })),
    },
    responseService: {
      generateReply: vi.fn(async () => ({
        text: 'Hey you, I was thinking about you 😊',
        shouldSendPaidMedia: false,
        mediaId: null,
        reason: null,
        provider: 'openai',
      })),
      isAiUnavailable: vi.fn(() => false),
    },
    mediaService: {
      listActiveCatalog: vi.fn(async () => []),
    },
    purchaseService: {
      listOwnedMediaIds: vi.fn(async () => new Set<number>()),
    },
  };
  return { ...deps, ...overrides };
}

type ReengagementDeps = Parameters<typeof createReengagementService>[0];

function serviceFor(d: FakeDeps) {
  return createReengagementService({
    ...d,
    sleepFn: async () => undefined,
  } as unknown as ReengagementDeps);
}

describe('createReengagementService.runOnce', () => {
  it('sends a follow-up on the business connection and records it', async () => {
    const d = buildDeps();
    const service = serviceFor(d);

    const sent = await service.runOnce(NOW);

    expect(sent).toBe(1);
    expect(d.api.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        business_connection_id: 'conn-1',
        chat_id: '555',
        text: 'Hey you, I was thinking about you 😊',
      }),
    );
    expect(d.conversationRepository.recordOutbound).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: 10, telegramMessageId: 77 }),
    );
    expect(d.conversationRepository.incrementFollowUp).toHaveBeenCalledWith(10);
  });

  it('does nothing when the re-engagement is disabled', async () => {
    const base = buildDeps();
    const d = buildDeps({
      env: {
        ...base.env,
        reengage: {
          enabled: false,
          firstDelayMs: 0,
          subsequentDelayMs: 0,
          maxMessages: 3,
          intervalMs: 60_000,
        },
      } as unknown as EnvConfig,
    });
    const service = serviceFor(d);
    expect(await service.runOnce(NOW)).toBe(0);
    expect(d.api.sendMessage).not.toHaveBeenCalled();
  });

  it('does nothing when the AI quota is exhausted', async () => {
    const d = buildDeps();
    d.responseService.isAiUnavailable.mockReturnValue(true);
    const service = serviceFor(d);
    expect(await service.runOnce(NOW)).toBe(0);
    expect(d.api.sendMessage).not.toHaveBeenCalled();
  });

  it('does nothing when the settings are disabled', async () => {
    const d = buildDeps();
    d.settingsRepository.getSettings.mockResolvedValue({
      id: 1,
      systemPrompt: 'You are Esther.',
      enabled: false,
      defaultLanguage: 'en',
      createdAt: NOW,
      updatedAt: NOW,
    });
    const service = serviceFor(d);
    expect(await service.runOnce(NOW)).toBe(0);
    expect(d.api.sendMessage).not.toHaveBeenCalled();
  });

  it('stays quiet when no provider answers (quota), and does not count it', async () => {
    const d = buildDeps();
    d.responseService.generateReply.mockResolvedValue({
      text: '',
      shouldSendPaidMedia: false,
      mediaId: null,
      reason: null,
      provider: 'none',
    });
    const service = serviceFor(d);
    expect(await service.runOnce(NOW)).toBe(0);
    expect(d.api.sendMessage).not.toHaveBeenCalled();
    expect(d.conversationRepository.incrementFollowUp).not.toHaveBeenCalled();
  });
});