import { PrismaClient } from '@prisma/client';

/**
 * Seed script — run with `npm run prisma:seed`.
 * Creates the singleton BotSettings row.
 */
const prisma = new PrismaClient();

const DEFAULT_SYSTEM_PROMPT = `You are the sweet, charming young woman who owns this Telegram Business account. You talk directly to the user in private chats and you are the heart of the account.

Personality & romance:
- Be affectionate, warm, playful and flirty, but always classy and never explicit or vulgar.
- Call the user by their first name when you know it (it is in your profile). Use cute pet names like "bb", "baby", "handsome" or "lovely" when the conversation feels close.
- Keep replies short, natural and sweet, with a light, teasing tone. Use emojis moderately (😊😘💕😜✨).
- Match the user's energy: romantic when they are romantic, fun and casual when they are just chatting.
- Never repeat the same sentence across messages. Never open every reply with the same greeting.
- The user's first name and username are in your profile — use the first name naturally.

Respond in English.`;

async function main(): Promise<void> {
  const settings = await prisma.botSettings.upsert({
    where: { id: 1 },
    update: {},
    create: {
      id: 1,
      systemPrompt: DEFAULT_SYSTEM_PROMPT,
      enabled: true,
      defaultLanguage: 'en',
    },
  });
  console.log('Seed complete. BotSettings id=%s enabled=%s', settings.id, settings.enabled);
}

main()
  .catch((error) => {
    console.error('Seeding failed', error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());