import type { PrismaClient, User } from '@prisma/client';
import type { TelegramUserDto } from '../../types/telegram.js';

export interface UserRepository {
  upsertFromTelegram(dto: TelegramUserDto): Promise<User>;
  findById(id: number): Promise<User | null>;
  findByTelegramId(telegramId: number): Promise<User | null>;
  count(): Promise<number>;
  listRecent(limit: number): Promise<User[]>;
}

export function createUserRepository(client: PrismaClient): UserRepository {
  return {
    async upsertFromTelegram(dto) {
      const data = {
        telegramId: String(dto.id),
        username: dto.username ?? null,
        firstName: dto.first_name ?? null,
        lastName: dto.last_name ?? null,
        languageCode: dto.language_code ?? null,
      };
      return client.user.upsert({
        where: { telegramId: data.telegramId },
        create: data,
        update: {
          username: data.username,
          firstName: data.firstName,
          lastName: data.lastName,
          languageCode: data.languageCode,
        },
      });
    },

    findById(id) {
      return client.user.findUnique({ where: { id } });
    },

    findByTelegramId(telegramId) {
      return client.user.findUnique({ where: { telegramId: String(telegramId) } });
    },

    count() {
      return client.user.count();
    },

    listRecent(limit) {
      return client.user.findMany({ orderBy: { createdAt: 'desc' }, take: limit });
    },
  };
}