import type { Bot } from 'grammy';
import type { PurchaseService } from '../../services/purchase.service.js';
import type { BusinessService } from '../../services/business.service.js';
import { STARS_CURRENCY } from './stars.js';
import { toErrorMessage } from '../../utils/errors.js';
import { logger } from '../../utils/logger.js';

export interface PaymentHandlerDeps {
  purchaseService: PurchaseService;
  businessService: BusinessService;
}

/**
 * Handles the Stars payment lifecycle for paid media.
 *
 * NEVER treat a button click as a payment. The trusted signals are:
 *
 * 1. `purchased_paid_media`  → user bought media sent with `sendPaidMedia`
 *    (payload is echoed back by Telegram verbatim).
 * 2. `message.successful_payment` (currency XTR) → invoice-style Stars
 *    payment, carrying `telegram_payment_charge_id`.
 *
 * Both go through PurchaseService which de-duplicates with a
 * (userId, mediaId) unique constraint.
 */
export function registerPaymentHandlers(bot: Bot, deps: PaymentHandlerDeps): void {
  bot.on('purchased_paid_media', async (ctx) => {
    const purchase = ctx.purchasedPaidMedia;
    if (!purchase) return;
    try {
      const result = await deps.purchaseService.confirmPaidMediaPurchase({
        buyer: purchase.from,
        payload: purchase.paid_media_payload,
      });
      if (result.created) {
        await deps.businessService.notifyPurchaseSuccess(purchase.from.id, result.media);
      }
    } catch (error) {
      logger.error({ error: toErrorMessage(error) }, 'purchased_paid_media handling failed');
    }
  });

  // Defensive: this bot never creates invoices, but if one is ever sent we
  // must still answer the query to avoid confusing the user.
  bot.on('pre_checkout_query', async (ctx) => {
    const query = ctx.update.pre_checkout_query;
    if (!query) return;
    try {
      if (query.currency !== STARS_CURRENCY) {
        await ctx.answerPreCheckoutQuery(false, {
          error_message: 'Only Telegram Stars are supported.',
        });
        return;
      }
      await ctx.answerPreCheckoutQuery(false, {
        error_message: 'Checkout is not available for this bot. Sorry!',
      });
    } catch (error) {
      logger.error({ error: toErrorMessage(error) }, 'pre_checkout_query handling failed');
    }
  });

  // Invoice-style Stars payments (only relevant if sendInvoice is ever used).
  bot.on('message:successful_payment', async (ctx) => {
    const payment = ctx.message.successful_payment;
    if (!payment || payment.currency !== STARS_CURRENCY) return;
    try {
      const result = await deps.purchaseService.confirmInvoicePayment({
        buyer: ctx.msg.from ?? ctx.from,
        invoicePayload: payment.invoice_payload,
        amountStars: payment.total_amount,
        telegramPaymentChargeId: payment.telegram_payment_charge_id,
      });
      if (result.created) {
        await deps.businessService.notifyPurchaseSuccess(
          ctx.msg.from?.id ?? ctx.from?.id ?? 0,
          result.media,
        );
      }
    } catch (error) {
      logger.error({ error: toErrorMessage(error) }, 'successful_payment handling failed');
    }
  });
}