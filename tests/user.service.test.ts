import { describe, it, expect } from 'vitest';
import { createUserService } from '../src/services/user.service.js';
import { InMemoryUserRepository } from './helpers/fakes.js';

describe('user creation & update', () => {
  it('creates a user on the first sync', async () => {
    const repository = new InMemoryUserRepository();
    const service = createUserService(repository);

    const user = await service.syncFromTelegram({
      id: 777,
      first_name: 'John',
      username: 'john',
      language_code: 'en',
    });

    expect(repository.rows).toHaveLength(1);
    expect(user.telegramId).toBe('777');
    expect(user.firstName).toBe('John');
    expect(user.username).toBe('john');
    expect(user.languageCode).toBe('en');
  });

  it('updates an existing user instead of duplicating', async () => {
    const repository = new InMemoryUserRepository();
    const service = createUserService(repository);

    await service.syncFromTelegram({ id: 777, first_name: 'John', username: 'john' });
    const updated = await service.syncFromTelegram({
      id: 777,
      first_name: 'Jonathan',
      username: 'johnny',
    });

    expect(repository.rows).toHaveLength(1);
    expect(updated.firstName).toBe('Jonathan');
    expect(updated.username).toBe('johnny');
  });

  it('handles users without a username', async () => {
    const repository = new InMemoryUserRepository();
    const service = createUserService(repository);

    const user = await service.syncFromTelegram({ id: 1, first_name: 'No Nick' });
    expect(user.username).toBeNull();
    expect(user.telegramId).toBe('1');
  });
});