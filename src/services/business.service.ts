import type { BusinessConnection as GrammyBusinessConnection } from '@grammyjs/types/manage.js';
import type { BusinessConnection, Media } from '@prisma/client';
import type {
  BusinessRepository,
} from '../database/repositories/business.repository.js';
import type { ApiLike } from '../types/telegram.js';
import { canReply } from '../bot/business/permissions.js';
import { logger } from '../utils/logger.js';
import { toErrorMessage } from '../utils/errors.js';

export interface BusinessService {
  /** Persists a `business_connection` update (create / refresh / disable). */
  syncConnection(connection: GrammyBusinessConnection): Promise<BusinessConnection>;
  getConnection(businessConnectionId: string): Promise<BusinessConnection | null>;
  getEnabledConnection(businessConnectionId: string): Promise<BusinessConnection | null>;
  canReply(connection: BusinessConnection): boolean;
  /** Sends a DM to the buyer as the bot itself (not on behalf of the business). */
  notifyPurchaseSuccess(telegramUserId: number, media: Media): Promise<void>;
}

export interface BusinessServiceDeps {
  businessRepository: BusinessRepository;
  api: ApiLike;
}

export function createBusinessService(deps: BusinessServiceDeps): BusinessService {
  return {
    async syncConnection(connection) {
      const saved = await deps.businessRepository.upsertConnection({
        businessConnectionId: connection.id,
        businessUserId: connection.user.id,
        userChatId: connection.user_chat_id,
        isEnabled: connection.is_enabled,
        rights: connection.rights,
      });
      logger.info(
        {
          connectionId: saved.businessConnectionId,
          businessUserId: saved.businessUserId,
          isEnabled: saved.isEnabled,
          canReply: saved.canReply,
        },
        connection.is_enabled ? 'business connection enabled' : 'business connection disabled',
      );
      return saved;
    },

    getConnection(businessConnectionId) {
      return deps.businessRepository.findById(businessConnectionId);
    },

    getEnabledConnection(businessConnectionId) {
      return deps.businessRepository.findActiveById(businessConnectionId);
    },

    canReply(connection) {
      return canReply(connection);
    },

    async notifyPurchaseSuccess(telegramUserId, media) {
      try {
        await deps.api.sendMessage({
          chat_id: telegramUserId,
          text: `Thanks for your purchase of “${media.title}”! 🎉 You can view it in the chat above.`,
        });
      } catch (error) {
        // A direct bot chat with the user may not exist — not fatal.
        logger.warn(
          { telegramUserId, mediaId: media.id, error: toErrorMessage(error) },
          'could not send purchase DM',
        );
      }
    },
  };
}