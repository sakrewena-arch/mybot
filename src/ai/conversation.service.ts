import {
  buildContextPrompt,
  buildSystemPrompt,
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
  /** true → provider supports response_format=json_object and gets strict JSON rules. */
  jsonMode: boolean;
  /** true → the model may offer a paid media (strict JSON or a [MEDIA:<id>] marker). */
  mediaDecision: boolean;
  history: HistoryTurn[];
  profile: UserProfile;
  catalog: MediaCatalogEntry[];
  /** Optional extra context appended to the system prompt (e.g. follow-up note). */
  extraInstruction?: string;
}

/**
 * Assembles the message array sent to the model as a REAL chat:
 * 1. one system message (personality + style + rules),
 * 2. a compact context block (user profile + catalog) as a user-like message,
 * 3. the recent history as true user/assistant turns, oldest first.
 *
 * The FINAL message is therefore the user's latest message — exactly what the
 * model has to answer. Feeding the whole conversation as one giant user
 * message makes models sound robotic and repeat themselves; real turns keep
 * the discussion natural.
 */
export function buildConversationMessages(options: BuildConversationOptions): ChatMessage[] {
  const system = buildSystemPrompt(
    {
      systemPrompt: options.systemPrompt,
      defaultLanguage: options.defaultLanguage,
      preferLanguage: options.preferLanguage,
    },
    { jsonMode: options.jsonMode, softMediaMode: options.mediaDecision && !options.jsonMode },
  );
  const finalSystem = options.extraInstruction
    ? `${system}\n\n${options.extraInstruction}`
    : system;

  const context = buildContextPrompt({
    profile: options.profile,
    catalog: options.catalog,
  });

  const historyTurns: ChatMessage[] = options.history.map((turn) => ({
    role: turn.role,
    content: turn.text,
  }));

  return [
    { role: 'system', content: finalSystem },
    { role: 'user', content: context },
    ...historyTurns,
  ];
}