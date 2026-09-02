import type { Media, User, BusinessConnection, Purchase, MediaProposal } from '@prisma/client';
import type { ApiLike } from '../../src/types/telegram.js';
import type { UserRepository } from '../../src/database/repositories/user.repository.js';
import type {
  MediaRepository,
  CreateMediaInput,
} from '../../src/database/repositories/media.repository.js';
import type {
  BusinessRepository,
  UpsertBusinessConnectionInput,
} from '../../src/database/repositories/business.repository.js';
import type { PurchaseRepository } from '../../src/database/repositories/purchase.repository.js';
import type {
  ProposalRepository,
  ProposalStatusName,
} from '../../src/database/repositories/proposal.repository.js';
import type { SettingsRepository } from '../../src/database/repositories/settings.repository.js';
import type { TelegramUserDto } from '../../src/types/telegram.js';

// ── Fake ApiLike ─────────────────────────────────────────────────────────────

export interface ApiCall {
  kind: 'sendMessage' | 'sendPaidMedia' | 'answerPreCheckoutQuery' | 'readBusinessMessage';
  args: unknown;
}

export function createFakeApi(): { api: ApiLike; calls: ApiCall[] } {
  const calls: ApiCall[] = [];
  const api: ApiLike = {
    async sendMessage(args) {
      calls.push({ kind: 'sendMessage', args });
      return { message_id: calls.length };
    },
    async sendPaidMedia(args) {
      calls.push({ kind: 'sendPaidMedia', args });
      return { message_id: calls.length };
    },
    async answerPreCheckoutQuery(args) {
      calls.push({ kind: 'answerPreCheckoutQuery', args });
      return true;
    },
  };
  return { api, calls };
}

// ── Users ────────────────────────────────────────────────────────────────────

export function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: 1,
    telegramId: '12345',
    username: 'tester',
    firstName: 'Test',
    lastName: null,
    languageCode: 'en',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as User;
}

export class InMemoryUserRepository implements UserRepository {
  rows: User[] = [];
  seq = 1;

  async upsertFromTelegram(dto: TelegramUserDto): Promise<User> {
    const telegramId = String(dto.id);
    const existing = this.rows.find((u) => u.telegramId === telegramId);
    if (existing) {
      existing.username = dto.username ?? null;
      existing.firstName = dto.first_name ?? null;
      existing.lastName = dto.last_name ?? null;
      existing.languageCode = dto.language_code ?? null;
      existing.updatedAt = new Date();
      return existing;
    }
    const created = makeUser({
      id: this.seq++,
      telegramId,
      username: dto.username ?? null,
      firstName: dto.first_name ?? null,
      lastName: dto.last_name ?? null,
      languageCode: dto.language_code ?? null,
    });
    this.rows.push(created);
    return created;
  }

  async findById(id: number): Promise<User | null> {
    return this.rows.find((u) => u.id === id) ?? null;
  }

  async findByTelegramId(telegramId: number): Promise<User | null> {
    return this.rows.find((u) => u.telegramId === String(telegramId)) ?? null;
  }

  async count(): Promise<number> {
    return this.rows.length;
  }

  async listRecent(limit: number): Promise<User[]> {
    return this.rows.slice().reverse().slice(0, limit);
  }
}
// ── Media ────────────────────────────────────────────────────────────────────

export function makeMedia(overrides: Partial<Media> = {}): Media {
  return {
    id: 1,
    title: 'Exclusive photo',
    description: 'A beautiful photo',
    type: 'PHOTO',
    telegramFileId: 'file://photo-1',
    thumbnailFileId: null,
    priceStars: 25,
    active: true,
    triggerType: 'MESSAGE_COUNT',
    triggerValue: 10,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    ...overrides,
  } as Media;
}

export class InMemoryMediaRepository implements MediaRepository {
  rows: Media[] = [];
  seq = 1;

  async create(input: CreateMediaInput): Promise<Media> {
    const media = makeMedia({
      id: this.seq++,
      title: input.title,
      description: input.description ?? null,
      type: input.type,
      telegramFileId: input.telegramFileId,
      thumbnailFileId: input.thumbnailFileId ?? null,
      priceStars: input.priceStars,
      triggerType: input.triggerType,
      triggerValue: input.triggerValue ?? null,
    });
    this.rows.push(media);
    return media;
  }

