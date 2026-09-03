import type { InputPaidMedia } from '@grammyjs/types/methods.js';

/** Minimal Telegram user shape used by our repositories (subset of the API type). */
export interface TelegramUserDto {
  id: number;
  is_bot?: boolean;
  first_name?: string;
  last_name?: string;
  username?: string | null;
  language_code?: string;
}

/** A `business_message` update normalized for business logic (no grammY dependency). */
export interface BusinessMessageDto {
  business_connection_id: string;
  chat_id: number;
  from: TelegramUserDto;
  message_id: number;
  date: number;
  text?: string;
}

/** Loose structural contract for the Telegram API client used by the services. */
export interface ApiLike {
  sendMessage(args: {
    business_connection_id?: string;
    chat_id: number | string;
    text: string;
    protect_content?: boolean;
    reply_markup?: unknown;
  }): Promise<{ message_id?: number }>;

  sendPaidMedia(args: {
    business_connection_id?: string;
    chat_id: number | string;
    star_count: number;
    media: InputPaidMedia<string>[];
    payload?: string;
    caption?: string;
    protect_content?: boolean;
  }): Promise<{ message_id?: number }>;

  answerPreCheckoutQuery(args: {
    pre_checkout_query_id: string;
    ok: boolean;
    error_message?: string;
  }): Promise<true>;

  readBusinessMessage?(args: {
    business_connection_id: string;
    chat_id: number;
    message_id: number;
  }): Promise<true>;

  /**
   * Shows a chat-action indicator (e.g. "typing") on behalf of a business
   * connection. The exact list of allowed actions depends on the scope the
   * business account granted the bot.
   */
  sendChatAction?(args: {
    business_connection_id?: string;
    chat_id: number | string;
    action: string;
  }): Promise<unknown>;
}