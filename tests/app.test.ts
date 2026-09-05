import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Server } from 'node:http';
import type { Bot } from 'grammy';
import { createApp } from '../src/app.js';

const stubBot = {
  init: async () => undefined,
  handleUpdate: async () => undefined,
  isRunning: () => false,
} as unknown as Bot;

describe('HTTP app', () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    const app = createApp({ bot: stubBot, webhookPath: '/telegram/webhook' });
    server = app.listen(0);
    await new Promise<void>((resolve) => server.once('listening', () => resolve()));
    const address = server.address();
    if (typeof address === 'object' && address !== null) {
      baseUrl = `http://127.0.0.1:${address.port}`;
    } else {
      throw new Error('server did not bind a port');
    }
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  });

  it('GET /health returns ok', async () => {
    const res = await fetch(`${baseUrl}/health`);
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ status: 'ok' });
  });

  it('rejects webhook requests without the secret token when configured', async () => {
    // WEBHOOK_SECRET is read from env at import time; the default setup has
    // it unset in CI, so this guards the 401 path only when provided.
    if (!process.env.WEBHOOK_SECRET) return;
    const res = await fetch(`${baseUrl}/telegram/webhook`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ update_id: 1 }),
    });
    expect(res.status).toBe(401);
  });

  it('acknowledges updates immediately even when the handler takes minutes', async () => {
    let resolveHandle!: () => void;
    const slowBot = {
      init: async () => undefined,
      handleUpdate: () =>
        new Promise<void>((resolve) => {
          resolveHandle = resolve;
        }),
      isRunning: () => false,
    } as unknown as Bot;

    const app2 = createApp({ bot: slowBot, webhookPath: '/telegram/webhook' });
    const server2 = app2.listen(0);
    await new Promise<void>((r) => server2.once('listening', () => r()));
    const addr = server2.address();
    const url =
      typeof addr === 'object' && addr !== null ? `http://127.0.0.1:${addr.port}` : '';

    try {
      const started = Date.now();
      const headers: Record<string, string> = { 'content-type': 'application/json' };
      if (process.env.WEBHOOK_SECRET) {
        headers['x-telegram-bot-api-secret-token'] = process.env.WEBHOOK_SECRET;
      }
      const res = await fetch(`${url}/telegram/webhook`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ update_id: 7 }),
      });
      expect(res.status).toBe(200);
      // The old grammY callback would have blocked for 10s and answered 500.
      expect(Date.now() - started).toBeLessThan(1000);
      resolveHandle();
    } finally {
      await new Promise<void>((resolve, reject) =>
        server2.close((err) => (err ? reject(err) : resolve())),
      );
    }
  });
});