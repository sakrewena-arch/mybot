import type { Bot, Context } from 'grammy';
import type { Media } from '@prisma/client';
import type { EnvConfig } from '../../config/env.js';
import type { UserRepository } from '../../database/repositories/user.repository.js';
import type { MediaRepository } from '../../database/repositories/media.repository.js';
import type { PurchaseRepository } from '../../database/repositories/purchase.repository.js';
import type { ConversationRepository } from '../../database/repositories/conversation.repository.js';
import type { ProposalRepository } from '../../database/repositories/proposal.repository.js';
import type { SettingsRepository } from '../../database/repositories/settings.repository.js';
import type { BusinessService } from '../../services/business.service.js';
import type { PurchaseService } from '../../services/purchase.service.js';
import type { ConversationService } from '../../services/conversation.service.js';
import type { PaidMediaService } from '../payments/paid-media.js';
import { logger } from '../../utils/logger.js';
import {
  adminMenuKeyboard,
  mediaItemKeyboard,
  mediaListKeyboard,
  settingsKeyboard,
  triggerTypeKeyboard,
  wizardTriggerKeyboard,
  ADMIN_MENU_CB,
  ADMIN_MEDIA_CB,
  ADMIN_USERS_CB,
  ADMIN_PURCHASES_CB,
  ADMIN_CONVERSATIONS_CB,
  ADMIN_SETTINGS_CB,
  ADMIN_STATS_CB,
  ADMIN_CLOSE_CB,
  MEDIA_ADD_CB,
  MEDIA_REFRESH_CB,
} from '../keyboards/index.js';

export interface AdminDeps {
  env: EnvConfig;
  userRepository: UserRepository;
  mediaRepository: MediaRepository;
  purchaseRepository: PurchaseRepository;
  conversationRepository: ConversationRepository;
  proposalRepository: ProposalRepository;
  settingsRepository: SettingsRepository;
  purchaseService: PurchaseService;
  conversationService: ConversationService;
  businessService: BusinessService;
  paidMediaService: PaidMediaService;
}

type Wizard =
  | { step: 'add:title' }
  | { step: 'add:description'; title: string }
  | { step: 'add:media'; title: string; description: string }
  | { step: 'add:price'; title: string; description: string; telegramFileId: string; type: 'PHOTO' | 'VIDEO' }
  | {
      step: 'add:trigger';
      title: string;
      description: string;
      telegramFileId: string;
      type: 'PHOTO' | 'VIDEO';
      priceStars: number;
    }
  | {
      step: 'confirm';
      title: string;
      description: string;
      telegramFileId: string;
      type: 'PHOTO' | 'VIDEO';
      priceStars: number;
      triggerType: 'MESSAGE_COUNT' | 'TIME' | 'AI' | 'MANUAL' | 'NONE';
    }
  | { step: 'set_price'; mediaId: number }
  | { step: 'set_title'; mediaId: number }
  | { step: 'set_desc'; mediaId: number }
  | { step: 'edit_prompt' };

/** In-memory admin wizards. Simple and stateless — restart clears them. */
const wizards = new Map<number, Wizard>();

function isAdmin(ctx: Context, env: EnvConfig): boolean {
  const id = ctx.from?.id;
  return id !== undefined && env.adminIds.has(id);
}

async function deny(c: Context): Promise<void> {
  await c.reply('⛔ Unauthorized. This panel is restricted to admins.');
}

function formatMedia(m: Media): string {
  return (
    `#${m.id} — ${m.title}\n` +
    `   type=${m.type.toLowerCase()} price=${m.priceStars}⭐ active=${m.active} trigger=${m.triggerType}${m.triggerValue ? `(${m.triggerValue})` : ''}`
  );
}

function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}
async function showMediaList(c: Context, deps: AdminDeps): Promise<void> {
  const media = await deps.mediaRepository.listAll();
  const text =
    media.length === 0
      ? '📼 No media yet. Use “➕ Add media”.'
      : '📼 Media catalog:\n' + media.map(formatMedia).join('\n');
  await c.reply(text, { reply_markup: mediaListKeyboard(media.map((m) => m.id)) });
}

