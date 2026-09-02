import type { PrismaClient, MediaProposal } from '@prisma/client';

export type ProposalStatusName = 'SENT' | 'SKIPPED' | 'FAILED';

export interface ProposalRepository {
  create(input: {
    userId: number;
    mediaId: number;
    conversationId?: number | null;
    status: ProposalStatusName;
    reason?: string | null;
  }): Promise<MediaProposal>;
  lastForUser(userId: number): Promise<MediaProposal | null>;
  countByStatus(status: ProposalStatusName): Promise<number>;
  countSentBetween(from: Date, to: Date): Promise<number>;
}

export function createProposalRepository(client: PrismaClient): ProposalRepository {
  return {
    create(input) {
      return client.mediaProposal.create({
        data: {
          userId: input.userId,
          mediaId: input.mediaId,
          conversationId: input.conversationId ?? null,
          status: input.status,
          reason: input.reason ?? null,
        },
      });
    },

    lastForUser(userId) {
      return client.mediaProposal.findFirst({
        where: { userId },
        orderBy: { sentAt: 'desc' },
      });
    },

    countByStatus(status) {
      return client.mediaProposal.count({ where: { status } });
    },

    countSentBetween(from, to) {
      return client.mediaProposal.count({
        where: { status: 'SENT', sentAt: { gte: from, lt: to } },
      });
    },
  };
}