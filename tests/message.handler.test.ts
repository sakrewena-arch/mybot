import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Conversation, BusinessConnection, MediaProposal, BotSettings } from '@prisma/client';
import type { EnvConfig } from '../src/config/env.js';
import type { BusinessService } from '../src/services/business.service.js';
import type { UserService } from '../src/services/user.service.js';
import type { ConversationService } from '../src/services/conversation.service.js';
import type { PurchaseService } from '../src/services/purchase.service.js';
import type { MediaService } from '../src/media/media.service.js';
import type { PaidMediaService } from '../src/bot/payments/paid-media.js';
import type { ProposalRepository } from '../src/database/repositories/proposal.repository.js';
import type { ResponseService } from '../src/ai/response.service.js';
import type { AiReply, GenerateReplyInput } from '../src/ai/response.service.js';
import type { ActiveMedia, MediaSelectionMode } from '../src/media/selection.js';
import {
  handleBusinessMessage,
  type BusinessMessageHandlerDeps,
  type BusinessMessageLike,
} from '../src/bot/business/message.handler.js';
import { createFakeApi, makeBusinessConnection, makeUser } from './helpers/fakes.js';

type SelectForUser = (input: {
  userId: number;
  mode: MediaSelectionMode;
  messageCount?: number;
  suggestedMediaId?: number | null;
}) => Promise<ActiveMedia | null>;
type ListActiveCatalog = () => Promise<ActiveMedia[]>;
type GenerateReplyFn = (input: GenerateReplyInput) => Promise<AiReply>;

const connection = makeBusinessConnection({
  id: 1,
  businessConnectionId: 'conn-1',
  canReply: true,
  isEnabled: true,
});

const conversation = {
  id: 10,
  userId: 1,
  businessConnectionId: 1,
  chatId: '555',
  messageCount: 1,
  lastMessageAt: new Date(),
  createdAt: new Date(),
  updatedAt: new Date(),
} as unknown as Conversation;

function makeCtx(text: string, overrides: Partial<BusinessMessageLike> = {}): {
  businessMessage: BusinessMessageLike;
} {
  return {
    businessMessage: {
      business_connection_id: 'conn-1',
      chat: { id: 555 },
      from: { id: 123, first_name: 'Alice', username: 'alice', language_code: 'en', is_bot: false },
      message_id: 42,
      date: Math.floor(Date.now() / 1000),
      text,
      ...overrides,
    },
  };
}

