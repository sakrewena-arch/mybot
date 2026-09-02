/** Default personality used when no custom prompt is configured in BotSettings. */
export const DEFAULT_SYSTEM_PROMPT = `You are the personal assistant of this Telegram Business account. You write exactly like the account owner, in a warm, natural, concise way.

Rules:
- Always reply in plain text. Never use Markdown, emoji overload or lists.
- Match the length and tone of the user's message. Prefer short, natural replies. Once a conversation is running, never start a reply with generic greetings like "Hello! Thank you for your message."
- Never repeat the same sentence across consecutive messages.
- Be helpful, charming and human.
- You never invent products, prices, titles or media. When the media catalog is provided you may only reference media by their exact id.` + '\n\n' + `Respond in English.`;

export interface MediaCatalogEntry {
  id: number;
  title: string;
  description: string | null;
  type: 'PHOTO' | 'VIDEO';
  priceStars: number;
  triggerType: 'MESSAGE_COUNT' | 'TIME' | 'AI' | 'MANUAL' | 'NONE';
  triggerValue: number | null;
}

export interface HistoryTurn {
  role: 'user' | 'assistant';
  text: string;
}

export interface UserProfile {
  firstName: string | null;
  lastName: string | null;
  username: string | null;
  languageCode: string | null;
  messageCount: number;
  lastInteractionAt: Date | null;
  ownedMediaIds: number[];
}

export interface BuildSettingsPromptInput {
  systemPrompt: string;
  defaultLanguage: string;
  preferLanguage: 'en' | 'user';
}

export function buildSystemPrompt(
  settings: BuildSettingsPromptInput,
  opts: { jsonMode: boolean },
): string {
  const languageInstruction =
    settings.preferLanguage === 'user'
      ? `Try to feel the user's language (their code is visible in the profile); if you cannot, fall back to '${settings.defaultLanguage}'.`
      : `Always answer in '${settings.defaultLanguage}'.`;

  const mediaRules = `
Business rules:
- You may OFFER one paid media per conversation when it feels natural, but never at every message.
- Only use media ids that exist in the provided catalog (mediaId field). If you want to propose a media you MUST return it in the structured JSON described below.
- Never mention media that is not present in the catalog, and never invent a price for it.
- If the user already owns all catalog media (see owned list), never propose media.
- Never propose the same media twice to the same user.`;

  const jsonInstruction = opts.jsonMode
    ? `

Return STRICT JSON with exactly this shape:
{"reply": "<your conversational answer, plain text>", "shouldSendPaidMedia": true|false, "mediaId": <number|null>, "reason": "<short reason or empty string>"}
- "reply" is what you send to the chat.
- If you propose media, "shouldSendPaidMedia" must be true and "mediaId" MUST be an id from the catalog.
- If you do not propose media, set "shouldSendPaidMedia": false and "mediaId": null.
- No text outside the JSON object.`
    : '';

  return [settings.systemPrompt, languageInstruction, mediaRules, jsonInstruction]
    .filter((part) => part.length > 0)
    .join('\n');
}

function formatDate(date: Date | null): string {
  return date ? date.toISOString() : 'n/a';
}

export function buildUserPrompt(input: {
  profile: UserProfile;
  history: HistoryTurn[];
  catalog: MediaCatalogEntry[];
}): string {
  const { profile, history, catalog } = input;

  const catalogText =
    catalog.length === 0
      ? '(empty)'
      : catalog
          .map(
            (m) =>
              `- id=${m.id} title="${m.title}" type=${m.type.toLowerCase()} price=${m.priceStars} stars description="${m.description ?? ''}"`,
          )
          .join('\n');

  const historyText =
    history.length === 0
      ? '(no prior messages)'
      : history.map((turn) => `${turn.role}: ${turn.text}`).join('\n');

  const ownedText =
    profile.ownedMediaIds.length === 0
      ? '(none)'
      : profile.ownedMediaIds.map((id) => `#${id}`).join(', ');

  return [
    `## User profile`,
    `- name: ${[profile.firstName, profile.lastName].filter(Boolean).join(' ') || 'unknown'}`,
    `- username: ${profile.username ?? 'unknown'}`,
    `- language code: ${profile.languageCode ?? 'unknown'}`,
    `- messages in this chat: ${profile.messageCount}`,
    `- last interaction: ${formatDate(profile.lastInteractionAt)}`,
    `- media already bought: ${ownedText}`,
    ``,
    `## Recent conversation (oldest first)`,
    historyText,
    ``,
    `## Media catalog (the ONLY media that exist)`,
    catalogText,
  ].join('\n');
}