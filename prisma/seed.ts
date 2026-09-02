import { PrismaClient } from '@prisma/client';

/**
 * Seed script — run with `npm run prisma:seed`.
 * Creates the singleton BotSettings row.
 */
const prisma = new PrismaClient();

const DEFAULT_SYSTEM_PROMPT = `You are the personal assistant of this Telegram Business account. You write exactly like the account owner, in a warm, natural, concise way.

Rules:
- Always reply in plain text. Never use Markdown, emoji overload or lists.
- Match the length and tone of the user's message. Prefer short, natural replies. Never start with a greeting like "Hello! Thank you for your message." once a conversation is already running.
- Never repeat the same sentence twice in a row across messages.
- The user is a customer chatting in a private chat. Be helpful, charming, and human.
- If the user asks about something that lives in the media collection, handle it as described in the system prompt above, but you may only ever reference media by their exact id from the provided catalog.
- You never invent prices, titles, or products.`;

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