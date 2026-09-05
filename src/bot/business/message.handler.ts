import type { Bot } from 'grammy';
import type { User, Conversation } from '@prisma/client';
import type { EnvConfig } from '../../config/env.js';
import type { ApiLike } from '../../types/telegram.js';
import type { BusinessService } from '../../services/business.service.js';
import type { UserService } from '../../services/user.service.js';
import type { ConversationService } from '../../services/conversation.service.js';
import type { PurchaseService } from '../../services/purchase.service.js';
import type { MediaService } from '../../media/media.service.js';
import type { PaidMediaService, ActiveMediaLike } from '../payments/paid-media.js';
import type { ProposalRepository } from '../../database/repositories/proposal.repository.js';
import type { SettingsRepository } from '../../database/repositories/settings.repository.js';
import type { ResponseService } from '../../ai/response.service.js';
import type { UserProfile } from '../../ai/prompt.service.js';
import { isChatAllowed } from './permissions.js';
import { isCooldownElapsed } from '../../media/selection.js';
import { toErrorMessage } from '../../utils/errors.js';
import { humanReadDelayMs, humanReplyDelayMs, sleep } from '../../utils/human.js';
import { logger } from '../../utils/logger.js';

/**
 * Chats currently inside a reply cycle. While a cycle is running for a chat,
 * new incoming messages are stored as read (not replied to) so the user never
 * receives a chain of near-identical replies when they send a burst.
 */
const activeCycles = new Set<string>();

export interface BusinessMessageHandlerDeps {
  env: EnvConfig;
  api: ApiLike;
  businessService: BusinessService;
  userService: UserService;
  conversationService: ConversationService;
  purchaseService: PurchaseService;
  mediaService: MediaService;
  paidMediaService: PaidMediaService;
  proposalRepository: ProposalRepository;
  settingsRepository: SettingsRepository;
  responseService: ResponseService;
}

function normalizeInboundText(message: { text?: string }): string {
  return message.text && message.text.trim().length > 0 ? message.text : '[non-text message]';
}

function buildProfile(
  user: User,
  conversation: Conversation,
  ownedMediaIds: Set<number>,
): UserProfile {
  return {
    firstName: user.firstName,
    lastName: user.lastName,
    username: user.username,
    languageCode: user.languageCode,
    messageCount: conversation.messageCount,
    lastInteractionAt: conversation.lastMessageAt,
    ownedMediaIds: Array.from(ownedMediaIds),
  };
}

/** Minimal shape of a business message consumed by the handler (structural). */
export interface BusinessMessageLike {
  business_connection_id?: string;
  chat: { id: number };
  from?: { id: number; is_bot?: boolean; first_name?: string; username?: string | null; language_code?: string };
  message_id: number;
  date: number;
  text?: string;
}

export interface BusinessMessageCtx {
  businessMessage?: BusinessMessageLike;
}

