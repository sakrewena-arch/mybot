import type { Media, Purchase } from '@prisma/client';
import type { UserRepository } from '../database/repositories/user.repository.js';
import type { PurchaseRepository } from '../database/repositories/purchase.repository.js';
import type { MediaRepository } from '../database/repositories/media.repository.js';
import type { TelegramUserDto } from '../types/telegram.js';
import { AppError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import { decodeInvoicePayload, decodeMediaPayload } from '../bot/payments/stars.js';

export interface PurchaseService {
  /**
   * Confirmation for paid media bought through `sendPaidMedia`.
   * The only trusted signal is the `purchased_paid_media` update whose
   * payload we embedded when sending.
   */
  confirmPaidMediaPurchase(input: {
    buyer: TelegramUserDto;
    payload: string;
  }): Promise<{ purchase: Purchase; media: Media; created: boolean }>;

  /** Confirmation for invoice-style Stars payments (`successful_payment`). */
  confirmInvoicePayment(input: {
    buyer: TelegramUserDto;
    invoicePayload: string;
    amountStars: number;
    telegramPaymentChargeId: string;
  }): Promise<{ purchase: Purchase; media: Media; created: boolean }>;

  hasPurchased(userId: number, mediaId: number): Promise<boolean>;
  listOwnedMediaIds(userId: number): Promise<Set<number>>;
  listRecent(limit: number): Promise<Purchase[]>;
  count(): Promise<number>;
  totalStars(): Promise<number>;
}

export interface PurchaseServiceDeps {
  userRepository: UserRepository;
  purchaseRepository: PurchaseRepository;
  mediaRepository: MediaRepository;
}

async function loadMediaOrThrow(
  mediaRepository: MediaRepository,
  mediaId: number,
): Promise<Media> {
  const media = await mediaRepository.findById(mediaId);
  if (!media || media.deletedAt) {
    throw new AppError(`Media #${mediaId} no longer exists`, 'MEDIA_NOT_FOUND');
  }
  return media;
}

export function createPurchaseService(deps: PurchaseServiceDeps): PurchaseService {
  return {
    async confirmPaidMediaPurchase({ buyer, payload }) {
      const mediaId = decodeMediaPayload(payload);
      if (!mediaId) {
        logger.warn({ payload }, 'ignoring purchased_paid_media with unexpected payload');
        throw new AppError('Unrecognized paid media payload', 'INVALID_PAYLOAD');
      }
      const media = await loadMediaOrThrow(deps.mediaRepository, mediaId);
      const user = await deps.userRepository.upsertFromTelegram(buyer);
      const result = await deps.purchaseRepository.createIfAbsent({
        userId: user.id,
        mediaId: media.id,
        telegramPaymentChargeId: null,
        amountStars: media.priceStars,
      });
      logger.info(
        {
          userId: user.id,
          mediaId: media.id,
          stars: media.priceStars,
          created: result.created,
        },
        'paid media purchase confirmed',
      );
      return { purchase: result.purchase, media, created: result.created };
    },

    async confirmInvoicePayment({
      buyer,
      invoicePayload,
      amountStars,
      telegramPaymentChargeId,
    }) {
      const mediaId = decodeInvoicePayload(invoicePayload);
      if (!mediaId) {
        logger.warn({ invoicePayload }, 'ignoring successful_payment with unexpected payload');
        throw new AppError('Unrecognized invoice payload', 'INVALID_PAYLOAD');
      }
      const media = await loadMediaOrThrow(deps.mediaRepository, mediaId);
      const user = await deps.userRepository.upsertFromTelegram(buyer);
      const result = await deps.purchaseRepository.createIfAbsent({
        userId: user.id,
        mediaId: media.id,
        telegramPaymentChargeId,
        amountStars,
      });
      logger.info(
        {
          userId: user.id,
          mediaId: media.id,
          stars: amountStars,
          chargeId: telegramPaymentChargeId,
          created: result.created,
        },
        'invoice purchase confirmed',
      );
      return { purchase: result.purchase, media, created: result.created };
    },

    async hasPurchased(userId, mediaId) {
      return (await deps.purchaseRepository.findByUserAndMedia(userId, mediaId)) !== null;
    },

    async listOwnedMediaIds(userId) {
      const rows = await deps.purchaseRepository.listByUser(userId);
      return new Set(rows.map((row) => row.mediaId));
    },

    listRecent(limit) {
      return deps.purchaseRepository.listRecent(limit);
    },

    count() {
      return deps.purchaseRepository.count();
    },

    totalStars() {
      return deps.purchaseRepository.sumAmount();
    },
  };
}