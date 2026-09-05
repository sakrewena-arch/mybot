import {
  buildSystemPrompt,
  buildUserPrompt,
  type HistoryTurn,
  type MediaCatalogEntry,
  type UserProfile,
} from './prompt.service.js';

/** Minimal chat message shape accepted by the OpenAI SDK. */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface BuildConversationOptions {
  systemPrompt: string;
  preferLanguage: 'en' | 'user';
  defaultLanguage: string;
  jsonMode: boolean;
  history: HistoryTurn[];
  profile: UserProfile;
  catalog: MediaCatalogEntry[];
  /** Optional extra context appended to the system prompt (e.g. follow-up note). */
  extraInstruction?: string;
}

/**
 * Assembles the message array sent to the model:
 * one system message (personality + rules) and one user message
 * (profile + history + catalog).
 */
export function buildConversationMessages(options: BuildConversationOptions): ChatMessage[] {
  const system = buildSystemPrompt(
    {
      systemPrompt: options.systemPrompt,
      defaultLanguage: options.defaultLanguage,
      preferLanguage: options.preferLanguage,
    },
    { jsonMode: options.jsonMode },
  );
  const finalSystem = options.extraInstruction
    ? `${system}\n\n${options.extraInstruction}`
    : system;

  const user = buildUserPrompt({
    profile: options.profile,
    history: options.history,
    catalog: options.catalog,
  });

  return [
    { role: 'system', content: finalSystem },
    { role: 'user', content: user },
  ];
}