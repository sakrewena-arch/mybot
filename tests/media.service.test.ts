import { describe, it, expect } from 'vitest';
import { createMediaService } from '../src/media/media.service.js';
import {
  InMemoryMediaRepository,
  InMemoryPurchaseRepository,
  makeMedia,
} from './helpers/fakes.js';

function setup() {
  const mediaRepository = new InMemoryMediaRepository();
  const purchaseRepository = new InMemoryPurchaseRepository();
  const service = createMediaService({ mediaRepository, purchaseRepository });
  return { mediaRepository, purchaseRepository, service };
}

describe('media creation + catalog', () => {
  it('creates a media with all fields', async () => {
    const { mediaRepository } = setup();

    const media = await mediaRepository.create({
      title: 'Summer pack',
      description: '10 exclusive photos',
      type: 'PHOTO',
      telegramFileId: 'file://summer-pack',
      thumbnailFileId: null,
      priceStars: 75,
      triggerType: 'MESSAGE_COUNT',
      triggerValue: 25,
    });

    expect(media.title).toBe('Summer pack');
    expect(media.type).toBe('PHOTO');
    expect(media.telegramFileId).toBe('file://summer-pack');
    expect(media.priceStars).toBe(75);
    expect(media.triggerType).toBe('MESSAGE_COUNT');
    expect(media.triggerValue).toBe(25);
    expect(media.active).toBe(true);
    expect(media.deletedAt).toBeNull();
  });

  it('only surfaces active, non-deleted media in the catalog', async () => {
    const { mediaRepository, service } = setup();
    mediaRepository.rows.push(
      makeMedia({ id: 1, active: true, deletedAt: null }),
      makeMedia({ id: 2, active: false, deletedAt: null }),
      makeMedia({ id: 3, active: true, deletedAt: new Date() }),
    );

    const catalog = await service.listActiveCatalog();
    expect(catalog.map((m) => m.id)).toEqual([1]);
  });

  it('soft delete hides the media and deactivates it', async () => {
    const { mediaRepository, service } = setup();
    mediaRepository.rows.push(makeMedia({ id: 1, active: true }));

    await mediaRepository.softDelete(1);

    expect(await service.listActiveCatalog()).toHaveLength(0);
    const stored = await mediaRepository.findById(1);
    expect(stored?.deletedAt).not.toBeNull();
    expect(stored?.active).toBe(false);
  });
});

describe('media service selection', () => {
  it('excludes media the user already owns', async () => {
    const { mediaRepository, purchaseRepository, service } = setup();
    mediaRepository.rows.push(
      makeMedia({ id: 1, priceStars: 10, triggerType: 'MESSAGE_COUNT', triggerValue: 5 }),
      makeMedia({ id: 2, priceStars: 20, triggerType: 'MESSAGE_COUNT', triggerValue: 5 }),
    );
    purchaseRepository.rows.push({
      id: 1,
      userId: 10,
      mediaId: 2,
      telegramPaymentChargeId: null,
      amountStars: 20,
      createdAt: new Date(),
    });

    const selected = await service.selectForUser({
      userId: 10,
      mode: 'message_count',
      messageCount: 10,
    });

    expect(selected?.id).toBe(1);
  });

  it('returns null when the user owns everything', async () => {
    const { mediaRepository, purchaseRepository, service } = setup();
    mediaRepository.rows.push(makeMedia({ id: 1, triggerType: 'MESSAGE_COUNT', triggerValue: 5 }));
    purchaseRepository.rows.push({
      id: 1,
      userId: 10,
      mediaId: 1,
      telegramPaymentChargeId: null,
      amountStars: 10,
      createdAt: new Date(),
    });

    const selected = await service.selectForUser({
      userId: 10,
      mode: 'message_count',
      messageCount: 10,
    });

    expect(selected).toBeNull();
  });

  it('only accepts an AI-suggested media that exists in the catalog', async () => {
    const { mediaRepository, service } = setup();
    mediaRepository.rows.push(makeMedia({ id: 7, triggerType: 'AI', triggerValue: null }));

    const accepted = await service.selectForUser({ userId: 1, mode: 'ai', suggestedMediaId: 7 });
    expect(accepted?.id).toBe(7);

    const rejected = await service.selectForUser({
      userId: 1,
      mode: 'ai',
      suggestedMediaId: 999,
    });
    expect(rejected).toBeNull();
  });
});