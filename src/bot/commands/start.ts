import type { Bot } from 'grammy';
import { logger } from '../../utils/logger.js';

export function registerStartCommand(bot: Bot): void {
  bot.command('start', async (ctx) => {
    logger.info({ userId: ctx.from?.id }, '/start');
    await ctx.reply(
      '👋 Hi! I run this account\u2019s Telegram Business assistant.\n\n' +
        'If you message the business account, it answers directly — I am just the engine behind the scenes.\n\n' +
        'Available commands:\n' +
        '• /help — how it works\n' +
        '• /admin — administration panel (admins only)',
    );
  });
}