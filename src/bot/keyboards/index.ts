import { InlineKeyboard } from 'grammy';

export const ADMIN_MENU_CB = 'admin:menu';
export const ADMIN_MEDIA_CB = 'admin:media';
export const ADMIN_USERS_CB = 'admin:users';
export const ADMIN_PURCHASES_CB = 'admin:purchases';
export const ADMIN_CONVERSATIONS_CB = 'admin:conversations';
export const ADMIN_SETTINGS_CB = 'admin:settings';
export const ADMIN_STATS_CB = 'admin:stats';
export const ADMIN_CLOSE_CB = 'admin:close';

export const MEDIA_ADD_CB = 'media:add';
export const MEDIA_REFRESH_CB = 'media:refresh';

export function adminMenuKeyboard() {
  return new InlineKeyboard()
    .text('MEDIA', ADMIN_MEDIA_CB).row()
    .text('USERS', ADMIN_USERS_CB).text('PURCHASES', ADMIN_PURCHASES_CB).row()
    .text('CONVERSATIONS', ADMIN_CONVERSATIONS_CB).row()
    .text('SETTINGS', ADMIN_SETTINGS_CB).text('STATISTICS', ADMIN_STATS_CB).row()
    .text('Close', ADMIN_CLOSE_CB);
}

export function mediaItemKeyboard(mediaId: number) {
  return new InlineKeyboard()
    .text('Toggle active', `media:toggle:${mediaId}`)
    .text('Price', `media:price:${mediaId}`)
    .text('Trigger', `media:trigger:${mediaId}`).row()
    .text('Title', `media:title:${mediaId}`)
    .text('Description', `media:desc:${mediaId}`).row()
    .text('Delete', `media:del:${mediaId}`)
    .text('<< Back', ADMIN_MEDIA_CB);
}

export function mediaListKeyboard(mediaIds: number[]) {
  const keyboard = new InlineKeyboard();
  for (const id of mediaIds) {
    keyboard.text(`#${id}`, `media:show:${id}`).row();
  }
  keyboard.text('➕ Add media', MEDIA_ADD_CB).row().text('⟳ Refresh', MEDIA_REFRESH_CB);
  return keyboard;
}

export function settingsKeyboard(enabled: boolean) {
  return new InlineKeyboard()
    .text(enabled ? '⏸ Disable bot' : '▶ Enable bot', 'settings:toggle')
    .text('✏️ Edit prompt', 'settings:edit_prompt').row()
    .text('<< Back', ADMIN_MENU_CB);
}

export function triggerTypeKeyboard(mediaId: number) {
  return new InlineKeyboard()
    .text('MESSAGE_COUNT', `media:set_trigger:${mediaId}:MESSAGE_COUNT`)
    .text('TIME', `media:set_trigger:${mediaId}:TIME`).row()
    .text('AI', `media:set_trigger:${mediaId}:AI`)
    .text('MANUAL', `media:set_trigger:${mediaId}:MANUAL`)
    .text('NONE', `media:set_trigger:${mediaId}:NONE`).row()
    .text('<< Back', ADMIN_MENU_CB);
}

/** Trigger picker used by the add-media wizard (callbacks are wizard:…). */
export function wizardTriggerKeyboard() {
  return new InlineKeyboard()
    .text('MESSAGE_COUNT', 'wizard:trigger:MESSAGE_COUNT')
    .text('TIME', 'wizard:trigger:TIME').row()
    .text('AI', 'wizard:trigger:AI')
    .text('MANUAL', 'wizard:trigger:MANUAL')
    .text('NONE', 'wizard:trigger:NONE');
}