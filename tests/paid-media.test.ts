import { describe, it, expect } from 'vitest';
import { createPaidMediaService } from '../src/bot/payments/paid-media.js';
import {
  createFakeApi,
  InMemoryBusinessRepository,
  InMemoryMediaRepository,
  InMemoryPurchaseRepository,
  makeBusinessConnection,
  makeMedia,
} from './helpers/fakes.js';

function setup(overrides: {
  canReply?: boolean;
  isEnabled?: boolean;
  allowedChatIds?: Set<number>;
} = {}) {
  const { api, calls } = createFakeApi();
  const businessRepository = new InMemoryBusinessRepository([
    makeBusinessConnection({
      businessConnectionId: 'conn-1',
      canReply: overrides.canReply ?? true,
      isEnabled: overrides.isEnabled ?? true,
    }),
  ]);
  const mediaRepository = new InMemoryMediaRepository();
  const purchaseRepository = new InMemoryPurchaseRepository();
  const service = createPaidMediaService({
    api,
    businessRepository,
    mediaRepository,
    purchaseRepository,
    allowedChatIds: overrides.allowedChatIds ?? new Set(),
  });
  return { api, calls, businessRepository, mediaRepository, purchaseRepository, service };
}

const user = { id: 1, chatId: 555 };

describe('paid media service', () => {
  it('sends a paid photo with the correct parameters', async () => {
    const { service, calls, mediaRepository } = setup();
    mediaRepository.rows.push(makeMedia({ id: 1, priceStars: 25 }));

    const result = await service.sendPaidMedia({
      businessConnectionId: 'conn-1',
      userId: user.id,
      chatId: user.chatId,
      media: { id: 1 },
    });

    expect(result.starCount).toBe(25);
    const send = calls[0];
    expect(send?.kind).toBe('sendPaidMedia');
    const args = send?.args as Record<string, unknown>;
    expect(args['business_connection_id']).toBe('conn-1');
    expect(args['chat_id']).toBe(555);
    expect(args['star_count']).toBe(25);
    expect(args['media']).toEqual([{ type: 'photo', media: 'file://photo-1' }]);
    expect(JSON.parse(args['payload'] as string)).toEqual({ mediaId: 1 });
  });

  it('sends a paid video with its thumbnail', async () => {
    const { service, calls, mediaRepository } = setup();
    mediaRepository.rows.push(
      makeMedia({
        id: 2,
        type: 'VIDEO',
        telegramFileId: 'file://video',
        thumbnailFileId: 'file://thumb',
        priceStars: 50,
      }),
    );

    await service.sendPaidVideo({
      businessConnectionId: 'conn-1',
      userId: user.id,
      chatId: user.chatId,
      media: { id: 2 },
    });

    const args = calls[0]?.args as { media: Array<Record<string, string>> };
    expect(args.media[0]?.type).toBe('video');
    expect(args.media[0]?.thumbnail).toBe('file://thumb');
  });

  it('rejects a missing business connection', async () => {
    const { service, mediaRepository } = setup();
    mediaRepository.rows.push(makeMedia({ id: 1 }));

    await expect(
      service.sendPaidMedia({
        businessConnectionId: 'unknown',
        userId: user.id,
        chatId: user.chatId,
        media: { id: 1 },
      }),
    ).rejects.toMatchObject({ code: 'CONNECTION_DISABLED' });
  });

  it('rejects when can_reply is missing', async () => {
    const { service, mediaRepository } = setup({ canReply: false });
    mediaRepository.rows.push(makeMedia({ id: 1 }));

    await expect(
      service.sendPaidMedia({
        businessConnectionId: 'conn-1',
        userId: user.id,
        chatId: user.chatId,
        media: { id: 1 },
      }),
    ).rejects.toMatchObject({ code: 'CANNOT_REPLY' });
  });

  it('rejects inactive media', async () => {
    const { service, mediaRepository } = setup();
    mediaRepository.rows.push(makeMedia({ id: 1, active: false }));

    await expect(
      service.sendPaidMedia({
        businessConnectionId: 'conn-1',
        userId: user.id,
        chatId: user.chatId,
        media: { id: 1 },
      }),
    ).rejects.toMatchObject({ code: 'MEDIA_UNAVAILABLE' });
  });

  it('rejects a chat outside the allowlist', async () => {
    const { service, mediaRepository } = setup({ allowedChatIds: new Set([999]) });
    mediaRepository.rows.push(makeMedia({ id: 1 }));

    await expect(
      service.sendPaidMedia({
        businessConnectionId: 'conn-1',
        userId: user.id,
        chatId: user.chatId,
        media: { id: 1 },
      }),
    ).rejects.toMatchObject({ code: 'CHAT_NOT_ALLOWED' });
  });

  it('never asks an existing buyer to pay twice', async () => {
    const { service, mediaRepository, purchaseRepository } = setup();
    mediaRepository.rows.push(makeMedia({ id: 1, priceStars: 25 }));
    purchaseRepository.rows.push({
      id: 1,
      userId: 1,
      mediaId: 1,
      telegramPaymentChargeId: null,
      amountStars: 25,
      createdAt: new Date(),
    });

    await expect(
      service.sendPaidMedia({
        businessConnectionId: 'conn-1',
        userId: user.id,
        chatId: user.chatId,
        media: { id: 1 },
      }),
    ).rejects.toMatchObject({ code: 'ALREADY_PURCHASED' });
  });
});