export function registerAdminCommands(bot: Bot, deps: AdminDeps): void {
  bot.command('admin', async (ctx) => {
    if (!isAdmin(ctx, deps.env)) return deny(ctx);
    wizards.delete(ctx.from!.id);
    await ctx.reply('🛠 Admin panel — choose a section:', {
      reply_markup: adminMenuKeyboard(),
    });
  });

  bot.command('stats', async (ctx) => {
    if (!isAdmin(ctx, deps.env)) return deny(ctx);
    await ctx.reply(await buildStats(deps));
  });

  bot.command('addmedia', async (ctx) => {
    if (!isAdmin(ctx, deps.env)) return deny(ctx);
    await startAddMediaWizard(ctx);
  });

  // MANUAL trigger: /propose <mediaId> <telegramUserId>
  // Sends the media as paid media into the user's most recent business chat.
  bot.command('propose', async (ctx) => {
    if (!isAdmin(ctx, deps.env)) return deny(ctx);
    const parts = (ctx.match ?? '').trim().split(/\s+/);
    const mediaId = Number(parts[0]);
    const telegramUserId = Number(parts[1]);
    if (!Number.isSafeInteger(mediaId) || mediaId <= 0 || !Number.isSafeInteger(telegramUserId) || telegramUserId <= 0) {
      await ctx.reply('Usage: /propose <mediaId> <telegramUserId>');
      return;
    }
    const media = await deps.mediaRepository.findActiveById(mediaId);
    if (!media) {
      await ctx.reply(`❌ No active media #${mediaId}.`);
      return;
    }
    const user = await deps.userRepository.findByTelegramId(telegramUserId);
    if (!user) {
      await ctx.reply(`❌ Unknown user ${telegramUserId}.`);
      return;
    }
    const conversations = await deps.conversationRepository.listByUser(user.id, 1);
    const conversation = conversations[0];
    if (!conversation) {
      await ctx.reply(`❌ User has no conversations yet.`);
      return;
    }
    const conversationRow = await deps.conversationRepository.findById(conversation.id);
    if (!conversationRow) {
      await ctx.reply('❌ Conversation not found.');
      return;
    }
    const businessConnection = conversationRow.businessConnection;
    if (!businessConnection || !businessConnection.isEnabled || !businessConnection.canReply) {
      await ctx.reply('❌ The business connection cannot reply right now.');
      return;
    }
    try {
      await deps.paidMediaService.sendPaidMedia({
        businessConnectionId: businessConnection.businessConnectionId,
        userId: user.id,
        chatId: Number(conversation.chatId),
        media: { id: media.id },
      });
      await deps.proposalRepository.create({
        userId: user.id,
        mediaId: media.id,
        conversationId: conversation.id,
        status: 'SENT',
        reason: 'manual /propose by admin',
      });
      await ctx.reply(`✅ Paid media #${media.id} offered to user ${telegramUserId}.`);
    } catch (error) {
      await deps.proposalRepository.create({
        userId: user.id,
        mediaId: media.id,
        conversationId: conversation.id,
        status: 'FAILED',
        reason: error instanceof Error ? error.message : String(error),
      });
      await ctx.reply(`❌ Could not send: ${error instanceof Error ? error.message : String(error)}`);
    }
  });

  bot.on('callback_query:data', async (ctx) => {
    if (!isAdmin(ctx, deps.env)) {
      await ctx.answerCallbackQuery({ text: '⛔ Restricted' });
      return;
    }
    const data = ctx.callbackQuery.data;
    await ctx.answerCallbackQuery();

    if (data === ADMIN_CLOSE_CB) return undefined;

    if (data === ADMIN_MENU_CB) {
      return ctx.editMessageText('🛠 Admin panel — choose a section:', {
        reply_markup: adminMenuKeyboard(),
      });
    }

    if (data === ADMIN_MEDIA_CB || data === MEDIA_REFRESH_CB) {
      return showMediaList(ctx, deps);
    }

    if (data === ADMIN_USERS_CB) {
      const users = await deps.userRepository.listRecent(10);
      const total = await deps.userRepository.count();
      const text =
        `👥 Users (${total} total, last 10):\n` +
        (users.length === 0
          ? '  none yet'
          : users
              .map(
                (u) =>
                  `• @${u.username ?? '—'} (${u.firstName ?? 'no name'}) tg=${u.telegramId.slice(0, 6)}…`,
              )
              .join('\n'));
      return ctx.editMessageText(text);
    }

    if (data === ADMIN_PURCHASES_CB) {
      const purchases = await deps.purchaseRepository.listRecent(15);
      const text =
        `💰 Purchases (last 15):\n` +
        (purchases.length === 0
          ? '  none yet'
          : purchases
              .map(
                (p) =>
                  `• ${p.createdAt.toISOString().slice(0, 16)} — user#${p.userId} media#${p.mediaId} ${p.amountStars}⭐`,
              )
              .join('\n'));
      return ctx.editMessageText(text);
    }

    if (data === ADMIN_CONVERSATIONS_CB) {
      const conversations = await deps.conversationRepository.listRecent(15);
      const total = await deps.conversationRepository.count();
      const text =
        `💬 Conversations (${total} total, last 15):\n` +
        (conversations.length === 0
          ? '  none yet'
          : conversations
              .map(
                (c) =>
                  `• chat=${c.chatId} msgs=${c.messageCount} last=${c.lastMessageAt.toISOString().slice(0, 16)}`,
              )
              .join('\n'));
      return ctx.editMessageText(text);
    }

    if (data === ADMIN_SETTINGS_CB) {
      const settings = await deps.settingsRepository.getSettings();
      return ctx.editMessageText(
        `⚙️ Settings\n\n` +
          `enabled: ${settings.enabled}\n` +
          `defaultLanguage: ${settings.defaultLanguage}\n` +
          `systemPrompt (${settings.systemPrompt.length} chars):\n` +
          settings.systemPrompt.slice(0, 600) +
          (settings.systemPrompt.length > 600 ? '…' : ''),
        { reply_markup: settingsKeyboard(settings.enabled) },
      );
    }

    if (data === 'settings:toggle') {
      const settings = await deps.settingsRepository.getSettings();
      const updated = await deps.settingsRepository.setEnabled(!settings.enabled);
      return ctx.editMessageText(`⚙️ Bot is now ${updated.enabled ? 'ENABLED' : 'DISABLED'}.`, {
        reply_markup: settingsKeyboard(updated.enabled),
      });
    }

    if (data === 'settings:edit_prompt') {
      wizards.set(ctx.from!.id, { step: 'edit_prompt' });
      return ctx.reply('📝 Send the new system prompt (a single message):');
    }

    if (data === ADMIN_STATS_CB) {
      return ctx.editMessageText(await buildStats(deps));
    }

    if (data === MEDIA_ADD_CB) {
      return startAddMediaWizard(ctx);
    }
if (data.startsWith('media:show:')) {
      const id = Number(data.split(':')[2]);
      const media = await deps.mediaRepository.findById(id);
      if (!media) return ctx.editMessageText('❌ Media not found.');
      return ctx.editMessageText(formatMedia(media), {
        reply_markup: mediaItemKeyboard(id),
      });
    }

    if (data.startsWith('media:toggle:')) {
      const id = Number(data.split(':')[2]);
      const media = await deps.mediaRepository.findById(id);
      if (!media) return ctx.editMessageText('❌ Media not found.');
      const updated = await deps.mediaRepository.setActive(id, !media.active);
      return ctx.editMessageText(`#${id} is now ${updated?.active ? 'ACTIVE' : 'INACTIVE'}.`, {
        reply_markup: mediaItemKeyboard(id),
      });
    }

    if (data.startsWith('media:price:')) {
      const id = Number(data.split(':')[2]);
      wizards.set(ctx.from!.id, { step: 'set_price', mediaId: id });
      return ctx.reply(`💵 New price (Stars, 1-25000) for media #${id}:`);
    }

    if (data.startsWith('media:title:')) {
      const id = Number(data.split(':')[2]);
      wizards.set(ctx.from!.id, { step: 'set_title', mediaId: id });
      return ctx.reply(`✏️ New title for media #${id} (max 128 chars):`);
    }

    if (data.startsWith('media:desc:')) {
      const id = Number(data.split(':')[2]);
      wizards.set(ctx.from!.id, { step: 'set_desc', mediaId: id });
      return ctx.reply(`📝 New description for media #${id} (send /skip to clear):`);
    }

    if (data.startsWith('media:trigger:')) {
      const id = Number(data.split(':')[2]);
      return ctx.editMessageText(`🎯 Choose trigger for media #${id}:`, {
        reply_markup: triggerTypeKeyboard(id),
      });
    }

    if (data.startsWith('media:set_trigger:')) {
      const [, , idRaw, trigger] = data.split(':');
      const id = Number(idRaw);
      if (id <= 0) return undefined;
      await deps.mediaRepository.update(id, {
        triggerType: trigger as 'MESSAGE_COUNT' | 'TIME' | 'AI' | 'MANUAL' | 'NONE',
      });
      return ctx.editMessageText(`✅ Trigger of #${id} set to ${trigger}.`, {
        reply_markup: mediaItemKeyboard(id),
      });
    }

    if (data.startsWith('media:del:')) {
      const id = Number(data.split(':')[2]);
      await deps.mediaRepository.softDelete(id);
      return ctx.editMessageText(`🗑 Media #${id} soft-deleted.`);
    }

    if (data.startsWith('wizard:trigger:')) {
      const type = data.split(':')[2] as 'MESSAGE_COUNT' | 'TIME' | 'AI' | 'MANUAL' | 'NONE';
      const wizard = wizards.get(ctx.from!.id);
      if (!wizard || wizard.step !== 'add:trigger') return undefined;
      const summary =
        `Confirm media\n\n` +
        `title: ${wizard.title}\ndescription: ${wizard.description || '(none)'}\n` +
        `file_id: ${wizard.telegramFileId.slice(0, 30)}…\ntype: ${wizard.type}\n` +
        `price: ${wizard.priceStars}⭐\ntrigger: ${type}`;
      wizards.set(ctx.from!.id, {
        step: 'confirm',
        title: wizard.title,
        description: wizard.description,
        telegramFileId: wizard.telegramFileId,
        type: wizard.type,
        priceStars: wizard.priceStars,
        triggerType: type,
      });
      return ctx.reply(summary, {
        reply_markup: {
          inline_keyboard: [
            [{ text: '✅ Confirm', callback_data: 'wizard:confirm' }],
            [{ text: '❌ Cancel', callback_data: 'wizard:cancel' }],
          ],
        },
      });
    }

    if (data === 'wizard:confirm') {
      const wizard = wizards.get(ctx.from!.id);
      if (!wizard || wizard.step !== 'confirm') return undefined;
      await deps.mediaRepository.create({
        title: wizard.title,
        description: wizard.description,
        type: wizard.type,
        telegramFileId: wizard.telegramFileId,
        priceStars: wizard.priceStars,
        triggerType: wizard.triggerType,
        triggerValue: wizard.triggerType === 'MESSAGE_COUNT' ? 10 : null,
      });
      wizards.delete(ctx.from!.id);
      logger.info({ adminId: ctx.from!.id }, 'media added');
      return ctx.editMessageText('✅ Media added to the catalog.');
    }

    if (data === 'wizard:cancel') {
      wizards.delete(ctx.from!.id);
      return ctx.editMessageText('Cancelled.');
    }
  });
// ── Add/edit media wizard ─────────────────────────────────────────────────

bot.on('message:text', async (ctx) => {
    if (!ctx.chat.type.includes('private')) return;
    if (!isAdmin(ctx, deps.env)) return;

    const wizard = wizards.get(ctx.from!.id);
    if (!wizard) return;
    const text = ctx.message.text.trim();

    if (wizard.step === 'add:title') {
      if (text.length > 128) return ctx.reply('Title too long (max 128 chars).');
      wizards.set(ctx.from!.id, { step: 'add:description', title: text });
      return ctx.reply('📝 Optional short description (send /skip to skip):');
    }

    if (wizard.step === 'add:description') {
      const description = text === '/skip' ? '' : text;
      wizards.set(ctx.from!.id, { step: 'add:media', title: wizard.title, description });
      return ctx.reply('🖼 Now send the PHOTO or VIDEO to sell:');
    }

    if (wizard.step === 'add:price') {
      const price = Number(text);
      if (!Number.isSafeInteger(price) || price < 1 || price > 25000) {
        return ctx.reply('Invalid price. Use whole numbers between 1 and 25000.');
      }
      wizards.set(ctx.from!.id, {
        step: 'add:trigger',
        title: wizard.title,
        description: wizard.description,
        telegramFileId: wizard.telegramFileId,
        type: wizard.type,
        priceStars: price,
      });
      return ctx.reply('🎯 Pick a trigger type:', { reply_markup: wizardTriggerKeyboard() });
    }

    if (wizard.step === 'set_price') {
      const price = Number(text);
      if (!Number.isSafeInteger(price) || price < 1 || price > 25000) {
        return ctx.reply('Invalid price. Use whole numbers between 1 and 25000.');
      }
      await deps.mediaRepository.update(wizard.mediaId, { priceStars: price });
      wizards.delete(ctx.from!.id);
      return ctx.reply(`✅ Price of media #${wizard.mediaId} set to ${price}⭐.`);
    }

    if (wizard.step === 'set_title') {
      if (text.length > 128) return ctx.reply('Title too long (max 128 chars).');
      await deps.mediaRepository.update(wizard.mediaId, { title: text });
      wizards.delete(ctx.from!.id);
      return ctx.reply(`✅ Title of media #${wizard.mediaId} updated.`);
    }

    if (wizard.step === 'set_desc') {
      const description = text === '/skip' ? '' : text;
      await deps.mediaRepository.update(wizard.mediaId, { description });
      wizards.delete(ctx.from!.id);
      return ctx.reply(`✅ Description of media #${wizard.mediaId} updated.`);
    }

    if (wizard.step === 'edit_prompt') {
      await deps.settingsRepository.updateSystemPrompt(text);
      wizards.delete(ctx.from!.id);
      return ctx.reply('✅ System prompt updated.');
    }
  });

  // Media capture step for the add-media wizard.
  bot.on(['message:photo', 'message:video'], async (ctx) => {
    if (!isAdmin(ctx, deps.env)) return;
    const wizard = wizards.get(ctx.from!.id);
    if (!wizard || wizard.step !== 'add:media') return;

    const photo = ctx.message.photo;
    const video = ctx.message.video;
    if (!photo && !video) return;

    const telegramFileId = photo
      ? photo[photo.length - 1].file_id
      : video!.file_id;
    const type: 'PHOTO' | 'VIDEO' = photo ? 'PHOTO' : 'VIDEO';

    wizards.set(ctx.from!.id, {
      step: 'add:price',
      title: wizard.title,
      description: wizard.description,
      telegramFileId,
      type,
    });
    await ctx.reply('💵 Price in Stars (1-25000):');
  });
}

