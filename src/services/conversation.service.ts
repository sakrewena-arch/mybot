import type { Conversation } from '@prisma/client';
import type { ConversationRepository } from '../database/repositories/conversation.repository.js';
import type { HistoryTurn } from '../ai/prompt.service.js';

export interface InboundResult {
  /** The stored inbound Message row. */
  message: { id: number; telegramMessageId: number | null; direction: string; text: string; createdAt: Date };
  /** Conversation message count AFTER this inbound message. */
  messageCount: number;
}

export interface ConversationService {
  getOrCreate(input: {
    userId: number;
    businessConnectionId: number;
    chatId: number;
  }): Promise<Conversation>;
  recordInbound(input: {
    conversationId: number;
    telegramMessageId?: number;
    text: string;
  }): Promise<InboundResult>;
  recordOutbound(input: {
    conversationId: number;
    telegramMessageId?: number;
    text: string;
  }): Promise<void>;
  getRecentHistory(conversationId: number, limit: number): Promise<HistoryTurn[]>;
  updateIncomingText(
    conversationId: number,
    telegramMessageId: number,
    text: string,
  ): Promise<void>;
  markDeletedIncoming(conversationId: number, telegramMessageIds: number[]): Promise<void>;
  findById(id: number): Promise<Conversation | null>;
  findByConnectionAndChat(
    businessConnectionId: number,
    chatId: number,
  ): Promise<Conversation | null>;
  count(): Promise<number>;
}

export function createConversationService(
  repository: ConversationRepository,
): ConversationService {
  return {
    getOrCreate: repository.getOrCreate,

    async recordInbound({ conversationId, telegramMessageId, text }) {
      const { message, messageCount } = await repository.recordInbound({
        conversationId,
        telegramMessageId,
        text,
      });
      return {
        message: {
          id: message.id,
          telegramMessageId: message.telegramMessageId,
          direction: message.direction,
          text: message.text,
          createdAt: message.createdAt,
        },
        messageCount,
      };
    },

    async recordOutbound({ conversationId, telegramMessageId, text }) {
      await repository.recordOutbound({ conversationId, telegramMessageId, text });
    },

    async getRecentHistory(conversationId, limit) {
      const rows = await repository.getRecent(conversationId, limit);
      return rows
        .slice()
        .reverse()
        .map((row) => ({
          role: row.direction === 'OUT' ? ('assistant' as const) : ('user' as const),
          text: row.text,
        }));
    },

    updateIncomingText(conversationId, telegramMessageId, text) {
      return repository.updateIncomingText(conversationId, telegramMessageId, text);
    },

    markDeletedIncoming(conversationId, telegramMessageIds) {
      return repository.markDeletedIncoming(conversationId, telegramMessageIds);
    },

    findById: repository.findById,
    findByConnectionAndChat: repository.findByConnectionAndChat,
    count: repository.count,
  };
}