import OpenAI from 'openai';
import { z } from 'zod';
import { AppError, toErrorMessage } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import { buildConversationMessages, type ChatMessage } from './conversation.service.js';
import type { HistoryTurn, MediaCatalogEntry, UserProfile } from './prompt.service.js';

export interface AiDecisionConfig {
  model: string;
  temperature: number;
  maxTokens: number;
}

export interface GenerateReplyInput {
  settings: { systemPrompt: string; defaultLanguage: string };
  preferLanguage: 'en' | 'user';
  history: HistoryTurn[];
  profile: UserProfile;
  catalog: MediaCatalogEntry[];
  /** true → ask the model for a structured JSON answer including a media decision. */
  mediaDecisionMode: boolean;
}

export interface AiReply {
  text: string;
  /** true → the model suggests proposing a paid media (id from the catalog). */
  shouldSendPaidMedia: boolean;
  mediaId: number | null;
  reason: string | null;
}

const aiReplySchema = z.object({
  reply: z.string().min(1).max(4096),
  shouldSendPaidMedia: z.boolean().default(false),
  mediaId: z.coerce.number().int().positive().nullish(),
  reason: z.string().max(500).nullish().default(null),
});

const NO_MEDIA_DECISION: Pick<AiReply, 'shouldSendPaidMedia' | 'mediaId' | 'reason'> = {
  shouldSendPaidMedia: false,
  mediaId: null,
  reason: null,
};

export interface ResponseService {
  generateReply(input: GenerateReplyInput): Promise<AiReply>;
}

export function createResponseService(deps: {
  openai: OpenAI;
  config: AiDecisionConfig;
}): ResponseService {
  return {
    async generateReply(input) {
      const jsonMode = input.mediaDecisionMode;
      const messages: ChatMessage[] = buildConversationMessages({
        systemPrompt: input.settings.systemPrompt,
        preferLanguage: input.preferLanguage,
        defaultLanguage: input.settings.defaultLanguage,
        jsonMode,
        history: input.history,
        profile: input.profile,
        catalog: input.catalog,
      });

      const completion = await deps.openai.chat.completions.create({
        model: deps.config.model,
        temperature: deps.config.temperature,
        max_tokens: deps.config.maxTokens,
        messages,
        ...(jsonMode ? { response_format: { type: 'json_object' as const } } : {}),
      });

      const content = completion.choices[0]?.message?.content?.trim();
      if (!content) {
        throw new AppError('AI returned an empty reply', 'AI_EMPTY_REPLY');
      }

      if (!jsonMode) {
        return { text: content, ...NO_MEDIA_DECISION };
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(content) as unknown;
      } catch (error) {
        logger.warn({ error: toErrorMessage(error), content }, 'AI returned non-JSON in json mode');
        return {
          text: content.replace(/^```(?:json)?\s*|\s*```$/g, '').trim() || 'Sorry, I lost my words for a second 😅',
          ...NO_MEDIA_DECISION,
        };
      }

      const result = aiReplySchema.safeParse(parsed);
      if (!result.success) {
        logger.warn(
          { issues: result.error.issues },
          'AI JSON answer did not match the expected schema',
        );
        return {
          text: content,
          ...NO_MEDIA_DECISION,
        };
      }

      return {
        text: result.data.reply,
        shouldSendPaidMedia: result.data.shouldSendPaidMedia === true,
        mediaId: result.data.mediaId ?? null,
        reason: result.data.reason ?? null,
      };
    },
  };
}