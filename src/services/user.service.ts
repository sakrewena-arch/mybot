import type { User } from '@prisma/client';
import type { TelegramUserDto } from '../types/telegram.js';
import type { UserRepository } from '../database/repositories/user.repository.js';

export interface UserService {
  syncFromTelegram(dto: TelegramUserDto): Promise<User>;
  findById(id: number): Promise<User | null>;
  count(): Promise<number>;
}

export function createUserService(userRepository: UserRepository): UserService {
  return {
    syncFromTelegram(dto) {
      return userRepository.upsertFromTelegram(dto);
    },
    findById(id) {
      return userRepository.findById(id);
    },
    count() {
      return userRepository.count();
    },
  };
}