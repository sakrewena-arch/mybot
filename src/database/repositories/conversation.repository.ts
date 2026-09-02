import type { PrismaClient, Conversation, Message } from '@prisma/client';

export type MessageDirectionName = 'IN' | 'OUT';

/** Conversation including its business connection (used by the admin panel). */
export type ConversationWithConnection = Conversation & {
  businessConnection: {
    id: number;
    businessConnectionId: string;
    isEnabled: boolean;
    canReply: boolean;
    permissions: unknown;
  } | null;
};

export interface ConversationRepository {
  getOrCreate(input: {
    userId: number;
    businessConnectionId: number;
    chatId: number;
  }): Promise<Conversation>;
  recordInbound(input: {
    conversationId: number;
    telegramMessageId?: number;
    text: string;
  }): Promise<{ message: Message; messageCount: number }>;
  recordOutbound(input: {
    conversationId: number;
    telegramMessageId?: number;
    text: string;
  }): Promise<Message>;
  updateIncomingText(
    conversationId: number,
    telegramMessageId: number,
    text: string,
  ): Promise<void>;
  markDeletedIncoming(conversationId: number, telegramMessageIds: number[]): Promise<void>;
  getRecent(conversationId: number, limit: number): Promise<Message[]>;
  findById(id: number): Promise<ConversationWithConnection | null>;
  listByUser(userId: number, limit?: number): Promise<Conversation[]>;
  findByConnectionAndChat(
    businessConnectionId: number,
    chatId: number,
  ): Promise<ConversationWithConnection | null>;
  count(): Promise<number>;
  countActiveSince(date: Date): Promise<number>;
  listRecent(limit: number): Promise<Conversation[]>;
}

export function createConversationRepository(client: PrismaClient): ConversationRepository {
  return {
    async getOrCreate({ userId, businessConnectionId, chatId }) {
      const chatIdString = String(chatId);
      return client.conversation.upsert({
        where: {
          businessConnectionId_chatId: {
            businessConnectionId,
            chatId: chatIdString,
          },
        },
        create: {
          userId,
          businessConnectionId,
          chatId: chatIdString,
        },
        update: {},
      });
    },

    async recordInbound({ conversationId, telegramMessageId, text }) {
      const [message, conversation] = await client.$transaction([
        client.message.create({
          data: {
            conversationId,
            telegramMessageId: telegramMessageId ?? null,
            direction: 'IN',
            text,
            createdAt: new Date(),
          },
        }),
        client.conversation.update({
          where: { id: conversationId },
          data: {
            messageCount: { increment: 1 },
            lastMessageAt: new Date(),
          },
        }),
      ]);
      return { message, messageCount: conversation.messageCount };
    },

    recordOutbound({ conversationId, telegramMessageId, text }) {
      return client.message.create({
        data: {
          conversationId,
          telegramMessageId: telegramMessageId ?? null,
          direction: 'OUT',
          text,
          createdAt: new Date(),
        },
      });
    },

    async updateIncomingText(conversationId, telegramMessageId, text) {
      await client.message.updateMany({
        where: {
          conversationId,
          telegramMessageId,
          direction: 'IN',
        },
        data: { text },
      });
    },

    async markDeletedIncoming(conversationId, telegramMessageIds) {
      if (telegramMessageIds.length === 0) return;
      await client.message.updateMany({
        where: {
          conversationId,
          telegramMessageId: { in: telegramMessageIds },
          direction: 'IN',
        },
        data: { text: '[deleted]' },
      });
    },

    getRecent(conversationId, limit) {
      return client.message.findMany({
        where: { conversationId },
        orderBy: { createdAt: 'desc' },
        take: limit,
      });
    },

    findById(id) {
      return client.conversation.findUnique({
        where: { id },
        include: { businessConnection: true },
      });
    },

    listByUser(userId, limit = 50) {
      return client.conversation.findMany({
        where: { userId },
        orderBy: { lastMessageAt: 'desc' },
        take: limit,
        include: { businessConnection: true },
      });
    },

    findByConnectionAndChat(businessConnectionId, chatId) {
      return client.conversation.findUnique({
        where: {
          businessConnectionId_chatId: {
            businessConnectionId,
            chatId: String(chatId),
          },
        },
        include: { businessConnection: true },
      });
    },

    count() {
      return client.conversation.count();
    },

    countActiveSince(date) {
      return client.conversation.count({ where: { lastMessageAt: { gte: date } } });
    },

    listRecent(limit) {
      return client.conversation.findMany({
        orderBy: { lastMessageAt: 'desc' },
        take: limit,
        include: { user: true, businessConnection: true },
      });
    },
  };
}