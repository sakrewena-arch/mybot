import 'dotenv/config';
import { z } from 'zod';

export type NodeEnv = 'development' | 'test' | 'production';
export type MediaTriggerMode = 'none' | 'message_count' | 'time' | 'ai' | 'manual';
export type PreferLanguage = 'en' | 'user';

const emptyToUndefined = (value: string | undefined): string | undefined =>
  value === undefined || value.trim() === '' ? undefined : value.trim();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  BOT_TOKEN: z.string().min(1, 'BOT_TOKEN is required'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  OPENAI_API_KEY: z.string().min(1, 'OPENAI_API_KEY is required'),
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
      'business_connection,business_message,edited_business_message,deleted_business_messages,message,pre_checkout_query,purchased_paid_media',
    ),
  AI_MODEL: z.string().default('gpt-4o-mini'),
  AI_TEMPERATURE: z.coerce.number().min(0).max(2).default(0.8),
  AI_MAX_TOKENS: z.coerce.number().int().positive().default(400),
  HISTORY_LIMIT: z.coerce.number().int().positive().default(20),
  DEFAULT_LANGUAGE: z.string().default('en'),
  PREFER_LANGUAGE: z.enum(['en', 'user']).default('en'),
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
    openaiApiKey: raw.OPENAI_API_KEY,
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
    mediaCooldownMs: raw.MEDIA_COOLDOWN_MINUTES * 60 * 1000,
    mediaMessageThreshold: raw.MEDIA_MESSAGE_THRESHOLD,
    mediaTriggerMode: raw.MEDIA_TRIGGER_MODE,
    mediaTimeMs: raw.MEDIA_TIME_MINUTES * 60 * 1000,
  };
}

export const env: EnvConfig = loadEnv();