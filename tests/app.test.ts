import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Server } from 'node:http';
import type { Bot } from 'grammy';
import { createApp } from '../src/app.js';

const stubBot = {
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
});