async function buildStats(deps: AdminDeps): Promise<string> {
  const now = new Date();
  const dayStart = startOfDay(now);
  const weekStart = addDays(dayStart, -7);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const [users, conversations, media, mediaSent, soldToday, soldWeek, soldMonth, totalStars, best] =
    await Promise.all([
      deps.userRepository.count(),
      deps.conversationRepository.count(),
      deps.mediaRepository.countActive(),
      deps.proposalRepository.countByStatus('SENT'),
      deps.purchaseRepository.countBetween(dayStart, new Date()),
      deps.purchaseRepository.countBetween(weekStart, new Date()),
      deps.purchaseRepository.countBetween(monthStart, new Date()),
      deps.purchaseRepository.sumAmount(),
      deps.purchaseRepository.mostSold(1),
    ]);

  const soldTotal = await deps.purchaseRepository.count();
  const bestText = best.length === 0 ? '—' : `#${best[0].mediaId} (${best[0].count} sold)`;

  return (
    `📊 Statistics\n\n` +
    `Users:               ${users}\n` +
    `Conversations:       ${conversations}\n` +
    `Active media:        ${media}\n` +
    `Media offers sent:   ${mediaSent}\n` +
    `Media sold:          ${soldTotal}\n` +
    `⭐ Stars generated:   ${totalStars}\n` +
    `Sales today:         ${soldToday}\n` +
    `Sales this week:     ${soldWeek}\n` +
    `Sales this month:    ${soldMonth}\n` +
    `Best media:          ${bestText}`
  );
}

/** Starts the add-media wizard and asks the first question. */
async function startAddMediaWizard(c: Context): Promise<void> {
  wizards.set(c.from!.id, { step: 'add:title' });
  await c.reply('📼 Let’s add a media.\n\nSend the TITLE (max 128 chars):');
}