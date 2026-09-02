import type { Bot } from 'grammy';
import type { BusinessService } from '../../services/business.service.js';
import { logger } from '../../utils/logger.js';

/**
 * Handles `business_connection` updates.
 *
 * - persists the connection (+ permissions snapshot),
 * - refreshes on changes,
 * - marks the connection disabled when Telegram disables it
 *   (listening to the same update with `is_enabled = false`).
 */
export function registerBusinessConnectionHandler(
  bot: Bot,
  businessService: BusinessService,
): void {
  bot.on('business_connection', async (ctx) => {
    const connection = ctx.businessConnection;
    if (!connection) return;

    await businessService.syncConnection(connection);

    if (!connection.is_enabled) {
      logger.info(
        { connectionId: connection.id },
        'business connection disabled by Telegram — no further replies will be sent',
      );
    }
  });
}