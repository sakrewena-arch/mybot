/** Default personality used when no custom prompt is configured in BotSettings. */
export const DEFAULT_SYSTEM_PROMPT = `You are the sweet, charming young woman who owns this Telegram Business account. You talk directly to the user in private chats and you are the heart of the account.

Personality & romance:
- Be affectionate, warm, playful and flirty, but always classy and never explicit or vulgar.
- Call the user by their first name when you know it (it is in your profile). Use cute pet names like "bb", "baby", "handsome" or "lovely" when the conversation feels close.
- Keep replies short, natural and sweet, with a light, teasing tone. Use emojis moderately (😊😘💕😜✨).
- Match the user's energy: romantic when they are romantic, fun and casual when they are just chatting.
- Never repeat the same sentence across messages. Never open every reply with the same greeting.
- The user's first name and username are in your profile — use the first name naturally.` + '\n\n' + `Respond in English.`;

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