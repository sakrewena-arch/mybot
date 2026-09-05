import type { User, Conversation } from '@prisma/client';
import type { EnvConfig } from '../config/env.js';
import type { ApiLike } from '../types/telegram.js';
import type {
  ConversationRepository,
  ReEngagementCandidate,
} from '../database/repositories/conversation.repository.js';
import type { ConversationService } from './conversation.service.js';
import type { SettingsRepository } from '../database/repositories/settings.repository.js';
import type { ResponseService } from '../ai/response.service.js';
import type { MediaService } from '../media/media.service.js';
import type { PurchaseService } from './purchase.service.js';
import type { UserProfile } from '../ai/prompt.service.js';
import { sleep } from '../utils/human.js';
import { logger } from '../utils/logger.js';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface SelectReengagementOptions {
  /** Delay before the FIRST follow-up after Esther's last message (ms). */
  firstDelayMs: number;
  /** Delay between subsequent follow-ups (ms). */
  subsequentDelayMs: number;
  /** Max unanswered follow-ups before giving up. */
  maxFollowUps: number;
}

/**
 * Pure selection logic: which conversations deserve a follow-up right now.
 *
 * - A chat is eligible only when Esther wrote last and the user did not reply
 *   since (or never replied).
 * - The FIRST nudge waits `firstDelayMs` after Esther's message; every later
 *   nudge waits `subsequentDelayMs` — and the streak stops at `maxFollowUps`.
 */
export function selectReengagementCandidates(
  rows: ReEngagementCandidate[],
  now: Date,
  opts: SelectReengagementOptions,
): ReEngagementCandidate[] {
  const nowMs = now.getTime();
  const result: ReEngagementCandidate[] = [];
  for (const row of rows) {
    if (row.followUpCount >= opts.maxFollowUps) continue;
    if (!row.lastOutboundAt) continue;
    // The user replied after Esther's message → this is a pending answer, not a quiet chat.
    if (row.lastInboundAt && row.lastInboundAt.getTime() > row.lastOutboundAt.getTime()) continue;

    const delayMs =
      row.followUpCount === 0 ? opts.firstDelayMs : opts.subsequentDelayMs;
    if (nowMs - row.lastOutboundAt.getTime() < delayMs) continue;

    result.push(row);
  }
  return result;
}

export interface ReengagementDeps {
  env: EnvConfig;
  api: ApiLike;
  conversationRepository: ConversationRepository;
  conversationService: ConversationService;
  settingsRepository: SettingsRepository;
  responseService: ResponseService;
  mediaService: MediaService;
  purchaseService: PurchaseService;
  /** Injectable for tests; defaults to a small human-like wait. */
  sleepFn?: (ms: number) => Promise<void>;
}

export interface ReengagementService {
  /** Runs one re-engagement pass. Returns the number of follow-ups sent. */
  runOnce(now?: Date): Promise<number>;
  start(): void;
  stop(): void;
}

function buildProfile(
  user: User,
  conversation: Conversation,
  ownedMediaIds: Set<number>,
): UserProfile {
  return {
    firstName: user.firstName,
    lastName: user.lastName,
    username: user.username,
    languageCode: user.languageCode,
    messageCount: conversation.messageCount,
    lastInteractionAt: conversation.lastMessageAt,
    ownedMediaIds: Array.from(ownedMediaIds),
  };
}

export function createReengagementService(deps: ReengagementDeps): ReengagementService {
  const doSleep = deps.sleepFn ?? sleep;
  let timer: NodeJS.Timeout | null = null;
  let running = false;

  return {
    async runOnce(now = new Date()) {
      if (!deps.env.reengage.enabled) return 0;
      if (running) return 0;
      running = true;
      try {
        const settings = await deps.settingsRepository.getSettings();
        if (!settings.enabled) return 0;
        if (deps.responseService.isAiUnavailable()) {
          logger.info('re-engagement skipped — AI quota exhausted');
          return 0;
        }

        const maxDelayMs = Math.max(
          deps.env.reengage.firstDelayMs,
          deps.env.reengage.subsequentDelayMs,
        );
        const since = new Date(now.getTime() - maxDelayMs * 2);
        const rows = await deps.conversationRepository.listForReengagement({
          maxFollowUps: deps.env.reengage.maxMessages,
          since,
        });
        const candidates = selectReengagementCandidates(rows, now, {
          firstDelayMs: deps.env.reengage.firstDelayMs,
          subsequentDelayMs: deps.env.reengage.subsequentDelayMs,
          maxFollowUps: deps.env.reengage.maxMessages,
        });

        let sent = 0;
        for (const candidate of candidates) {
          const daysSince = Math.max(
            1,
            Math.floor((now.getTime() - candidate.lastOutboundAt!.getTime()) / DAY_MS),
          );
          const ownedMediaIds = await deps.purchaseService.listOwnedMediaIds(candidate.user.id);
          const profile = buildProfile(candidate.user, candidate, ownedMediaIds);
          const catalog = (await deps.mediaService.listActiveCatalog()).filter(
            (media) => !ownedMediaIds.has(media.id),
          );
          const history = await deps.conversationService.getRecentHistory(
            candidate.id,
            deps.env.historyLimit,
          );

          const aiReply = await deps.responseService.generateReply({
            settings: {
              systemPrompt: settings.systemPrompt,
              defaultLanguage: settings.defaultLanguage,
            },
            preferLanguage: deps.env.preferLanguage,
            history,
            profile,
            catalog,
            mediaDecisionMode: false,
            extraInstruction: `This is a follow-up nudge (#${candidate.followUpCount + 1}): the user has not replied for about ${daysSince} day(s). Send ONE very short, warm, romantic nudge (1-2 lines, no pressure, no questions demanding a long reply). If it fits the mood, you may naturally hint at your exclusive content again — but flirt first.`,
          });

          if (aiReply.provider === 'none' || aiReply.text.trim() === '') {
            logger.info(
              { conversationId: candidate.id, userId: candidate.user.id },
              'follow-up skipped (no AI answer)',
            );
            continue;
          }

          // A small human-like pause between nudges.
          await doSleep(2_000 + Math.floor(Math.random() * 6_000));

          const sentMessage = await deps.api.sendMessage({
            business_connection_id: candidate.businessConnection.businessConnectionId,
            chat_id: candidate.chatId,
            text: aiReply.text,
            protect_content: false,
          });

          await deps.conversationRepository.recordOutbound({
            conversationId: candidate.id,
            telegramMessageId: sentMessage.message_id,
            text: aiReply.text,
          });
          await deps.conversationRepository.incrementFollowUp(candidate.id);

          logger.info(
            {
              conversationId: candidate.id,
              userId: candidate.user.id,
              followUp: candidate.followUpCount + 1,
            },
            'follow-up sent',
          );
          sent += 1;
        }
        return sent;
      } finally {
        running = false;
      }
    },

    start() {
      if (timer) return;
      if (!deps.env.reengage.enabled) return;
      timer = setInterval(() => {
        void this.runOnce().catch((error: unknown) =>
          logger.error(
            { error: error instanceof Error ? error.message : String(error) },
            're-engagement pass failed',
          ),
        );
      }, deps.env.reengage.intervalMs);
      timer.unref?.();
      logger.info(
        { intervalMs: deps.env.reengage.intervalMs },
        're-engagement scheduler started',
      );
    },

    stop() {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    },
  };
}