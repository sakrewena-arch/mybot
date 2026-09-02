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

    const app = createApp({ bot, webhookPath: '/telegram/webhook' });
    app.listen(env.port, () => {
      logger.info({ port: env.port }, 'webhook server listening');
    });
    return;
  }

  // Long polling (local development).
  const app = createApp({ bot, webhookPath: null });
  app.listen(env.port, () => {
    logger.info({ port: env.port }, 'health server listening');
  });

  await bot.start({
    allowed_updates: env.allowedUpdates as never,
    drop_pending_updates: true,
  });
  logger.info('bot started in polling mode');
}

main().catch((error: unknown) => {
  logger.fatal({ error: error instanceof Error ? error.message : String(error) }, 'fatal startup error');
  process.exit(1);
});