  async findById(id: number): Promise<Media | null> {
    return this.rows.find((m) => m.id === id) ?? null;
  }

  async findActiveById(id: number): Promise<Media | null> {
    return this.rows.find((m) => m.id === id && m.active === true && m.deletedAt === null) ?? null;
  }

  async listActive(): Promise<Media[]> {
    return this.rows.filter((m) => m.active === true && m.deletedAt === null);
  }

  async listAll(): Promise<Media[]> {
    return this.rows.filter((m) => m.deletedAt === null);
  }

  async listByIds(ids: number[]): Promise<Media[]> {
    return this.rows.filter((m) => ids.includes(m.id));
  }

  async update(id: number, data: Partial<CreateMediaInput>): Promise<Media | null> {
    const media = this.rows.find((m) => m.id === id);
    if (!media) return null;
    if (data.title !== undefined) media.title = data.title;
    if (data.description !== undefined) media.description = data.description ?? null;
    if (data.type !== undefined) media.type = data.type;
    if (data.telegramFileId !== undefined) media.telegramFileId = data.telegramFileId;
    if (data.thumbnailFileId !== undefined) media.thumbnailFileId = data.thumbnailFileId ?? null;
    if (data.priceStars !== undefined) media.priceStars = data.priceStars;
    if (data.triggerType !== undefined) media.triggerType = data.triggerType;
    if (data.triggerValue !== undefined) media.triggerValue = data.triggerValue ?? null;
    media.updatedAt = new Date();
    return media;
  }

  async setActive(id: number, active: boolean): Promise<Media | null> {
    const media = this.rows.find((m) => m.id === id);
    if (!media) return null;
    media.active = active;
    media.updatedAt = new Date();
    return media;
  }

  async softDelete(id: number): Promise<Media | null> {
    const media = this.rows.find((m) => m.id === id);
    if (!media) return null;
    media.deletedAt = new Date();
    media.active = false;
    return media;
  }

  async count(): Promise<number> {
    return this.rows.filter((m) => m.deletedAt === null).length;
  }

  async countActive(): Promise<number> {
    return this.rows.filter((m) => m.active === true && m.deletedAt === null).length;
  }
}
// ── Business connections ─────────────────────────────────────────────────────

