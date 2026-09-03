import 'dotenv/config';
import { z } from 'zod';
import type { AiProviderConfig } from '../ai/provider-router.js';

export type NodeEnv = 'development' | 'test' | 'production';
export type MediaTriggerMode = 'none' | 'message_count' | 'time' | 'ai' | 'manual';
export type PreferLanguage = 'en' | 'user';

const emptyToUndefined = (value: string | undefined): string | undefined =>
  value === undefined || value.trim() === '' ? undefined : value.trim();

const providerSchema = z.object({
  name: z.string().min(1),
  apiKey: z.string().min(1, 'apiKey is required'),
  baseUrl: z.string().url(),
  model: z.string().min(1),
  supportsJsonMode: z.boolean().default(true),
});

const envSchema = z.object({
  NODE_ENV: z
    .preprocess((value) => (typeof value === 'string' ? value.trim() : value), z.enum(['development', 'test', 'production']).default('development')),
  BOT_TOKEN: z
    .string()
    .trim()
    .min(1, 'BOT_TOKEN is required (token from @BotFather)'),
  DATABASE_URL: z
    .string()
    .trim()
    .min(1, 'DATABASE_URL is required'),
  // OPENAI_API_KEY is required only when AI_PROVIDERS_JSON is not used.
  OPENAI_API_KEY: z.string().optional().transform(emptyToUndefined),
  ADMIN_IDS: z.string().default(''),
  PORT: z.coerce.number().int().min(1).default(3000),
  POLLING_MODE: z.enum(['polling', 'webhook']).default('polling'),
  WEBHOOK_URL: z
    .string()
    .optional()
    .transform(emptyToUndefined)
    .refine((value) => value === undefined || z.string().url().safeParse(value).success, {
      message: 'WEBHOOK_URL must be a valid URL when provided',
    }),
  WEBHOOK_SECRET: z
    .string()
    .optional()
    .transform(emptyToUndefined)
    .refine((value) => value === undefined || value.length >= 8, {
      message: 'WEBHOOK_SECRET must be at least 8 characters when provided',
    }),
  ALLOWED_CHAT_IDS: z.string().default(''),
  ALLOWED_UPDATES: z
    .string()
    .default(
      'business_connection,business_message,edited_business_message,deleted_business_messages,message,callback_query,pre_checkout_query,purchased_paid_media',
    ),
  AI_MODEL: z.string().default('gpt-4o-mini'),
  AI_TEMPERATURE: z.coerce.number().min(0).max(2).default(0.8),
  AI_MAX_TOKENS: z.coerce.number().int().positive().default(400),
  HISTORY_LIMIT: z.coerce.number().int().positive().default(20),
  DEFAULT_LANGUAGE: z.string().default('en'),
  PREFER_LANGUAGE: z.enum(['en', 'user']).default('en'),
  OPENAI_BASE_URL: z
    .string()
    .optional()
    .transform(emptyToUndefined)
    .refine((value) => value === undefined || z.string().url().safeParse(value).success, {
      message: 'OPENAI_BASE_URL must be a valid URL when provided',
    }),
  MEDIA_COOLDOWN_MINUTES: z.coerce.number().int().min(0).default(30),
  MEDIA_MESSAGE_THRESHOLD: z.coerce.number().int().min(0).default(10),
  MEDIA_TRIGGER_MODE: z.enum(['none', 'message_count', 'time', 'ai', 'manual']).default('ai'),
  MEDIA_TIME_MINUTES: z.coerce.number().int().min(0).default(240),
});

type RawEnv = z.infer<typeof envSchema>;

export interface EnvConfig {
  nodeEnv: NodeEnv;
  botToken: string;
  databaseUrl: string;
  openaiApiKey: string;
  /** Telegram user ids allowed to run /admin commands. */
  adminIds: Set<number>;
  port: number;
  pollingMode: 'polling' | 'webhook';
  webhookUrl: string | undefined;
  webhookSecret: string | undefined;
  /** Optional whitelist of chats the business bot is allowed to serve. */
  allowedChatIds: Set<number>;
  allowedUpdates: string[];
  aiModel: string;
  aiTemperature: number;
  aiMaxTokens: number;
  historyLimit: number;
  defaultLanguage: string;
  preferLanguage: PreferLanguage;
  openaiBaseUrl: string | undefined;
  aiProviders: AiProviderConfig[];
  mediaCooldownMs: number;
  mediaMessageThreshold: number;
  mediaTriggerMode: MediaTriggerMode;
  mediaTimeMs: number;
}

