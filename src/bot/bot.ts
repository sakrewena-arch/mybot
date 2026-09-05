import { Bot } from 'grammy';
import { prisma } from '../database/prisma.js';
import { env } from '../config/env.js';
import type { ApiLike } from '../types/telegram.js';
import { createUserRepository } from '../database/repositories/user.repository.js';
import { createBusinessRepository } from '../database/repositories/business.repository.js';
import { createConversationRepository } from '../database/repositories/conversation.repository.js';
import { createMediaRepository } from '../database/repositories/media.repository.js';
import { createPurchaseRepository } from '../database/repositories/purchase.repository.js';
import { createProposalRepository } from '../database/repositories/proposal.repository.js';
import { createSettingsRepository } from '../database/repositories/settings.repository.js';
import { createUserService } from '../services/user.service.js';
import { createConversationService } from '../services/conversation.service.js';
import { createPurchaseService } from '../services/purchase.service.js';
import { createBusinessService } from '../services/business.service.js';
import { createMediaService } from '../media/media.service.js';
import { createPaidMediaService } from './payments/paid-media.js';
import { createResponseService } from '../ai/response.service.js';
import { createReengagementService } from '../services/reengagement.service.js';
import { DEFAULT_SYSTEM_PROMPT } from '../ai/prompt.service.js';
import { registerBusinessConnectionHandler } from './business/connection.handler.js';
import {
  registerBusinessMessageHandler,
  type BusinessMessageHandlerDeps,
} from './business/message.handler.js';
import { registerPaymentHandlers } from './payments/payment.handler.js';
import { registerStartCommand } from './commands/start.js';
import { registerHelpCommand } from './commands/help.js';
import { registerAdminCommands } from './commands/admin.js';
import { logger } from '../utils/logger.js';
import { toErrorMessage } from '../utils/errors.js';

/** Adapter between the bot API and our narrowly-typed `ApiLike`. */
function buildApiAdapter(bot: Bot): ApiLike {
  return {
    sendMessage(args) {
      return bot.api.sendMessage(args.chat_id, args.text, {
        business_connection_id: args.business_connection_id,
        protect_content: args.protect_content,
        reply_markup: args.reply_markup as never,
      });
    },
    sendPaidMedia(args) {
      return bot.api.sendPaidMedia(
        args.chat_id,
        args.star_count,
        args.media as never,
        {
          business_connection_id: args.business_connection_id,
          payload: args.payload,
          caption: args.caption,
          protect_content: args.protect_content,
        },
      );
    },
    answerPreCheckoutQuery(args) {
      return bot.api.answerPreCheckoutQuery(args.pre_checkout_query_id, args.ok, {
        error_message: args.error_message,
      });
    },
    readBusinessMessage(args) {
      return bot.api.readBusinessMessage(
        args.business_connection_id,
        args.chat_id,
        args.message_id,
      );
    },
    sendChatAction(args) {
      return bot.api.sendChatAction(args.chat_id, args.action as never, {
        ...(args.business_connection_id
          ? { business_connection_id: args.business_connection_id }
          : {}),
      });
    },
  };
}

export function createBot(): Bot {
  const bot = new Bot(env.botToken);
  const api = buildApiAdapter(bot);

  // ── repositories ────────────────────────────────────────────
  const userRepository = createUserRepository(prisma);
  const businessRepository = createBusinessRepository(prisma);
  const conversationRepository = createConversationRepository(prisma);
  const mediaRepository = createMediaRepository(prisma);
  const purchaseRepository = createPurchaseRepository(prisma);
  const proposalRepository = createProposalRepository(prisma);
  const settingsRepository = createSettingsRepository(prisma, DEFAULT_SYSTEM_PROMPT);

  // ── services ────────────────────────────────────────────────
  const userService = createUserService(userRepository);
  const conversationService = createConversationService(conversationRepository);
  const businessService = createBusinessService({ businessRepository, api });
  const purchaseService = createPurchaseService({
    userRepository,
    purchaseRepository,
    mediaRepository,
  });
  const mediaService = createMediaService({ mediaRepository, purchaseRepository });
  const paidMediaService = createPaidMediaService({
    api,
    businessRepository,
    mediaRepository,
    purchaseRepository,
    allowedChatIds: env.allowedChatIds,
  });

  const responseService = createResponseService({
    providers: env.aiProviders,
    temperature: env.aiTemperature,
    maxTokens: env.aiMaxTokens,
  });

  // ── handlers ────────────────────────────────────────────────
  registerBusinessConnectionHandler(bot, businessService);

  const businessMessageSettings: BusinessMessageHandlerDeps = {
    env,
    api,
    businessService,
    userService,
    conversationService,
    purchaseService,
    mediaService,
    paidMediaService,
    proposalRepository,
    settingsRepository,
    responseService,
  };
  registerBusinessMessageHandler(bot, businessMessageSettings);

  registerPaymentHandlers(bot, { purchaseService, businessService });
  registerStartCommand(bot);
  registerHelpCommand(bot);
  registerAdminCommands(bot, {
    env,
    userRepository,
    mediaRepository,
    purchaseRepository,
    conversationRepository,
    proposalRepository,
    settingsRepository,
    purchaseService,
    conversationService,
    businessService,
    paidMediaService,
  });

  // Automated follow-ups: gently re-engage users who stop replying
  // (first nudge after REENGAGE_FIRST_DELAY_DAYS, then REENGAGE_SUBSEQUENT_DELAY_DAYS,
  // up to REENGAGE_MAX_MESSAGES, then give up).
  createReengagementService({
    env,
    api,
    conversationRepository,
    conversationService,
    settingsRepository,
    responseService,
    mediaService,
    purchaseService,
  }).start();

  bot.catch((error) => {
    logger.error(
      {
        error: toErrorMessage(error.error ?? error),
        ctx: error.ctx?.update.update_id,
      },
      'bot error',
    );
  });

  // Non-blocking startup self-test of the AI providers (bad key / URL /
  // balance surfaces in the logs immediately, before the first real message).
  void responseService
    .diagnoseProviders()
    .then((results) => {
      for (const r of results) {
        if (r.ok) {
          logger.info({ provider: r.name, model: r.model }, 'AI provider ok');
        } else {
          logger.warn(
            { provider: r.name, model: r.model, error: r.error },
            'AI provider misconfigured or unreachable',
          );
        }
      }
    })
    .catch((error: unknown) =>
      logger.warn(
        { error: toErrorMessage(error) },
        'AI provider diagnosis failed',
      ),
    );

  // Expose the classic commands to users who message the bot directly.
  bot.api
    .setMyCommands([
      { command: 'start', description: 'Start' },
      { command: 'help', description: 'How it works' },
      { command: 'admin', description: 'Admin panel (restricted)' },
      { command: 'stats', description: 'Statistics (restricted)' },
    ])
    .catch((error) => logger.warn({ error: error.message }, 'setMyCommands failed'));

  return bot;
}