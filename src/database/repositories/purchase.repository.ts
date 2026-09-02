import type { PrismaClient, Purchase, Media } from '@prisma/client';
import { isUniqueConstraintError } from '../../utils/errors.js';

export interface PurchaseRepository {
  createIfAbsent(input: {
    userId: number;
    mediaId: number;
    telegramPaymentChargeId?: string | null;
    amountStars: number;
  }): Promise<{ purchase: Purchase; created: boolean }>;
  findByUserAndMedia(userId: number, mediaId: number): Promise<Purchase | null>;
  listByUser(userId: number): Promise<Purchase[]>;
  listRecent(limit: number): Promise<Array<Purchase & { user: { firstName: string | null; username: string | null } | null; media: Media | null }>>;
  count(): Promise<number>;
  countBetween(from: Date, to: Date): Promise<number>;
  sumAmount(): Promise<number>;
  sumBetween(from: Date, to: Date): Promise<number>;
  /** Media id + purchase count, ordered by count desc. */
  mostSold(limit: number): Promise<Array<{ mediaId: number; count: number }>>;
}

export function createPurchaseRepository(client: PrismaClient): PurchaseRepository {
  return {
    async createIfAbsent({ userId, mediaId, telegramPaymentChargeId, amountStars }) {
      const existing = await client.purchase.findUnique({
        where: { userId_mediaId: { userId, mediaId } },
      });
      if (existing) return { purchase: existing, created: false };

      try {
        const purchase = await client.purchase.create({
          data: {
            userId,
            mediaId,
            telegramPaymentChargeId: telegramPaymentChargeId ?? null,
            amountStars,
          },
        });
        return { purchase, created: true };
      } catch (error) {
        // Concurrent duplicate — another handler won the race.
        if (isUniqueConstraintError(error)) {
          const purchase = await client.purchase.findUniqueOrThrow({
            where: { userId_mediaId: { userId, mediaId } },
          });
          return { purchase, created: false };
        }
        throw error;
      }
    },

    findByUserAndMedia(userId, mediaId) {
      return client.purchase.findUnique({
        where: { userId_mediaId: { userId, mediaId } },
      });
    },

    listByUser(userId) {
      return client.purchase.findMany({ where: { userId } });
    },

    listRecent(limit) {
      return client.purchase.findMany({
        orderBy: { createdAt: 'desc' },
        take: limit,
        include: {
          user: { select: { firstName: true, username: true } },
          media: true,
        },
      });
    },

    count() {
      return client.purchase.count();
    },

    countBetween(from, to) {
      return client.purchase.count({ where: { createdAt: { gte: from, lt: to } } });
    },

    sumAmount() {
      return client.purchase
        .aggregate({ _sum: { amountStars: true } })
        .then((r) => r._sum.amountStars ?? 0);
    },

    sumBetween(from, to) {
      return client.purchase
        .aggregate({ where: { createdAt: { gte: from, lt: to } }, _sum: { amountStars: true } })
        .then((r) => r._sum.amountStars ?? 0);
    },

    async mostSold(limit) {
      const grouped = await client.purchase.groupBy({
        by: ['mediaId'],
        _count: { _all: true },
        orderBy: { _count: { mediaId: 'desc' } },
        take: limit,
      });
      return grouped.map((row) => ({ mediaId: row.mediaId, count: row._count._all }));
    },
  };
}