/** Main flow for inbound `business_message` updates. */
export async function handleBusinessMessage(
  ctx: BusinessMessageCtx,
  deps: BusinessMessageHandlerDeps,
): Promise<void> {
  const msg = ctx.businessMessage;
  if (!msg || !msg.business_connection_id || !msg.from) return;

  // One reply per burst: while a reply cycle is already running for this chat,
  // new messages are marked as read and picked up by the running cycle, so the
  // user never receives several near-identical replies in a row.
  const cycleKey = `${msg.business_connection_id}:${msg.chat.id}`;
  if (activeCycles.has(cycleKey)) {
    await handleCoalescedInbound(msg, deps);
    return;
  }
  activeCycles.add(cycleKey);

  try {
    const connection = await deps.businessService.getEnabledConnection(
      msg.business_connection_id,
    );
    if (!connection) {
      logger.debug({ connectionId: msg.business_connection_id }, 'connection not enabled');
      return;
    }

    if (String(msg.from.id) === connection.businessUserId || msg.from.is_bot === true) return;

    if (!deps.businessService.canReply(connection)) {
      logger.debug({ connectionId: connection.businessConnectionId }, 'can_reply missing');
      return;
    }

    if (!isChatAllowed(msg.chat.id, deps.env.allowedChatIds)) {
      logger.debug({ chatId: msg.chat.id }, 'chat not allowed');
      return;
    }

    const settings = await deps.settingsRepository.getSettings();
    if (!settings.enabled) return;

    // Quota gate: when every AI provider is exhausted (tokens depleted), the
    // owner reads NOTHING and answers NOTHING until the quota recharges.
    if (deps.responseService.isAiUnavailable()) {
      logger.info(
        { chatId: msg.chat.id, connectionId: msg.business_connection_id },
        'AI quota exhausted — skipping read and reply',
      );
      return;
    }

    // Real people do not answer instantly: Esther takes a few minutes before
    // she even "sees" the message. No typing indicator during this phase.
    const noticeDelayMs = humanReadDelayMs(deps.env.humanize);
    if (noticeDelayMs > 0) await sleep(noticeDelayMs);

    try {
      await deps.api.readBusinessMessage?.({
        business_connection_id: msg.business_connection_id,
        chat_id: msg.chat.id,
        message_id: msg.message_id,
      });
    } catch {
      /* read permission may be missing — non-blocking */
    }

    const user = await deps.userService.syncFromTelegram(msg.from);
    const conversation = await deps.conversationService.getOrCreate({
      userId: user.id,
      businessConnectionId: connection.id,
      chatId: msg.chat.id,
    });

    const { messageCount } = await deps.conversationService.recordInbound({
      conversationId: conversation.id,
      telegramMessageId: msg.message_id,
      text: normalizeInboundText(msg),
    });

    const history = await deps.conversationService.getRecentHistory(
      conversation.id,
      deps.env.historyLimit,
    );
    const ownedMediaIds = await deps.purchaseService.listOwnedMediaIds(user.id);
    const profile = buildProfile(user, conversation, ownedMediaIds);

    const catalog = (await deps.mediaService.listActiveCatalog()).filter(
      (media) => !ownedMediaIds.has(media.id),
    );

    const startedAt = Date.now();

    const aiReply = await deps.responseService.generateReply({
      settings: {
        systemPrompt: settings.systemPrompt,
        defaultLanguage: settings.defaultLanguage,
      },
      preferLanguage: deps.env.preferLanguage,
      history,
      profile,
      catalog,
      mediaDecisionMode: deps.env.mediaTriggerMode === 'ai',
    });

    // No provider answered (quota exhausted at generation time): stay quiet.
    if (aiReply.provider === 'none') {
      logger.info(
        { chatId: msg.chat.id, connectionId: msg.business_connection_id },
        'no AI provider answered — nothing sent',
      );
      return;
    }

    logger.info(
      {
        provider: aiReply.provider,
        textLength: aiReply.text.length,
        textPreview: aiReply.text.slice(0, 140),
      },
      'AI reply generated',
    );

    // Show "typing…" on the business chat while the AI thinks and "writes".
    void deps.api.sendChatAction?.({
      business_connection_id: msg.business_connection_id,
      chat_id: msg.chat.id,
      action: 'typing',
    })?.catch(() => undefined);

    // Human-like writing time: wait so the total gap between the user message
    // and the reply feels natural (longer replies take longer), and keep the
    // typing indicator alive while we wait.
    const elapsedMs = Date.now() - startedAt;
    const targetDelayMs = humanReplyDelayMs(aiReply.text.length, deps.env.humanize);
    if (targetDelayMs > elapsedMs) {
      const waitMs = targetDelayMs - elapsedMs;
      const typingLoop = setInterval(() => {
        void deps.api.sendChatAction?.({
          business_connection_id: msg.business_connection_id,
          chat_id: msg.chat.id,
          action: 'typing',
        })?.catch(() => undefined);
      }, 4_500);
      try {
        await sleep(waitMs);
      } finally {
        clearInterval(typingLoop);
      }
    }

    const sent = await deps.api.sendMessage({
      business_connection_id: msg.business_connection_id,
      chat_id: msg.chat.id,
      text: aiReply.text,
      protect_content: false,
    });

    await deps.conversationService.recordOutbound({
      conversationId: conversation.id,
      telegramMessageId: sent.message_id,
      text: aiReply.text,
    });

    await maybeProposePaidMedia({
      deps,
      user,
      conversation,
      messageCount,
      aiReply,
      businessConnectionId: msg.business_connection_id,
      chatId: msg.chat.id,
    });
  } catch (error) {
    logger.error(
      { error: toErrorMessage(error), connectionId: msg.business_connection_id, chatId: msg.chat.id },
      'failed to process business message',
    );
  } finally {
    activeCycles.delete(cycleKey);
  }
}