/** Constructs handler deps where mocked services keep their vi.fn methods. */
function buildDeps(overrides: Partial<BusinessMessageHandlerDeps> = {}) {
  const { api, calls } = createFakeApi();

  const businessService = {
    syncConnection: vi.fn(),
    getConnection: vi.fn(async () => connection),
    getEnabledConnection: vi.fn(async () => connection),
    canReply: vi.fn((c: BusinessConnection) => c.canReply === true && c.isEnabled === true),
    notifyPurchaseSuccess: vi.fn(),
  };

  const userService = {
    syncFromTelegram: vi.fn(async () => makeUser({ id: 1 })),
    findById: vi.fn(),
    count: vi.fn(async () => 0),
  };

  const conversationService = {
    getOrCreate: vi.fn(async () => conversation),
    recordInbound: vi.fn(async () => ({
      message: { id: 1, telegramMessageId: 42, direction: 'IN', text: 'hi', createdAt: new Date() },
      messageCount: 1,
    })),
    recordOutbound: vi.fn(async () => undefined),
    getRecentHistory: vi.fn(async () => []),
    updateIncomingText: vi.fn(async () => undefined),
    markDeletedIncoming: vi.fn(async () => undefined),
    findById: vi.fn(async () => conversation),
    findByConnectionAndChat: vi.fn(async () => conversation),
    count: vi.fn(async () => 0),
  };

  const purchaseService = {
    listOwnedMediaIds: vi.fn(async () => new Set<number>()),
    hasPurchased: vi.fn(async () => false),
    confirmPaidMediaPurchase: vi.fn(),
    confirmInvoicePayment: vi.fn(),
    listRecent: vi.fn(async () => []),
    count: vi.fn(async () => 0),
    totalStars: vi.fn(async () => 0),
  };

  const mediaService = {
    listActiveCatalog: vi.fn<ListActiveCatalog>(async () => []),
    listOwnedIds: vi.fn(async (): Promise<Set<number>> => new Set()),
    selectForUser: vi.fn<SelectForUser>(async () => null),
  };

  const paidMediaService = {
    sendPaidMedia: vi.fn(
      async (input: {
        businessConnectionId: string;
        chatId: number;
        media: { id: number };
      }) =>
        api.sendPaidMedia({
          business_connection_id: input.businessConnectionId,
          chat_id: input.chatId,
          star_count: 50,
          media: [{ type: 'photo', media: 'file://premium' }],
          payload: JSON.stringify({ mediaId: input.media.id }),
        }),
    ),
    sendPaidPhoto: vi.fn(),
    sendPaidVideo: vi.fn(),
  };

  const proposalRepository = {
    create: vi.fn(
      async (input: { userId: number; mediaId: number; conversationId?: number | null; status: string; reason?: string | null }) => ({
        id: 1,
        userId: input.userId,
        mediaId: input.mediaId,
        conversationId: input.conversationId ?? null,
        status: input.status,
        reason: input.reason ?? null,
        sentAt: new Date(),
      }),
    ),
    lastForUser: vi.fn(async (): Promise<MediaProposal | null> => null),
    countByStatus: vi.fn(async (): Promise<number> => 0),
    countSentBetween: vi.fn(async (): Promise<number> => 0),
  };

  const settingsRepository = {
    getSettings: vi.fn(async (): Promise<BotSettings> => ({
      id: 1,
      systemPrompt: 'You are a friendly assistant.',
      enabled: true,
      defaultLanguage: 'en',
      createdAt: new Date(),
      updatedAt: new Date(),
    })),
    updateSystemPrompt: vi.fn(
      async (systemPrompt: string): Promise<BotSettings> =>
        ({ id: 1, systemPrompt, enabled: true, defaultLanguage: 'en', createdAt: new Date(), updatedAt: new Date() }) as BotSettings,
    ),
    setEnabled: vi.fn(async (enabled: boolean): Promise<BotSettings> =>
      ({ id: 1, systemPrompt: '', enabled, defaultLanguage: 'en', createdAt: new Date(), updatedAt: new Date() }) as BotSettings,
    ),
  };

  const responseService = {
    generateReply: vi.fn<GenerateReplyFn>(async () => ({
      text: 'Hey there!',
      shouldSendPaidMedia: false,
      mediaId: null,
      reason: null,
      provider: 'test',
    })),
    isAiUnavailable: vi.fn(() => false),
  };

  const env = {
    allowedChatIds: new Set<number>(),
    historyLimit: 10,
    preferLanguage: 'en',
    mediaTriggerMode: 'ai',
    mediaCooldownMs: 30 * 60 * 1000,
    mediaTimeMs: 240 * 60 * 1000,
    mediaMessageThreshold: 10,
    humanize: { enabled: false, baseMs: 0, extraMaxMs: 0, msPerChar: 0, maxMs: 0 },
  };

  const deps: BusinessMessageHandlerDeps = {
    env: env as unknown as EnvConfig,
    api,
    businessService: businessService as unknown as BusinessService,
    userService: userService as unknown as UserService,
    conversationService: conversationService as unknown as ConversationService,
    purchaseService: purchaseService as unknown as PurchaseService,
    mediaService: mediaService as unknown as MediaService,
    paidMediaService: paidMediaService as unknown as PaidMediaService,
    proposalRepository: proposalRepository as unknown as ProposalRepository,
    settingsRepository: settingsRepository as unknown as BusinessMessageHandlerDeps['settingsRepository'],
    responseService: responseService as unknown as ResponseService,
    ...overrides,
  };

  return {
    deps,
    calls,
    businessService,
    mediaService,
    paidMediaService,
    proposalRepository,
    settingsRepository,
    responseService,
  };
}
describe('business_message handling', () => {
  let h: ReturnType<typeof buildDeps>;

  beforeEach(() => {
    h = buildDeps();
  });

  it('answers on behalf of the business with the correct connection id', async () => {
    await handleBusinessMessage(makeCtx('Hey, how are you?'), h.deps);

    const send = h.calls.find((c) => c.kind === 'sendMessage');
    expect(send).toBeDefined();
    const args = send?.args as Record<string, unknown>;
    expect(args['business_connection_id']).toBe('conn-1');
    expect(args['chat_id']).toBe(555);
    expect(args['text']).toBe('Hey there!');
    expect(h.deps.conversationService.recordOutbound).toHaveBeenCalled();
  });

  it('does not read or reply when the AI quota is exhausted', async () => {
    h.responseService.isAiUnavailable = vi.fn(() => true);

    await handleBusinessMessage(makeCtx('Hi there?'), h.deps);

    // No read, no reply, no generation.
    expect(h.calls.filter((c) => c.kind === 'readBusinessMessage')).toHaveLength(0);
    expect(h.calls.filter((c) => c.kind === 'sendMessage')).toHaveLength(0);
    expect(h.responseService.generateReply).not.toHaveBeenCalled();
  });

  it('does not send a message when the AI provider is unavailable', async () => {
    h.responseService.generateReply.mockResolvedValue({
      text: '',
      shouldSendPaidMedia: false,
      mediaId: null,
      reason: null,
      provider: 'none',
    });

    await handleBusinessMessage(makeCtx('Hello?'), h.deps);

    expect(h.calls.filter((c) => c.kind === 'sendMessage')).toHaveLength(0);
    expect(h.deps.conversationService.recordOutbound).not.toHaveBeenCalled();
  });

  it('does nothing when the connection is disabled', async () => {
    const d = buildDeps({
      businessService: {
        ...(h.deps.businessService as object),
        getEnabledConnection: vi.fn(async () => null),
      } as unknown as BusinessService,
    });
    await handleBusinessMessage(makeCtx('hello'), d.deps);
    expect(d.calls.filter((c) => c.kind === 'sendMessage')).toHaveLength(0);
  });

  it('does nothing when can_reply permission is missing', async () => {
    const noReply = makeBusinessConnection({ canReply: false });
    const d = buildDeps({
      businessService: {
        ...(h.deps.businessService as object),
        getEnabledConnection: vi.fn(async () => noReply),
      } as unknown as BusinessService,
    });
    await handleBusinessMessage(makeCtx('hello'), d.deps);
    expect(d.calls.filter((c) => c.kind === 'sendMessage')).toHaveLength(0);
  });

  it('proposes paid media that the AI selected', async () => {
    const media: ActiveMedia = {
      id: 2,
      title: 'Premium video',
      description: null,
      type: 'VIDEO',
      priceStars: 50,
      triggerType: 'AI',
      triggerValue: null,
    };
    h.mediaService.selectForUser.mockResolvedValue(media);
    h.mediaService.listActiveCatalog.mockResolvedValue([media]);
    h.responseService.generateReply.mockResolvedValue({
      text: 'Would you like a premium video?',
      shouldSendPaidMedia: true,
      mediaId: 2,
      reason: 'the user asked for more content',
      provider: 'test',
    });

    await handleBusinessMessage(makeCtx('Show me something cool'), h.deps);

    const send = h.calls.find((c) => c.kind === 'sendPaidMedia');
    expect(send).toBeDefined();
    const args = send?.args as Record<string, unknown>;
    expect(args['business_connection_id']).toBe('conn-1');
    expect(args['chat_id']).toBe(555);
    expect(h.proposalRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ mediaId: 2, status: 'SENT' }),
    );
  });

  it('skips a proposal when the AI suggestion is not eligible', async () => {
    h.responseService.generateReply.mockResolvedValue({
      text: 'I have something for you!',
      shouldSendPaidMedia: true,
      mediaId: 999,
      reason: 'suggestion',
      provider: 'test',
    });
    h.mediaService.selectForUser.mockResolvedValue(null);

    await handleBusinessMessage(makeCtx('Okay'), h.deps);

    expect(h.calls.filter((c) => c.kind === 'sendPaidMedia')).toHaveLength(0);
    expect(h.proposalRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ mediaId: 999, status: 'SKIPPED' }),
    );
  });

  it('does not trigger proposals twice within the cooldown', async () => {
    h.proposalRepository.lastForUser.mockResolvedValue({
      id: 1,
      userId: 1,
      mediaId: 2,
      conversationId: 10,
      status: 'SENT',
      reason: null,
      sentAt: new Date(),
    });
    h.responseService.generateReply.mockResolvedValue({
      text: 'Here you go',
      shouldSendPaidMedia: true,
      mediaId: 2,
      reason: 'second offer',
      provider: 'test',
    });
    const media2: ActiveMedia = {
      id: 2,
      title: 'Premium video',
      description: null,
      type: 'VIDEO',
      priceStars: 50,
      triggerType: 'AI',
      triggerValue: null,
    };
    h.mediaService.selectForUser.mockResolvedValue(media2);

    await handleBusinessMessage(makeCtx('Again?'), h.deps);

    expect(h.calls.filter((c) => c.kind === 'sendPaidMedia')).toHaveLength(0);
  });

  it('triggers by message count threshold', async () => {
    const d = buildDeps({
      env: {
        allowedChatIds: new Set<number>(),
        historyLimit: 10,
        preferLanguage: 'en',
        mediaTriggerMode: 'message_count',
        mediaCooldownMs: 0,
        mediaTimeMs: 0,
        mediaMessageThreshold: 10,
        humanize: { enabled: false, baseMs: 0, extraMaxMs: 0, msPerChar: 0, maxMs: 0 },
      } as unknown as EnvConfig,
    });
    d.deps.conversationService.recordInbound = vi.fn(async () => ({
      message: { id: 1, telegramMessageId: 42, direction: 'IN', text: 'hi', createdAt: new Date() },
      messageCount: 10,
    })) as unknown as ConversationService['recordInbound'];

    const tmedia: ActiveMedia = {
      id: 1,
      title: 'Exclusive photo',
      description: null,
      type: 'PHOTO',
      priceStars: 10,
      triggerType: 'MESSAGE_COUNT',
      triggerValue: 10,
    };
    d.mediaService.selectForUser.mockResolvedValue(tmedia);
    d.mediaService.listActiveCatalog.mockResolvedValue([tmedia]);

    await handleBusinessMessage(makeCtx('Tenth message!'), d.deps);

    expect(d.calls.find((c) => c.kind === 'sendPaidMedia')).toBeDefined();
  });
});