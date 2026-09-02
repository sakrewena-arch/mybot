import { describe, it, expect } from 'vitest';
import { createPurchaseService } from '../src/services/purchase.service.js';
import {
  InMemoryUserRepository,
  InMemoryPurchaseRepository,
  InMemoryMediaRepository,
  makeMedia,
} from './helpers/fakes.js';

function setup() {
  const userRepository = new InMemoryUserRepository();
  const mediaRepository = new InMemoryMediaRepository();
  mediaRepository.rows.push(
    makeMedia({ id: 1, priceStars: 99 }),
    makeMedia({ id: 2, priceStars: 200, type: 'VIDEO' }),
  );
  const purchaseRepository = new InMemoryPurchaseRepository();
  const service = createPurchaseService({ userRepository, purchaseRepository, mediaRepository });
  return { userRepository, mediaRepository, purchaseRepository, service };
}

const buyer = { id: 123, first_name: 'Alice', username: 'alice', language_code: 'en' };

describe('purchase service', () => {
  it('creates a purchase from a purchased_paid_media payload', async () => {
    const { service, purchaseRepository } = setup();

    const result = await service.confirmPaidMediaPurchase({
      buyer,
      payload: JSON.stringify({ mediaId: 1 }),
    });

    expect(result.created).toBe(true);
    expect(result.media.priceStars).toBe(99);
    expect(purchaseRepository.rows).toHaveLength(1);
    expect(purchaseRepository.rows[0]?.amountStars).toBe(99);
  });

  it('stores the telegram charge id for invoice payments', async () => {
    const { service, purchaseRepository } = setup();

    const result = await service.confirmInvoicePayment({
      buyer,
      invoicePayload: 'media:2',
      amountStars: 200,
      telegramPaymentChargeId: 'charge-abc',
    });

    expect(result.created).toBe(true);
    expect(purchaseRepository.rows[0]?.telegramPaymentChargeId).toBe('charge-abc');
  });

  it('prevents double purchases', async () => {
    const { service, purchaseRepository } = setup();

    await service.confirmPaidMediaPurchase({ buyer, payload: JSON.stringify({ mediaId: 1 }) });
    const second = await service.confirmPaidMediaPurchase({
      buyer,
      payload: JSON.stringify({ mediaId: 1 }),
    });

    expect(second.created).toBe(false);
    expect(purchaseRepository.rows).toHaveLength(1);
  });

  it('rejects an unknown payload', async () => {
    const { service } = setup();
    await expect(
      service.confirmPaidMediaPurchase({ buyer, payload: 'garbage' }),
    ).rejects.toMatchObject({ code: 'INVALID_PAYLOAD' });
  });

  it('rejects a purchase for a deleted media', async () => {
    const { service, mediaRepository } = setup();
    mediaRepository.rows[0]!.deletedAt = new Date();

    await expect(
      service.confirmPaidMediaPurchase({ buyer, payload: JSON.stringify({ mediaId: 1 }) }),
    ).rejects.toMatchObject({ code: 'MEDIA_NOT_FOUND' });
  });

  it('reports owned media ids', async () => {
    const { service } = setup();
    await service.confirmPaidMediaPurchase({ buyer, payload: JSON.stringify({ mediaId: 1 }) });

    const owned = await service.listOwnedMediaIds(1);
    expect(owned.has(1)).toBe(true);
    expect(owned.has(2)).toBe(false);
  });
});