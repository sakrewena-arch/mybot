import express, { type Express } from 'express';
import cors from 'cors';
import { webhookCallback } from 'grammy';
import type { Bot } from 'grammy';
import { env } from './config/env.js';
import { logger } from './utils/logger.js';

export interface CreateAppOptions {
  bot: Bot;
  webhookPath?: string | null;
}

/**
 * HTTP layer:
 * - GET  /health            → { status: 'ok' } (always available)
 * - POST /telegram/webhook  → Telegram update delivery (webhook mode only)
 *
 * The webhook route verifies `X-Telegram-Bot-Api-Secret-Token` when
 * WEBHOOK_SECRET is configured (matching the value sent to setWebhook).
 */
export function createApp({ bot, webhookPath }: CreateAppOptions): Express {
  const app = express();

  app.use(cors());
  app.use(express.json({ limit: '2mb' }));

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  if (webhookPath) {
    if (env.webhookSecret) {
      app.use(webhookPath, (req, res, next) => {
        const token = req.headers['x-telegram-bot-api-secret-token'];
        if (token !== env.webhookSecret) {
          res.status(401).json({ error: 'unauthorized' });
          return;
        }
        next();
      });
    }
    app.use(webhookPath, webhookCallback(bot, 'express'));
  }

  app.use(
    (err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      logger.error({ error: err }, 'unhandled HTTP error');
      res.status(500).json({ error: 'internal error' });
    },
  );

  return app;
}