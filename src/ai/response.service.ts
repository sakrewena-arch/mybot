import OpenAI from 'openai';
import { z } from 'zod';
import { AppError, toErrorMessage } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import { buildConversationMessages, type ChatMessage } from './conversation.service.js';
import type { HistoryTurn, MediaCatalogEntry, UserProfile } from './prompt.service.js';
import {
  createProviderRouter,
  type AiProviderConfig,
  type ProviderRouter,
} from './provider-router.js';

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
  /** Name of the AI provider that actually answered (empty if all failed). */
  provider: string;
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

/**
 * Natural, human-sounding fallbacks used when EVERY AI provider is down.
 * These intentionally avoid any "AI / brain / system" wording so the account
 * keeps looking like a real person even in a worst-case outage.
 */
const HUMAN_FALLBACKS = [
  'Sorry, I missed that — my connection just dropped 😅 Could you say it again?',
  'Ahh my phone froze for a second there 😅 What were you saying?',
  'Hey, sorry! I was in the middle of something. Can you repeat that?',
  'Oops, that one got cut off on my end… wanna try once more?',
];

function pickHumanFallback(): string {
  return HUMAN_FALLBACKS[Math.floor(Math.random() * HUMAN_FALLBACKS.length)]!;
}

/**
 * Robust JSON extraction: some OpenAI-compatible providers don't support
 * `response_format`, or wrap the JSON in markdown fences / extra text.
 */
function extractJsonObject(content: string): unknown | null {
  const tryDirect = (candidate: string): unknown | null => {
    try {
      return JSON.parse(candidate) as unknown;
    } catch {
      return null;
    }
  };

  const direct = tryDirect(content.trim());
  if (direct !== null) return direct;

  const fenced = /```(?:json)?\s*\n?([\s\S]*?)\n?```/.exec(content);
  if (fenced?.[1]) {
    const candidate = tryDirect(fenced[1].trim());
    if (candidate !== null) return candidate;
  }

  const start = content.indexOf('{');
  const end = content.lastIndexOf('}');
  if (start !== -1 && end > start) {
    const slice = tryDirect(content.slice(start, end + 1));
    if (slice !== null) return slice;
  }

  return null;
}

export interface ResponseService {
  generateReply(input: GenerateReplyInput): Promise<AiReply>;
  /**
   * Cheap connectivity self-test for every configured provider.
   * Used at startup to surface bad keys / URLs / balances in the logs.
   */
  diagnoseProviders(): Promise<
    Array<{ name: string; ok: boolean; error?: string; model?: string }>
  >;
}

function defaultCreateClient(config: AiProviderConfig): OpenAI {
  return new OpenAI({ apiKey: config.apiKey, baseURL: config.baseUrl });
}

export function createResponseService(deps: {
  providers: AiProviderConfig[];
  createClient?: (config: AiProviderConfig) => OpenAI;
  temperature: number;
  maxTokens: number;
}): ResponseService {
  const router: ProviderRouter = createProviderRouter(
    deps.providers,
    deps.createClient ?? defaultCreateClient,
  );

  async function callProvider(
    client: OpenAI,
    config: AiProviderConfig,
    input: GenerateReplyInput,
  ): Promise<Omit<AiReply, 'provider'>> {
    const jsonMode = input.mediaDecisionMode && config.supportsJsonMode !== false;

    const messages: ChatMessage[] = buildConversationMessages({
      systemPrompt: input.settings.systemPrompt,
      preferLanguage: input.preferLanguage,
      defaultLanguage: input.settings.defaultLanguage,
      jsonMode: jsonMode || input.mediaDecisionMode, // still instruct the model to output JSON
      history: input.history,
      profile: input.profile,
      catalog: input.catalog,
    });

    const completion = await client.chat.completions.create({
      model: config.model,
      temperature: deps.temperature,
      max_tokens: deps.maxTokens,
      messages,
      ...(jsonMode ? { response_format: { type: 'json_object' as const } } : {}),
    });

    const content = completion.choices[0]?.message?.content?.trim();
    if (!content) {
      throw new AppError('AI returned an empty reply', 'AI_EMPTY_REPLY');
    }

    if (!input.mediaDecisionMode) {
      return { text: content, ...NO_MEDIA_DECISION };
    }

    const parsed = extractJsonObject(content);
    if (parsed === null) {
      logger.warn({ provider: config.name, content }, 'AI returned non-JSON in json mode');
      return {
        text:
          content.replace(/^```(?:json)?\s*|\s*```$/g, '').trim() || pickHumanFallback(),
        ...NO_MEDIA_DECISION,
      };
    }

    const result = aiReplySchema.safeParse(parsed);
    if (!result.success) {
      logger.warn(
        { provider: config.name, issues: result.error.issues },
        'AI JSON answer did not match the expected schema',
      );
      return { text: content, ...NO_MEDIA_DECISION };
    }

    return {
      text: result.data.reply,
      shouldSendPaidMedia: result.data.shouldSendPaidMedia === true,
      mediaId: result.data.mediaId ?? null,
      reason: result.data.reason ?? null,
    };
  }

  return {
    async generateReply(input) {
      try {
        const { value, providerName } = await router.executeWithFailover((client, config) =>
          callProvider(client, config, input),
        );
        return { ...value, provider: providerName };
      } catch (error) {
        if (error instanceof AppError && error.code === 'AI_ALL_EXHAUSTED') {
          const details = router
            .statuses()
            .map((s) => `${s.name}: ${s.ready ? 'ready' : 'quota'}`)
            .join(', ');
          logger.warn({ details }, 'all AI providers exhausted');
          return { text: pickHumanFallback(), ...NO_MEDIA_DECISION, provider: 'none' };
        }
        throw error;
      }
    },

    async diagnoseProviders() {
      const results: Array<{ name: string; ok: boolean; error?: string; model?: string }> = [];
      for (const config of deps.providers) {
        try {
          const client = deps.createClient
            ? deps.createClient(config)
            : defaultCreateClient(config);
          await client.chat.completions.create({
            model: config.model,
            max_tokens: 1,
            messages: [{ role: 'user', content: 'ping' }],
          });
          results.push({ name: config.name, ok: true, model: config.model });
        } catch (error) {
          results.push({
            name: config.name,
            ok: false,
            model: config.model,
            error: toErrorMessage(error),
          });
        }
      }
      return results;
    },
  };
}