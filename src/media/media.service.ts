import { logger } from '../utils/logger.js';
import type { MediaRepository } from '../database/repositories/media.repository.js';
import type { PurchaseRepository } from '../database/repositories/purchase.repository.js';
import {
  type ActiveMedia,
  type MediaSelectionMode,
  selectMediaToPropose,
} from './selection.js';

export interface MediaServiceDeps {
  mediaRepository: MediaRepository;
  purchaseRepository: PurchaseRepository;
}

export interface MediaService {
  listActiveCatalog(): Promise<ActiveMedia[]>;
  listOwnedIds(userId: number): Promise<Set<number>>;
  selectForUser(input: {
    userId: number;
    mode: MediaSelectionMode;
    messageCount?: number;
    suggestedMediaId?: number | null;
  }): Promise<ActiveMedia | null>;
}

export function createMediaService(deps: MediaServiceDeps): MediaService {
  return {
    async listActiveCatalog() {
      const rows = await deps.mediaRepository.listActive();
      return rows.map((row) => ({
        id: row.id,
        title: row.title,
        description: row.description,
        type: row.type,
        priceStars: row.priceStars,
        triggerType: row.triggerType,
        triggerValue: row.triggerValue,
      }));
    },

    async listOwnedIds(userId) {
      const purchases = await deps.purchaseRepository.listByUser(userId);
      return new Set(purchases.map((p) => p.mediaId));
    },

    async selectForUser({ userId, mode, messageCount, suggestedMediaId }) {
      const catalog = await this.listActiveCatalog();
      const ownedIds = await this.listOwnedIds(userId);
      const selected = selectMediaToPropose({
        catalog,
        ownedIds,
        mode,
        messageCount,
        suggestedMediaId,
      });
      if (!selected) {
        logger.debug({ userId, mode }, 'no eligible media to propose');
      }
      return selected;
    },
  };
}