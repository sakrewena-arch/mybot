import { describe, it, expect } from 'vitest';
import {
  canReply,
  canReplyFromRights,
  isChatAllowed,
  summarizePermissions,
} from '../src/bot/business/permissions.js';
import { makeBusinessConnection } from './helpers/fakes.js';

describe('business permissions', () => {
  it('allows replies only when enabled AND can_reply', () => {
    expect(canReply({ isEnabled: true, canReply: true })).toBe(true);
    expect(canReply({ isEnabled: true, canReply: false })).toBe(false);
    expect(canReply({ isEnabled: false, canReply: true })).toBe(false);
  });

  it('reads can_reply from BusinessBotRights', () => {
    expect(canReplyFromRights({ can_reply: true })).toBe(true);
    expect(canReplyFromRights({ can_read_messages: true })).toBe(false);
    expect(canReplyFromRights(null)).toBe(false);
  });

  it('allows every chat when the allowlist is empty', () => {
    expect(isChatAllowed(123, new Set())).toBe(true);
  });

  it('restricts chats when an allowlist is configured', () => {
    const allowed = new Set([123, 456]);
    expect(isChatAllowed(123, allowed)).toBe(true);
    expect(isChatAllowed(999, allowed)).toBe(false);
  });

  it('summarizes granted rights for the admin panel', () => {
    const connection = makeBusinessConnection({
      permissions: { can_reply: true, can_read_messages: true },
    });
    const summary = summarizePermissions(connection);
    expect(summary).toContain('can reply to pending chats');
    expect(summary).toContain('can read messages');

    const empty = makeBusinessConnection({ permissions: {} });
    expect(summarizePermissions(empty)).toBe('(no explicit rights granted)');
  });
});