/**
 * A burst message that arrives while a reply cycle is already running for the
 * same chat. It is marked as read and stored in the history (so the running
 * cycle's reply naturally covers it), but no second reply is generated.
 */
async function handleCoalescedInbound(
  msg: BusinessMessageLike,
  deps: BusinessMessageHandlerDeps,
): Promise<void> {
  if (!msg.business_connection_id || !msg.from) return;
  try {
    const connection = await deps.businessService.getEnabledConnection(
      msg.business_connection_id,
    );
    if (!connection) return;
    if (
      !msg.from ||
      String(msg.from.id) === connection.businessUserId ||
      msg.from.is_bot === true
    ) {
      return;
    }
    if (!deps.businessService.canReply(connection)) return;
    if (!isChatAllowed(msg.chat.id, deps.env.allowedChatIds)) return;

    const settings = await deps.settingsRepository.getSettings();
    if (!settings.enabled) return;
    if (deps.responseService.isAiUnavailable()) return;

    try {
      await deps.api.readBusinessMessage?.({
        business_connection_id: msg.business_connection_id,
        chat_id: msg.chat.id,
        message_id: msg.message_id,
      });
    } catch {
      /* read permission may be missing — non-blocking */
    }

    const user = await deps.userService.syncFromTelegram(msg.from);
    const conversation = await deps.conversationService.getOrCreate({
      userId: user.id,
      businessConnectionId: connection.id,
      chatId: msg.chat.id,
    });
    await deps.conversationService.recordInbound({
      conversationId: conversation.id,
      telegramMessageId: msg.message_id,
      text: normalizeInboundText(msg),
    });
    logger.debug(
      { chatId: msg.chat.id, connectionId: msg.business_connection_id },
      'burst message stored — no separate reply',
    );
  } catch (error) {
    logger.error(
      { error: toErrorMessage(error), connectionId: msg.business_connection_id, chatId: msg.chat.id },
      'failed to store coalesced business message',
    );
  }
}

type AiReplyLike = Awaited<ReturnType<ResponseService['generateReply']>>;

/**
 * Trigger logic for paid media proposals. Follows the configured mode and the
 * global cooldown. The AI may only suggest an existing media id — the server
 * always re-validates it before sending.
 */
