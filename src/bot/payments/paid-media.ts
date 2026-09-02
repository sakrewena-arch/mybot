import type { BusinessConnection, Media } from '@prisma/client';
import type { InputPaidMedia } from '@grammyjs/types/methods.js';
import type { ApiLike } from '../../types/telegram.js';
import type { BusinessRepository } from '../../database/repositories/business.repository.js';
import type { MediaRepository } from '../../database/repositories/media.repository.js';
import type { PurchaseRepository } from '../../database/repositories/purchase.repository.js';
import { AppError } from '../../utils/errors.js';
import { logger } from '../../utils/logger.js';
import { isChatAllowed } from '../business/permissions.js';
import { encodeMediaPayload, isValidStarCount } from './stars.js';

export interface PaidMediaService {
  /**
   * Validates and sends paid media on behalf of the business account.
   * Always uses `business_connection_id` supplied by Telegram.
   */
  sendPaidMedia(input: {
    businessConnectionId: string;
    /** Internal (DB) id of the buyer. */
    userId: number;
    /** Telegram chat id of the buyer. */
    chatId: number;
    media: ActiveMediaLike;
    caption?: string;
  }): Promise<{ messageId?: number; chatId: number; mediaId: number; starCount: number }>;

  sendPaidPhoto(input: {
    businessConnectionId: string;
    userId: number;
    chatId: number;
    media: ActiveMediaLike;
    caption?: string;
  }): Promise<{ messageId?: number; chatId: number; mediaId: number; starCount: number }>;

  sendPaidVideo(input: {
    businessConnectionId: string;
    userId: number;
    chatId: number;
    media: ActiveMediaLike;
    caption?: string;
  }): Promise<{ messageId?: number; chatId: number; mediaId: number; starCount: number }>;
}

/** The paid media service only needs the media id — it re-validates and
 * reloads the active media row from the database before sending. */
export type ActiveMediaLike = Pick<Media, 'id'>;

export interface PaidMediaServiceDeps {
  api: ApiLike;
  businessRepository: BusinessRepository;
  mediaRepository: MediaRepository;
  purchaseRepository: PurchaseRepository;
  /** Optional whitelist of allowed chats (empty = allow all). */
  allowedChatIds: ReadonlySet<number>;
}

const EMPTY_CONNECTION_ERROR = new AppError(
  'business_connection_id is required to send business messages',
  'BUSINESS_CONNECTION_REQUIRED',
);

export type PaidMediaResult = {
  messageId?: number;
  chatId: number;
  mediaId: number;
  starCount: number;
};

export function createPaidMediaService(deps: PaidMediaServiceDeps): PaidMediaService {
  async function assertConnectionCanSend(
    businessConnectionId: string,
  ): Promise<BusinessConnection> {
    if (!businessConnectionId || businessConnectionId.length === 0) {
      throw EMPTY_CONNECTION_ERROR;
    }
    const connection = await deps.businessRepository.findActiveById(businessConnectionId);
    if (!connection || !connection.isEnabled) {
      throw new AppError('Business connection is not enabled', 'CONNECTION_DISABLED');
    }
    if (!connection.canReply) {
      throw new AppError(
        'The bot does not have the can_reply permission on this business connection',
        'CANNOT_REPLY',
      );
    }
    return connection;
  }

  function assertChatAllowed(chatId: number): void {
    if (!isChatAllowed(chatId, deps.allowedChatIds)) {
      throw new AppError('This chat is not authorized', 'CHAT_NOT_ALLOWED');
    }
  }

  async function assertMediaSellable(input: {
    userId: number;
    mediaId: number;
  }): Promise<Media> {
    const media = await deps.mediaRepository.findActiveById(input.mediaId);
    if (!media) {
      throw new AppError(`Media #${input.mediaId} does not exist or is inactive`, 'MEDIA_UNAVAILABLE');
    }
    if (!isValidStarCount(media.priceStars)) {
      throw new AppError(
        `Invalid star price ${media.priceStars} for media #${media.id}`,
        'INVALID_STAR_COUNT',
      );
    }
    const existing = await deps.purchaseRepository.findByUserAndMedia(input.userId, media.id);
    if (existing) {
      throw new AppError(`User already owns media #${media.id}`, 'ALREADY_PURCHASED');
    }
    return media;
  }

  function buildInputPaidMedia(media: Media): InputPaidMedia<string> {
    if (media.type === 'VIDEO') {
      return {
        type: 'video',
        media: media.telegramFileId,
        ...(media.thumbnailFileId ? { thumbnail: media.thumbnailFileId as never } : {}),
      };
    }
    return { type: 'photo', media: media.telegramFileId };
  }

  async function execute(input: {
    businessConnectionId: string;
    userId: number;
    chatId: number;
    media: ActiveMediaLike;
    caption?: string;
  }): Promise<PaidMediaResult> {
    const connection = await assertConnectionCanSend(input.businessConnectionId);
    assertChatAllowed(input.chatId);
    const media = await assertMediaSellable({ userId: input.userId, mediaId: input.media.id });

    const caption = input.caption ?? (media.description ? `${media.title}\n\n${media.description}` : media.title);

    const sent = await deps.api.sendPaidMedia({
      business_connection_id: connection.businessConnectionId,
      chat_id: input.chatId,
      star_count: media.priceStars,
      media: [buildInputPaidMedia(media)],
      payload: encodeMediaPayload(media.id),
      caption,
      protect_content: false,
    });

    logger.info(
      {
        mediaId: media.id,
        chatId: input.chatId,
        stars: media.priceStars,
        messageId: sent.message_id,
      },
      'paid media sent',
    );

    return {
      messageId: sent.message_id,
      chatId: input.chatId,
      mediaId: media.id,
      starCount: media.priceStars,
    };
  }

  return {
    sendPaidMedia: execute,
    sendPaidPhoto: execute,
    sendPaidVideo: execute,
  };
}