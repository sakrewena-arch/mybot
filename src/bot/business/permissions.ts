import type { BusinessConnection } from '@prisma/client';
import type { BusinessBotRights } from '@grammyjs/types/manage.js';
import { permissionsToRights } from '../../database/repositories/business.repository.js';

/**
 * Permission checks for Telegram Business.
 *
 * IMPORTANT: "can reply on behalf of the business account in private chats
 * that had incoming messages in the last 24 hours" is now delivered under
 * `rights.can_reply` (BusinessBotRights), not as a top-level field of
 * BusinessConnection. We also keep the denormalized `canReply` boolean on the
 * stored connection row.
 */

export function canReply(connection: Pick<BusinessConnection, 'isEnabled' | 'canReply'>): boolean {
  return connection.isEnabled === true && connection.canReply === true;
}

export function canReplyFromRights(rights?: BusinessBotRights | null): boolean {
  return rights?.can_reply === true;
}

/** True when `chatId` is allowed (empty allowlist ⇒ every chat is allowed). */
export function isChatAllowed(chatId: number, allowedChatIds: ReadonlySet<number>): boolean {
  if (allowedChatIds.size === 0) return true;
  return allowedChatIds.has(chatId);
}

/**
 * Human readable summary of the stored BusinessBotRights snapshot.
 * Used by the admin panel to verify the granted permissions.
 */
export function summarizePermissions(
  connection: Pick<BusinessConnection, 'permissions'>,
): string {
  const rights = permissionsToRights(connection.permissions as never);
  if (!rights) return '(no explicit rights granted)';
  const labels: Array<[key: string, label: string]> = [
    ['can_reply', 'can reply to pending chats'],
    ['can_read_messages', 'can read messages'],
    ['can_delete_outgoing_messages', 'can delete own messages'],
    ['can_delete_all_messages', 'can delete messages'],
    ['can_edit_name', 'can edit name'],
    ['can_edit_bio', 'can edit bio'],
    ['can_edit_profile_photo', 'can edit profile photo'],
    ['can_edit_username', 'can edit username'],
    ['can_change_gift_settings', 'can change gift settings'],
    ['can_view_gifts_and_stars', 'can view gifts & stars'],
    ['can_convert_gifts_to_stars', 'can convert gifts to stars'],
    ['can_transfer_and_upgrade_gifts', 'can transfer/upgrade gifts'],
    ['can_transfer_stars', 'can transfer stars'],
    ['can_manage_stories', 'can manage stories'],
  ];
  const active = labels.filter(([key]) => rights[key as keyof BusinessBotRights] === true);
  return active.map(([, label]) => `• ${label}`).join('\n') || '(no rights granted)';
}