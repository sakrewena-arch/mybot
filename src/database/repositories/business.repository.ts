import type { PrismaClient, BusinessConnection, Prisma } from '@prisma/client';
import type { BusinessBotRights } from '@grammyjs/types/manage.js';

export interface UpsertBusinessConnectionInput {
  businessConnectionId: string;
  businessUserId: number;
  userChatId: number;
  isEnabled: boolean;
  rights?: BusinessBotRights;
}

const RIGHT_KEYS = [
  'can_reply',
  'can_read_messages',
  'can_delete_outgoing_messages',
  'can_delete_all_messages',
  'can_edit_name',
  'can_edit_bio',
  'can_edit_profile_photo',
  'can_edit_username',
  'can_change_gift_settings',
  'can_view_gifts_and_stars',
  'can_convert_gifts_to_stars',
  'can_transfer_and_upgrade_gifts',
  'can_transfer_stars',
  'can_manage_stories',
] as const satisfies ReadonlyArray<keyof BusinessBotRights>;

export function rightsToJson(rights?: BusinessBotRights): Prisma.InputJsonValue {
  if (!rights) return {};
  const out: Record<string, unknown> = {};
  for (const key of RIGHT_KEYS) {
    if (rights[key] === true) out[key] = true;
  }
  return out as Prisma.InputJsonValue;
}

export function permissionsToRights(
  value: Prisma.JsonValue | null | undefined,
): BusinessBotRights | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of RIGHT_KEYS) {
    if (record[key] === true) out[key] = true;
  }
  return (Object.keys(out).length > 0 ? out : null) as BusinessBotRights | null;
}

export interface BusinessRepository {
  upsertConnection(input: UpsertBusinessConnectionInput): Promise<BusinessConnection>;
  disableConnection(businessConnectionId: string): Promise<void>;
  findActiveById(businessConnectionId: string): Promise<BusinessConnection | null>;
  findById(businessConnectionId: string): Promise<BusinessConnection | null>;
  countActive(): Promise<number>;
}

export function createBusinessRepository(client: PrismaClient): BusinessRepository {
  return {
    async upsertConnection(input) {
      const permissions = rightsToJson(input.rights);
      return client.businessConnection.upsert({
        where: { businessConnectionId: input.businessConnectionId },
        create: {
          businessConnectionId: input.businessConnectionId,
          businessUserId: String(input.businessUserId),
          userChatId: String(input.userChatId),
          isEnabled: input.isEnabled,
          canReply: input.isEnabled && input.rights?.can_reply === true,
          permissions,
        },
        update: {
          businessUserId: String(input.businessUserId),
          userChatId: String(input.userChatId),
          isEnabled: input.isEnabled,
          canReply: input.isEnabled && input.rights?.can_reply === true,
          permissions,
        },
      });
    },

    async disableConnection(businessConnectionId) {
      await client.businessConnection.updateMany({
        where: { businessConnectionId },
        data: { isEnabled: false, canReply: false },
      });
    },

    findActiveById(businessConnectionId) {
      return client.businessConnection.findFirst({
        where: { businessConnectionId, isEnabled: true },
      });
    },

    findById(businessConnectionId) {
      return client.businessConnection.findUnique({
        where: { businessConnectionId },
      });
    },

    countActive() {
      return client.businessConnection.count({ where: { isEnabled: true } });
    },
  };
}