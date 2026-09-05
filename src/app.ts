import express, { type Express } from 'express';
import cors from 'cors';
import type { Bot } from 'grammy';
import { env } from './config/env.js';
import { logger } from './utils/logger.js';
import { toErrorMessage } from './utils/errors.js';

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
 *
 * IMPORTANT: business updates can take minutes (human-like read delay + AI
 * generation). grammY's `webhookCallback` answers only after the handler
 * finishes and times out after 10 s (answering 500 → Telegram retries the same
 * update → duplicate replies and error spam). We therefore acknowledge every
 * update with 200 immediately and process it in the background.
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

    let initPromise: Promise<void> | null = null;

    app.post(webhookPath, async (req, res) => {
      const update: unknown = req.body;
      if (!update || typeof update !== 'object') {
        res.status(400).json({ error: 'missing update' });
        return;
      }

      // Acknowledge immediately so Telegram does not retry this delivery.
      res.sendStatus(200);

      void (async () => {
        try {
          if (!initPromise) {
            initPromise = bot.init().catch((error: unknown) => {
              initPromise = null;
              throw error;
            });
          }
          await initPromise;
          await bot.handleUpdate(update as never);
        } catch (error) {
          logger.error(
            {
              error: toErrorMessage(error),
              updateId: (update as { update_id?: unknown }).update_id,
            },
            'update handling failed',
          );
        }
      })();
    });
  }

  app.use(
    (err: unknown, req: express.Request, res: express.Response, _next: express.NextFunction) => {
      logger.error(
        {
          error: toErrorMessage(err),
          stack: err instanceof Error ? err.stack : null,
          method: req.method,
          path: req.path,
        },
        'unhandled HTTP error',
      );
      res.status(500).json({ error: 'internal error' });
    },
  );

  return app;
}