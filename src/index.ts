import { env } from './config/env.js';
import { prisma } from './database/prisma.js';
import { createBot } from './bot/bot.js';
import { createApp } from './app.js';
import { createSettingsRepository } from './database/repositories/settings.repository.js';
import { DEFAULT_SYSTEM_PROMPT } from './ai/prompt.service.js';
import { logger } from './utils/logger.js';

async function main(): Promise<void> {
  logger.info({ nodeEnv: env.nodeEnv }, 'starting mybot');

  // Fail fast if the database is unreachable.
  await prisma.$queryRaw`SELECT 1`;
  logger.info('database connection ok');

  // Guarantee the singleton BotSettings row exists (personality, toggles).
  const settingsRepository = createSettingsRepository(prisma, DEFAULT_SYSTEM_PROMPT);
  const settings = await settingsRepository.getSettings();
  logger.info({ enabled: settings.enabled }, 'bot settings ready');

  const bot = createBot();

  // Diagnostic: verify each AI provider can actually be reached (bad key /
  // URL / balance shows up here at startup instead of only at reply time).
  void bot.api
    .getMe()
    .then((me) => logger.info({ botUsername: me.username }, 'bot identity confirmed'))
    .catch((error: unknown) =>
      logger.warn(
        { error: error instanceof Error ? error.message : String(error) },
        'getMe failed',
      ),
    );

  if (env.pollingMode === 'webhook') {
    if (!env.webhookUrl) {
      throw new Error('POLLING_MODE=webhook requires WEBHOOK_URL');
    }
    await bot.api.setWebhook(env.webhookUrl, {
      ...(env.webhookSecret ? { secret_token: env.webhookSecret } : {}),
      allowed_updates: env.allowedUpdates as never,
      drop_pending_updates: true,
    });
    logger.info({ webhookUrl: env.webhookUrl }, 'webhook registered');

    // Diagnostic aid: dump what Telegram actually has registered, so a wrong
    // WEBHOOK_URL is visible in the logs instead of silently dropping updates.
    bot.api
      .getWebhookInfo()
      .then((info) =>
        logger.info(
          {
            url: info.url,
            pendingUpdateCount: info.pending_update_count,
            lastError: info.last_error_message ?? undefined,
            allowedUpdates: info.allowed_updates ?? undefined,
          },
          'webhook info',
        ),
      )
      .catch((error: unknown) =>
        logger.warn(
          { error: error instanceof Error ? error.message : String(error) },
          'getWebhookInfo failed',
        ),
      );

    const app = createApp({ bot, webhookPath: '/telegram/webhook' });
    app.listen(env.port, () => {
      logger.info({ port: env.port }, 'webhook server listening');
    });
    return;
  }

  // Long polling (local development or sleep-tolerant hosts).
  const app = createApp({ bot, webhookPath: null });
  app.listen(env.port, () => {
    logger.info({ port: env.port }, 'health server listening');
  });

  await bot.start({
    allowed_updates: env.allowedUpdates as never,
    // Do NOT drop pending updates: if the instance slept and misses messages,
    // they are processed on reconnect instead of being silently discarded.
    drop_pending_updates: false,
  });
  logger.info('bot started in polling mode');
}

main().catch((error: unknown) => {
  logger.fatal({ error: error instanceof Error ? error.message : String(error) }, 'fatal startup error');
  process.exit(1);
});