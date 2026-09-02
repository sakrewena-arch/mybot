import type { PrismaClient, Media } from '@prisma/client';
import { z } from 'zod';

export const mediaIdSchema = z.coerce.number().int().positive();

export type MediaTypeName = 'PHOTO' | 'VIDEO';
export type MediaTriggerName = 'MESSAGE_COUNT' | 'TIME' | 'AI' | 'MANUAL' | 'NONE';

export interface CreateMediaInput {
  title: string;
  description?: string | null;
  type: MediaTypeName;
  telegramFileId: string;
  thumbnailFileId?: string | null;
  priceStars: number;
  triggerType: MediaTriggerName;
  triggerValue?: number | null;
}

export interface MediaRepository {
  create(input: CreateMediaInput): Promise<Media>;
  findById(id: number): Promise<Media | null>;
  findActiveById(id: number): Promise<Media | null>;
  listActive(): Promise<Media[]>;
  listAll(): Promise<Media[]>;
  listByIds(ids: number[]): Promise<Media[]>;
  update(id: number, data: Partial<CreateMediaInput>): Promise<Media | null>;
  setActive(id: number, active: boolean): Promise<Media | null>;
  softDelete(id: number): Promise<Media | null>;
  count(): Promise<number>;
  countActive(): Promise<number>;
}

export function createMediaRepository(client: PrismaClient): MediaRepository {
  return {
    create(input) {
      return client.media.create({
        data: {
          title: input.title,
          description: input.description ?? null,
          type: input.type,
          telegramFileId: input.telegramFileId,
          thumbnailFileId: input.thumbnailFileId ?? null,
          priceStars: input.priceStars,
          triggerType: input.triggerType,
          triggerValue: input.triggerValue ?? null,
        },
      });
    },

    findById(id) {
      return client.media.findUnique({ where: { id } });
    },

    findActiveById(id) {
      return client.media.findFirst({
        where: { id, active: true, deletedAt: null },
      });
    },

    listActive() {
      return client.media.findMany({
        where: { active: true, deletedAt: null },
        orderBy: { createdAt: 'asc' },
      });
    },

    listAll() {
      return client.media.findMany({
        where: { deletedAt: null },
        orderBy: { createdAt: 'asc' },
      });
    },

    listByIds(ids) {
      return client.media.findMany({ where: { id: { in: ids } } });
    },

    update(id, data) {
      return client.media.update({
        where: { id },
        data: {
          title: data.title,
          description: data.description ?? undefined,
          type: data.type,
          telegramFileId: data.telegramFileId,
          thumbnailFileId: data.thumbnailFileId ?? undefined,
          priceStars: data.priceStars,
          triggerType: data.triggerType,
          triggerValue: data.triggerValue ?? undefined,
        },
      });
    },

    setActive(id, active) {
      return client.media.update({ where: { id }, data: { active } });
    },

    softDelete(id) {
      return client.media.update({ where: { id }, data: { deletedAt: new Date(), active: false } });
    },

    count() {
      return client.media.count({ where: { deletedAt: null } });
    },

    countActive() {
      return client.media.count({ where: { active: true, deletedAt: null } });
    },
  };
}