async function maybeProposePaidMedia(input: {
  deps: BusinessMessageHandlerDeps;
  user: User;
  conversation: Conversation;
  messageCount: number;
  aiReply: AiReplyLike;
  businessConnectionId: string;
  chatId: number;
}): Promise<void> {
  const { deps, user, conversation, messageCount, aiReply, businessConnectionId, chatId } =
    input;
  const now = new Date();

  const lastProposal = await deps.proposalRepository.lastForUser(user.id);
  const elapsedSinceLast = lastProposal
    ? now.getTime() - lastProposal.sentAt.getTime()
    : Number.POSITIVE_INFINITY;

  if (
    !isCooldownElapsed({
      lastProposalAt: lastProposal?.sentAt ?? null,
      now,
      cooldownMs: deps.env.mediaCooldownMs,
    })
  ) {
    if (aiReply.shouldSendPaidMedia === true && aiReply.mediaId !== null) {
      await deps.proposalRepository.create({
        userId: user.id,
        mediaId: aiReply.mediaId,
        conversationId: conversation.id,
        status: 'SKIPPED',
        reason: 'cooldown active',
      });
    }
    return;
  }

  const mode = deps.env.mediaTriggerMode;
  let proposed: ActiveMediaLike | null = null;
  let decisionReason: string | null = null;

  if (mode === 'message_count') {
    if (messageCount >= deps.env.mediaMessageThreshold) {
      proposed = await deps.mediaService.selectForUser({
        userId: user.id,
        mode: 'message_count',
        messageCount,
      });
    }
  } else if (mode === 'time') {
    if (lastProposal === null || elapsedSinceLast >= deps.env.mediaTimeMs) {
      proposed = await deps.mediaService.selectForUser({ userId: user.id, mode: 'time' });
    }
  } else if (mode === 'ai') {
    if (aiReply.shouldSendPaidMedia === true && aiReply.mediaId !== null) {
      decisionReason = aiReply.reason;
      proposed = await deps.mediaService.selectForUser({
        userId: user.id,
        mode: 'ai',
        suggestedMediaId: aiReply.mediaId,
      });
    }
  }

  if (!proposed) {
    if (mode === 'ai' && aiReply.shouldSendPaidMedia === true && aiReply.mediaId !== null) {
      await deps.proposalRepository.create({
        userId: user.id,
        mediaId: aiReply.mediaId,
        conversationId: conversation.id,
        status: 'SKIPPED',
        reason: decisionReason ?? 'suggested media unavailable or already owned',
      });
    }
    return;
  }

  try {
    await deps.paidMediaService.sendPaidMedia({
      businessConnectionId,
      userId: user.id,
      chatId,
      media: proposed,
    });
    await deps.proposalRepository.create({
      userId: user.id,
      mediaId: proposed.id,
      conversationId: conversation.id,
      status: 'SENT',
      reason: decisionReason,
    });
  } catch (error) {
    logger.error({ error: toErrorMessage(error), mediaId: proposed.id }, 'paid media send failed');
    await deps.proposalRepository.create({
      userId: user.id,
      mediaId: proposed.id,
      conversationId: conversation.id,
      status: 'FAILED',
      reason: toErrorMessage(error),
    });
  }
}

/** Registers the three business-message update types on the bot. */
export function registerBusinessMessageHandler(
  bot: Bot,
  deps: BusinessMessageHandlerDeps,
): void {
  bot.on('business_message', (ctx) => handleBusinessMessage(ctx, deps));

  bot.on('edited_business_message', async (ctx) => {
    const msg = ctx.editedBusinessMessage;
    if (!msg || !msg.business_connection_id) return;
    try {
      const connection = await deps.businessService.getConnection(msg.business_connection_id);
      if (!connection) return;
      const conversation = await deps.conversationService.findByConnectionAndChat(
        connection.id,
        msg.chat.id,
      );
      if (!conversation) return;
      await deps.conversationService.updateIncomingText?.(
        conversation.id,
        msg.message_id,
        normalizeInboundText(msg),
      );
    } catch (error) {
      logger.error({ error: toErrorMessage(error) }, 'edited_business_message failed');
    }
  });

  bot.on('deleted_business_messages', async (ctx) => {
    const deleted = ctx.deletedBusinessMessages;
    if (!deleted) return;
    try {
      const connection = await deps.businessService.getConnection(
        deleted.business_connection_id,
      );
      if (!connection) return;
      const conversation = await deps.conversationService.findByConnectionAndChat(
        connection.id,
        deleted.chat.id,
      );
      if (!conversation) return;
      await deps.conversationService.markDeletedIncoming(conversation.id, deleted.message_ids);
    } catch (error) {
      logger.error({ error: toErrorMessage(error) }, 'deleted_business_messages failed');
    }
  });
}