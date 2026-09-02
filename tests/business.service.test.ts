import { describe, it, expect } from 'vitest';
import { createBusinessService } from '../src/services/business.service.js';
import { InMemoryBusinessRepository, createFakeApi } from './helpers/fakes.js';

const telegramUser = { id: 999, is_bot: false, first_name: 'Biz' } as never;

describe('business connection service', () => {
  it('persists an enabled connection including can_reply', async () => {
    const repository = new InMemoryBusinessRepository();
    const { api } = createFakeApi();
    const service = createBusinessService({ businessRepository: repository, api });

    const saved = await service.syncConnection({
      id: 'conn-1',
      user: telegramUser,
      user_chat_id: 999,
      date: Math.floor(Date.now() / 1000),
      is_enabled: true,
      rights: { can_reply: true, can_read_messages: true },
    });

    expect(saved.businessConnectionId).toBe('conn-1');
    expect(saved.canReply).toBe(true);
    expect(saved.isEnabled).toBe(true);
    expect(saved.businessUserId).toBe('999');
    expect(repository.rows).toHaveLength(1);
  });

  it('marks the connection disabled when Telegram disables it', async () => {
    const repository = new InMemoryBusinessRepository();
    const { api } = createFakeApi();
    const service = createBusinessService({ businessRepository: repository, api });

    await service.syncConnection({
      id: 'conn-1',
      user: telegramUser,
      user_chat_id: 999,
      date: Math.floor(Date.now() / 1000),
      is_enabled: true,
      rights: { can_reply: true },
    });
    const updated = await service.syncConnection({
      id: 'conn-1',
      user: telegramUser,
      user_chat_id: 999,
      date: Math.floor(Date.now() / 1000),
      is_enabled: false,
      rights: { can_reply: true },
    });

    expect(updated.isEnabled).toBe(false);
    expect(updated.canReply).toBe(false);
    expect(repository.rows).toHaveLength(1);
  });

  it('only returns enabled connections', async () => {
    const repository = new InMemoryBusinessRepository();
    const { api } = createFakeApi();
    const service = createBusinessService({ businessRepository: repository, api });

    await service.syncConnection({
      id: 'conn-1',
      user: telegramUser,
      user_chat_id: 999,
      date: 1,
      is_enabled: false,
      rights: undefined,
    });

    expect(await service.getEnabledConnection('conn-1')).toBeNull();
    expect(await service.getConnection('conn-1')).not.toBeNull();
  });
});