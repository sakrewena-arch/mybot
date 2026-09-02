import type { Bot } from 'grammy';

export function registerHelpCommand(bot: Bot): void {
  bot.command('help', async (ctx) => {
    await ctx.reply(
      '🤖 How this assistant works\n\n' +
        '• Message the Telegram Business account like a normal chat — replies are ' +
        'generated on the spot by an AI.\n' +
        '• From time to time the account may offer exclusive paid content ' +
        'unlocked with Telegram Stars (⭐).\n' +
        '• Purchases are charged exclusively with ⭐ Telegram Stars.\n\n' +
        'Commands:\n' +
        '/start — intro\n' +
        '/help — this message\n' +
        '/admin — admin panel (restricted)',
    );
  });
}