function parseIdList(raw: string): number[] {
  return raw
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .map((part) => {
      const id = Number(part);
      if (!Number.isSafeInteger(id) || id <= 0) {
        throw new Error(`Invalid id in env list: "${part}"`);
      }
      return id;
    });
}

/** Builds the ordered list of AI providers (failover sequence). */
function parseAiProviders(raw: RawEnv): AiProviderConfig[] {
  const rawJson = (process.env.AI_PROVIDERS_JSON ?? '').trim();

  if (rawJson.length > 0) {
    let value: unknown;
    try {
      value = JSON.parse(rawJson) as unknown;
    } catch {
      throw new Error('AI_PROVIDERS_JSON is not valid JSON');
    }
    const parsed = z.array(providerSchema).safeParse(value);
    if (!parsed.success) {
      const issues = parsed.error.issues
        .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
        .join('\n');
      throw new Error(`Invalid AI_PROVIDERS_JSON:\n${issues}`);
    }
    const unique = new Set(parsed.data.map((p) => p.name));
    if (unique.size !== parsed.data.length) {
      throw new Error('AI_PROVIDERS_JSON provider names must be unique');
    }
    return parsed.data;
  }

  // Legacy: single provider configured via OPENAI_* variables.
  if (!raw.OPENAI_API_KEY) {
    throw new Error(
      'No AI provider configured: set AI_PROVIDERS_JSON (multi-provider mode) or OPENAI_API_KEY (single-provider mode).',
    );
  }
  return [
    {
      name: 'primary',
      apiKey: raw.OPENAI_API_KEY,
      baseUrl: raw.OPENAI_BASE_URL ?? 'https://api.openai.com/v1',
      model: raw.AI_MODEL,
      supportsJsonMode: true,
    },
  ];
}

function loadEnv(): EnvConfig {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment variables:\n${issues}`);
  }
  const raw: RawEnv = result.data;

  return {
    nodeEnv: raw.NODE_ENV,
    botToken: raw.BOT_TOKEN,
    databaseUrl: raw.DATABASE_URL,
    openaiApiKey: raw.OPENAI_API_KEY ?? '',
    adminIds: new Set(parseIdList(raw.ADMIN_IDS)),
    port: raw.PORT,
    pollingMode: raw.POLLING_MODE,
    webhookUrl: raw.WEBHOOK_URL,
    webhookSecret: raw.WEBHOOK_SECRET,
    allowedChatIds: new Set(parseIdList(raw.ALLOWED_CHAT_IDS)),
    allowedUpdates: raw.ALLOWED_UPDATES.split(',')
      .map((part) => part.trim())
      .filter((part) => part.length > 0),
    aiModel: raw.AI_MODEL,
    aiTemperature: raw.AI_TEMPERATURE,
    aiMaxTokens: raw.AI_MAX_TOKENS,
    historyLimit: raw.HISTORY_LIMIT,
    defaultLanguage: raw.DEFAULT_LANGUAGE,
    preferLanguage: raw.PREFER_LANGUAGE,
    openaiBaseUrl: raw.OPENAI_BASE_URL,
    aiProviders: parseAiProviders(raw),
    mediaCooldownMs: raw.MEDIA_COOLDOWN_MINUTES * 60 * 1000,
    mediaMessageThreshold: raw.MEDIA_MESSAGE_THRESHOLD,
    mediaTriggerMode: raw.MEDIA_TRIGGER_MODE,
    mediaTimeMs: raw.MEDIA_TIME_MINUTES * 60 * 1000,
  };
}

export const env: EnvConfig = loadEnv();