export function makeBusinessConnection(
  overrides: Partial<BusinessConnection> = {},
): BusinessConnection {
  return {
    id: 1,
    businessConnectionId: 'conn-1',
    businessUserId: '999',
    userChatId: '999',
    isEnabled: true,
    canReply: true,
    permissions: { can_reply: true } as unknown as BusinessConnection['permissions'],
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as BusinessConnection;
}

export class InMemoryBusinessRepository implements BusinessRepository {
  rows: BusinessConnection[] = [];

  constructor(rows: BusinessConnection[] = []) {
    this.rows = rows;
  }

  async upsertConnection(input: UpsertBusinessConnectionInput): Promise<BusinessConnection> {
    const existing = this.rows.find(
      (c) => c.businessConnectionId === input.businessConnectionId,
    );
    const data = {
      businessUserId: String(input.businessUserId),
      userChatId: String(input.userChatId),
      isEnabled: input.isEnabled,
      canReply: input.isEnabled && input.rights?.can_reply === true,
      permissions: input.rights ? (input.rights as never) : {},
    };
    if (existing) {
      Object.assign(existing, data);
      return existing;
    }
    const created = makeBusinessConnection({
      id: this.rows.length + 1,
      businessConnectionId: input.businessConnectionId,
      ...data,
    });
    this.rows.push(created);
    return created;
  }

  async disableConnection(businessConnectionId: string): Promise<void> {
    const row = this.rows.find((c) => c.businessConnectionId === businessConnectionId);
    if (row) {
      row.isEnabled = false;
      row.canReply = false;
    }
  }

  async findActiveById(businessConnectionId: string): Promise<BusinessConnection | null> {
    return (
      this.rows.find(
        (c) => c.businessConnectionId === businessConnectionId && c.isEnabled === true,
      ) ?? null
    );
  }

  async findById(businessConnectionId: string): Promise<BusinessConnection | null> {
    return this.rows.find((c) => c.businessConnectionId === businessConnectionId) ?? null;
  }

  async countActive(): Promise<number> {
    return this.rows.filter((c) => c.isEnabled).length;
  }
}
// ── Purchases ────────────────────────────────────────────────────────────────

export class InMemoryPurchaseRepository implements PurchaseRepository {
  rows: Purchase[] = [];
  seq = 1;

  async createIfAbsent(input: {
    userId: number;
    mediaId: number;
    telegramPaymentChargeId?: string | null;
    amountStars: number;
  }) {
    const existing = this.rows.find(
      (p) => p.userId === input.userId && p.mediaId === input.mediaId,
    );
    if (existing) return { purchase: existing, created: false };
    const purchase: Purchase = {
      id: this.seq++,
      userId: input.userId,
      mediaId: input.mediaId,
      telegramPaymentChargeId: input.telegramPaymentChargeId ?? null,
      amountStars: input.amountStars,
      createdAt: new Date(),
    };
    this.rows.push(purchase);
    return { purchase, created: true };
  }

  async findByUserAndMedia(userId: number, mediaId: number): Promise<Purchase | null> {
    return this.rows.find((p) => p.userId === userId && p.mediaId === mediaId) ?? null;
  }

  async listByUser(userId: number): Promise<Purchase[]> {
    return this.rows.filter((p) => p.userId === userId);
  }

  async listRecent(
    limit: number,
  ): Promise<
    Array<
      Purchase & {
        user: { firstName: string | null; username: string | null } | null;
        media: Media | null;
      }
    >
  > {
    return this.rows
      .slice()
      .reverse()
      .slice(0, limit)
      .map((p) => ({ ...p, user: null, media: null }));
  }

  async count(): Promise<number> {
    return this.rows.length;
  }

  async countBetween(from: Date, to: Date): Promise<number> {
    return this.rows.filter((p) => p.createdAt >= from && p.createdAt < to).length;
  }

  async sumAmount(): Promise<number> {
    return this.rows.reduce((total, p) => total + p.amountStars, 0);
  }

  async sumBetween(from: Date, to: Date): Promise<number> {
    return this.rows
      .filter((p) => p.createdAt >= from && p.createdAt < to)
      .reduce((total, p) => total + p.amountStars, 0);
  }

  async mostSold(limit: number): Promise<Array<{ mediaId: number; count: number }>> {
    const counts = new Map<number, number>();
    for (const p of this.rows) counts.set(p.mediaId, (counts.get(p.mediaId) ?? 0) + 1);
    return Array.from(counts.entries())
      .map(([mediaId, count]) => ({ mediaId, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, limit);
  }
}

// ── Proposals ────────────────────────────────────────────────────────────────

export class InMemoryProposalRepository implements ProposalRepository {
  rows: MediaProposal[] = [];
  seq = 1;

  async create(input: {
    userId: number;
    mediaId: number;
    conversationId?: number | null;
    status: ProposalStatusName;
    reason?: string | null;
  }): Promise<MediaProposal> {
    const proposal: MediaProposal = {
      id: this.seq++,
      userId: input.userId,
      mediaId: input.mediaId,
      conversationId: input.conversationId ?? null,
      status: input.status,
      reason: input.reason ?? null,
      sentAt: new Date(),
    };
    this.rows.push(proposal);
    return proposal;
  }

  async lastForUser(userId: number): Promise<MediaProposal | null> {
    const found = this.rows.filter((p) => p.userId === userId);
    if (found.length === 0) return null;
    return { ...found[found.length - 1]! };
  }

  async countByStatus(status: ProposalStatusName): Promise<number> {
    return this.rows.filter((p) => p.status === status).length;
  }

  async countSentBetween(from: Date, to: Date): Promise<number> {
    return this.rows.filter((p) => p.status === 'SENT' && p.sentAt >= from && p.sentAt < to).length;
  }
}

// ── Settings ─────────────────────────────────────────────────────────────────

export function createFakeSettingsRepository(settings?: {
  enabled?: boolean;
  systemPrompt?: string;
}): SettingsRepository {
  let current = {
    id: 1,
    systemPrompt: settings?.systemPrompt ?? 'You are a friendly assistant.',
    enabled: settings?.enabled ?? true,
    defaultLanguage: 'en',
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  return {
    async getSettings() {
      return current;
    },
    async updateSystemPrompt(systemPrompt: string) {
      current = { ...current, systemPrompt, updatedAt: new Date() };
      return current;
    },
    async setEnabled(enabled: boolean) {
      current = { ...current, enabled, updatedAt: new Date() };
      return current;
    },
  };
}