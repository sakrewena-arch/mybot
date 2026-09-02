# mybot — Telegram Business Assistant Bot

A professional **Node.js + TypeScript** bot built on the official **Telegram Bot API**
that connects to a **Telegram Business account** and, on its behalf:

1. receives `business_message` updates from private conversations,
2. replies naturally in English using **OpenAI**,
3. occasionally offers **paid media unlocked with Telegram Stars**
   (`sendPaidMedia`, currency `XTR`),
4. records purchases and never asks twice for something the user already owns.

Only official Telegram Bot API features are used. **No userbots, no MTProto, no
unofficial methods.**

---

## Stack

| Layer        | Tech                                        |
| ------------ | ------------------------------------------- |
| Runtime      | Node.js 22+, TypeScript 5.9 (strict)        |
| Bot          | grammY 1.46 (official Bot API)              |
| Database     | PostgreSQL 16 + Prisma 6 ORM                |
| AI           | OpenAI API (model configurable)             |
| HTTP         | Express 5 (`/health`, `/telegram/webhook`)  |
| Validation   | Zod                                         |
| Logs         | Pino (+ `pino-pretty` in dev)               |
| Tests        | Vitest                                      |
| Tooling      | ESLint 9 + Prettier                         |

---

## Architecture

```
src/
├── app.ts                        # Express app: /health + /telegram/webhook
├── index.ts                      # entrypoint: polling or webhook startup
├── config/env.ts                 # Zod-validated environment
├── bot/
│   ├── bot.ts                    # composition root (repos + services + handlers)
│   ├── business/
│   │   ├── connection.handler.ts # business_connection updates
│   │   ├── message.handler.ts    # business_message / edited / deleted
│   │   └── permissions.ts        # can_reply + rights checks
│   ├── payments/
│   │   ├── paid-media.ts         # sendPaidMedia encapsulation
│   │   ├── payment.handler.ts    # purchased_paid_media + successful_payment
│   │   └── stars.ts              # XTR helpers + payload codecs
│   ├── commands/                 # /start /help /admin /stats /addmedia
│   └── keyboards/
├── ai/
│   ├── conversation.service.ts   # messages assembly for the model
│   ├── prompt.service.ts         # system prompt builder (BotSettings)
│   └── response.service.ts       # OpenAI call + JSON decision parsing
├── media/
│   ├── media.service.ts          # catalog + owned-media queries
│   └── selection.ts              # pure trigger/cooldown logic
├── database/
│   ├── prisma.ts                 # singleton PrismaClient
│   └── repositories/             # data access per aggregate
├── services/                     # user/conversation/purchase/business services
├── types/                        # shared structural types
└── utils/                        # logger, errors
prisma/
├── schema.prisma                 # User, BusinessConnection, Conversation, Message,
│                                 # Media, Purchase, MediaProposal, BotSettings
├── seed.ts
└── migrations/20260902000000_init/migration.sql
tests/                            # Vitest unit + handler integration tests
```

---

## 1. Prerequisites

- **Node.js ≥ 22** — <https://nodejs.org> (22.19+ recommended)
- **Docker** with Docker Desktop running (for PostgreSQL)
- A **Telegram Business account** (Business premium required to grant a bot access)
- An **OpenAI API key**

### Install Node.js

```bash
node --version   # must be >= 22
npm --version
```

### Install dependencies

```bash
npm install
```
---

## 2. Database

### Start PostgreSQL

```bash
docker compose up -d
# postgres:16-alpine on localhost:5432, user mybot / pass mypassword / db mybot
```

### Create the schema

```bash
npm run prisma:generate      # generate the Prisma client (also runs on install)
npm run prisma:migrate       # apply the init migration (creates tables)
npm run prisma:seed          # creates the singleton BotSettings row
```

The migration is already committed under `prisma/migrations/…`. For a fresh clone
you can also run `npx prisma migrate deploy`.

---

## 3. Configuration

Copy the example and fill in real values:

```bash
cp .env.example .env
```

| Variable              | Meaning                                                        |
| --------------------- | -------------------------------------------------------------- |
| `BOT_TOKEN`           | Token from **@BotFather**                                      |
| `DATABASE_URL`        | `postgresql://mybot:mypassword@localhost:5432/mybot`           |
| `OPENAI_API_KEY`      | OpenAI key                                                     |
| `ADMIN_IDS`           | `123456789,987654321` — Telegram user ids allowed to run `/admin` |
| `PORT`                | HTTP port for webhook + health (default 3000)                  |
| `POLLING_MODE`        | `polling` (local) or `webhook` (production)                    |
| `WEBHOOK_URL`         | Public HTTPS URL, e.g. `https://bot.example.com/telegram/webhook` |
| `WEBHOOK_SECRET`      | Long random string sent to Telegram; verified on every webhook request |
| `ALLOWED_CHAT_IDS`    | Optional whitelist of chats the business bot may serve          |
| `ALLOWED_UPDATES`     | Which updates Telegram delivers (kept current in `.env.example`) |
| `AI_MODEL` / `AI_TEMPERATURE` / `AI_MAX_TOKENS` | OpenAI call parameters  |
| `HISTORY_LIMIT`       | How many recent messages are sent to the model                  |
| `DEFAULT_LANGUAGE`    | `en` — fallback language                                        |
| `PREFER_LANGUAGE`     | `en` (always English) or `user` (guess from the user profile)   |
| `MEDIA_COOLDOWN_MINUTES` | Minimum space between two paid offers for the same user       |
| `MEDIA_MESSAGE_THRESHOLD` | Message count that unlocks `message_count` offers             |
| `MEDIA_TRIGGER_MODE`  | `none` / `message_count` / `time` / `ai` / `manual`             |
| `MEDIA_TIME_MINUTES`  | Wait after the last proposal before a `time` offer              |

All variables are validated with **Zod** at startup — the process refuses to boot
with an invalid configuration.

---

## 4. Telegram Business — step by step

### 4.1 Create the bot — @BotFather

1. Open **@BotFather** in Telegram.
2. Send `/newbot`, pick a name and a username.
3. Copy the token — this is your `BOT_TOKEN`.
4. Optionally set `/setcommands`:
   ```
   start - Start
   help - How it works
   admin - Admin panel (restricted)
   stats - Statistics (restricted)
   ```

### 4.2 Enable the features the bot needs

The bot needs the following updates delivered. They are requested automatically
via `allowed_updates` (see `ALLOWED_UPDATES` in the config):

- `business_connection`
- `business_message`
- `edited_business_message`
- `deleted_business_messages`
- `message` (for `/admin` and purchases)
- `purchased_paid_media` (paid media purchases)
- `pre_checkout_query`

If you are **not** on webhook mode, call `deleteWebhook` first so long polling
works:

```bash
curl "https://api.telegram.org/bot<TOKEN>/deleteWebhook?drop_pending_updates=true"
```

### 4.3 Connect the bot to the Business account

1. **Telegram > Settings > Business** on the account you want the bot to run as.
2. Open the **Bot / Telegram Business** section → **Connect a bot** (or inside a
   specific private chat use the menu → Connect bot).
3. Choose the bot you created.
4. **Grant the permissions** you need, at minimum:
   - **can reply** — “reply to chats that had incoming messages in the last 24 hours”
   - (recommended) **can read messages** — the bot marks incoming messages read
5. Telegram now sends a `business_connection` update to the bot.
### 4.4 Choosing which conversations the bot can access

Business bots only receive `business_message` for **private chats** where the
business owner explicitly connected the bot, and only for chats with activity in
the **last 24 hours**. You cannot “choose arbitrary chats” — Telegram grants the
bot access per chat, and the 24h window means the bot only sees conversations
where the owner turned it on and that continue to receive messages.

In addition, you can restrict serving with `ALLOWED_CHAT_IDS` (server side).

### 4.5 Checking Business permissions

The `business_connection` update carries a **`rights`** object
(`BusinessBotRights`). The important flags:

| Field                      | Meaning                                                        |
| -------------------------- | -------------------------------------------------------------- |
| `can_reply`                | may send replies in pending private chats (24h window)         |
| `can_read_messages`        | may mark messages as read (`readBusinessMessage`)              |
| `can_delete_outgoing_messages` | may delete its own messages                                |
| `can_delete_all_messages`  | may delete any message in managed chats                        |
| `can_edit_name` / `bio` / `profile_photo` / `username` | edit business profile   |
| `can_manage_stories`       | stories access                                                 |
| `can_view_gifts_and_stars` | view gifts + Stars of the business account                     |
| `can_transfer_stars`       | transfer Stars from the business account to the bot            |

**Where does the code check `can_reply`?**

- the connection handler stores `rights` as a JSON snapshot plus a denormalized
  `canReply` boolean;
- before any business reply, `message.handler.ts` calls
  `businessService.canReply(connection)`;
- `PaidMediaService` refuses to send if the connection is disabled or `canReply`
  is false.

You can see the granted rights at any time with `/admin`.

### 4.6 `business_connection_id` — the golden rule

**Every reply and every paid media send must use the `business_connection_id`
Telegram gave us** and that ships back on each `business_message`. The bot
never guesses it. If we neither have an enabled connection nor `can_reply`, the
message is silently ignored.

### 4.7 Testing `business_message`

1. Run the bot in polling mode (`npm run dev`).
2. From the **Business account**, open a **private chat** and connect the bot
   there (or use “Connect bot” in that chat’s menu).
3. Have the friend send a message → Telegram sends the bot a `business_message`
   → the bot replies on behalf of the business account.
4. Watch the logs for `business message` and `paid media sent`.

### 4.8 Testing `sendPaidMedia`

1. Add a media via `/admin → MEDIA → ➕ Add media` (send a photo/video, set price
   and trigger).
2. Set `MEDIA_TRIGGER_MODE=ai` (or `message_count`) and restart.
3. Have the user chat until the trigger fires. The **“Buy ⭐”** button appears
   under the media.
4. The user buys it → the bot receives `purchased_paid_media` (non-channel)
   with the `payload` we embedded → `Purchase` is created exactly once.

> **Important** — the chat must be a **private chat**, not a channel. Paid media
> in channels is handled differently (Stars go to the channel balance).
---

## 5. Run

### Local development (long polling)

```bash
npm run dev
```

Open `http://localhost:3000/health` → `{"status":"ok"}`.

### Production (webhook)

1. Put the app behind **HTTPS** (reverse proxy / TLS termination), e.g. Nginx:
   ```nginx
   location /telegram/webhook { proxy_pass http://127.0.0.1:3000; }
   location / { proxy_pass http://127.0.0.1:3000; }
   ```
2. Configure `.env`:
   ```
   POLLING_MODE=webhook
   WEBHOOK_URL=https://your.domain/telegram/webhook
   WEBHOOK_SECRET=<long-random-string>
   ```
3. Build and run:
   ```bash
   npm run build
   npm start
   ```

On boot the bot calls `setWebhook(url, { secret_token, allowed_updates })`.
Every request to `POST /telegram/webhook` verifies the
`X-Telegram-Bot-Api-Secret-Token` header before forwarding the update.

### npm scripts

| Script                    | Purpose                                     |
| ------------------------- | ------------------------------------------- |
| `npm run dev`             | tsx watch + long polling                    |
| `npm run build`           | type-check + emit to `dist/`                 |
| `npm start`               | run the compiled `dist/index.js`             |
| `npm run prisma:generate` | generate Prisma Client                      |
| `npm run prisma:migrate`  | apply local migrations (sets up DB)          |
| `npm run prisma:deploy`   | apply migrations in production               |
| `npm run prisma:seed`     | seed BotSettings                            |
| `npm test`                | Vitest                                      |
| `npm run lint`            | ESLint                                      |
| `npm run format`          | Prettier                                    |

---

## 6. Paid media & Telegram Stars

- Media live in the `Media` table (title, description, type, `telegramFileId`,
  `priceStars`, `triggerType`, `active`).
- Offers are sent with `sendPaidMedia` **on the business connection**:
  - `business_connection_id` → the stored Telegram connection id,
  - `star_count` → the media price,
  - `media` → `InputPaidMedia` built from the stored `file_id` (photo/video),
  - `payload` → `{"mediaId": <id>}` — our internal, un-displayed marker.
- Currency is always **XTR** (Telegram Stars).
- Purchase confirmation:
  - private chats: Telegram sends **`purchased_paid_media`** with our `payload`
    bounced back verbatim, and the buyer is the media owner in our DB.
  - invoice-style payments would surface as `successful_payment` (we parse it for
    robustness but never create invoices today).
- **A button click is never treated as a payment.** Only those updates create a
  `Purchase`.
- `Purchase(userId, mediaId)` is **unique**: a second confirmation is ignored
  (idempotent), and `PaidMediaService` refuses to re-sell owned media
  (`ALREADY_PURCHASED`).

### Trigger modes

| Mode            | Behavior                                                        |
| --------------- | --------------------------------------------------------------- |
| `none`          | never auto-offer                                                |
| `message_count` | after `MEDIA_MESSAGE_THRESHOLD` inbound messages                |
| `time`          | after `MEDIA_TIME_MINUTES` since the last offer                 |
| `ai`            | the model returns a JSON media decision (id from the catalog only) |
| `manual`        | offers only sent through the admin flow (`/propose <mediaId> <userId>`) |

Every mode is gated by `MEDIA_COOLDOWN_MINUTES` (default 30).

### AI selection safety

- In `ai` mode the model is asked for a strict JSON object:
  ```json
  { "reply": "…", "shouldSendPaidMedia": true, "mediaId": 123, "reason": "…" }
  ```
- The model receives the media catalog **and** the user’s owned media ids.
- It may only reference an existing `mediaId`; the server **re-validates it
  against the database** before anything is sent.
- The model is explicitly instructed it may not invent products or prices.
---

## 7. Administration

`/admin` (admins only — membership is checked against `ADMIN_IDS` server side):

```
MEDIA  USERS  PURCHASES  CONVERSATIONS  SETTINGS  STATISTICS
```

**Media** — add photo/video (`/addmedia` or the MEDIA panel), edit title,
description, price, toggle active, soft-delete, change trigger type. The admin
panel only stores the Telegram `file_id`; no local file is kept.

**Settings** — toggle the bot on/off globally and edit the persisted system
prompt (`BotSettings.systemPrompt`).

**Statistics** — users, conversations, active media, media offers sent, media
sold, total Stars, sales today/week/month, best-selling media.

Also available: `/stats` and `/help`.

---

## 8. Memory & context

The conversation service keeps, per user/conversation:

- recent message history (AI context),
- first name, username, language,
- total inbound message count,
- last interaction time,
- **owned media ids** and **previously offered media**.

The AI prompt is assembled from: personality (`BotSettings.systemPrompt`),
profile, history, media catalog, owned list, and the business rules. The AI
never repeats offers for owned media, and the proposal history tracks every
`SENT`/`SKIPPED`/`FAILED` attempt for cooldown logic.

---

## 9. Testing

```bash
npm test            # runs tests/ with Vitest
npm run lint
```

Covered scenarios include:

- user creation / update,
- business connection persist & disable,
- `business_message` flow (reply on behalf of the business, correct
  `business_connection_id`),
- `can_reply` permission gating,
- media creation + active catalog + owned-media exclusion,
- `sendPaidMedia` params and guards,
- `purchased_paid_media` → purchase → idempotency (double payment),
- cooldown gating,
- AI media selection (only existing ids),
- AI JSON reply parsing (`shouldSendPaidMedia` / `mediaId` / `reason`),
- `/health` webhook behavior (HTTP).

---

## 10. Deploy

Example on a Linux VPS with nginx + systemd (or Docker):

```bash
git clone <repo> /srv/mybot && cd /srv/mybot
npm ci
npm run build
# configure .env (POLLING_MODE=webhook, WEBHOOK_URL=..., WEBHOOK_SECRET=...)
# point PostgreSQL at the production DATABASE_URL, then:
npm run prisma:deploy
pm2 start dist/index.js --name mybot   # or systemd / node
```

Ensure the domain serves HTTPS with a valid certificate so Telegram can reach
`/telegram/webhook`.

---

## 10.1 Déploiement sur Render (guide détaillé)

Le projet est prêt pour Render (`render.yaml` fourni : Blueprint, build
`npm run build`, start `npm run start`, health `/health`, PostgreSQL lié).

> ⚠️ **Limites du plan gratuit Render** (à connaître avant de commencer)
> - **Web Service gratuit** : l'instance s'endort après **15 min sans trafic**
>   (`spins down`). Pour un bot qui doit répondre **en continu**, c'est fragile.
>   → Soit un **keep-alive** (ping `/health` toutes les ~5 min via
>   [cron-job.org](https://cron-job.org) ou UptimeRobot), soit le plan **Starter
>   ~7 $/mois** (sans sommeil) — recommandé dès que le bot génère des revenus Stars.
> - **PostgreSQL gratuit Render** : base **mono-instance**, **expire après 30
>   jours**. Pour de la production, préférez le Postgres payant ou une base
>   externe gratuite ([Neon](https://neon.tech) free 5 Go, [Supabase](https://supabase.com) free).

### 1. Pousser le projet sur GitHub

```bash
cd mybot
git remote add origin https://github.com/<votre-utilisateur>/mybot.git
git branch -M main
git push -u origin main
```

> ⚠️ Le `.env` réel est ignoré (`.gitignore`). Seul `.env.example` part en Git.

### 2. Créer le Web Service (Blueprint)

**Option A — Blueprint (recommandé, utilise `render.yaml`)**

1. [render.com](https://render.com) → **New +** → **Blueprint**.
2. Connectez GitHub si besoin, choisissez le dépôt `mybot`.
3. Render crée **automatiquement** le Web Service `mybot` **et** la base
   `mybot-db`, avec `DATABASE_URL` déjà branchée.

**Option B — Manuel**

1. **New +** → **Web Service** → connectez GitHub → sélectionnez `mybot`.
2. **Runtime** : `Node`. **Build Command** : `npm run build`.
   **Start Command** : `npm run start`. **Health Check Path** : `/health`.
3. **New +** → **PostgreSQL** → puis dans le Web Service, **link** la base
   (onglet Environment, `DATABASE_URL` s'ajoute automatiquement).

### 3. Variables d'environnement

Dans le Web Service → **Environment**, ajoutez :

| Variable | Valeur |
|---|---|
| `NODE_ENV` | `production` |
| `BOT_TOKEN` | votre token (de @BotFather) |
| `OPENAI_API_KEY` | votre clé OpenAI |
| `ADMIN_IDS` | votre ID Telegram (ex. `7445208820`) |
| `POLLING_MODE` | `webhook` (ou `polling`, voir plus bas) |
| `WEBHOOK_URL` | `https://<votre-app>.onrender.com/telegram/webhook` |
| `WEBHOOK_SECRET` | une longue chaîne aléatoire |
| `MEDIA_TRIGGER_MODE` | `ai` (ou `message_count` / `time` / etc.) |

`DATABASE_URL` est injectée par le lien avec la base — ne la saisissez pas.

L'URL publique Render est : **Settings → Domains** (ex.
`https://mybot.onrender.com`). Utilisez-la pour `WEBHOOK_URL`.

### 4. Déployer et vérifier

- Render redéploie à chaque `git push`. Bouton **Manual Deploy → Deploy** sinon.
- Logs attendus :
```
database connection ok
bot settings ready
webhook registered
webhook server listening
```
- `GET https://<votre-app>.onrender.com/health` → `{"status":"ok"}`.

### 5. Garder l'instance éveillée (plan gratuit)

Créez un ping toutes les 5 minutes sur :
```text
https://<votre-app>.onrender.com/health
```
Avec [cron-job.org](https://cron-job.org) (gratuit) ou UptimeRobot. Cela évite
que le service s'endorme entre deux messages. Pour un bot Business fiable,
le plan **Starter** est recommandé.

### 6. Polling vs webhook

- **Webhook** : Telegram pousse l'update vers `WEBHOOK_URL`. Nécessite un service
  éveillé (keep-alive ou plan payant).
- **Polling** : le bot tire les updates lui-même (sortant). Sur Render gratuit,
  l'instance peut quand même s'endormir → gardez le keep-alive. C'est plus simple
  à mettre en place (pas de `WEBHOOK_URL`).

### 7. En cas de problème

- **`prisma migrate deploy` échoue** → vérifiez que `DATABASE_URL` est bien la
  valeur interne fournie par le lien de base, et que la base n'a pas expiré
  (plan gratuit 30 j).
- **`prisma generate` au build** → `postinstall`/`prebuild` le lancent
  automatiquement ; `prisma` est dans `dependencies` (déjà le cas).
- **Webhook erroné** (`webhook is not set` / `Conflict`) → vérifiez
  `WEBHOOK_URL` + `WEBHOOK_SECRET` (+34 caractères) et redéployez.
- **Le bot ne répond pas** alors que le log est propre → vérifiez que le compte
  Business a bien accordé **can_reply** et que la conversation est < 24 h
  (contrainte Telegram).

---

## 11. Notes & limitations (Telegram Business)

- Business bots can only reply in **private chats** that had incoming messages
  in the **last 24 hours** — this is a Telegram constraint.
- Paid media requires the **Stars** balance; media `star_count` is **1–25000**.
- `sendPaidMedia` in **channels** credits the channel (and reports differently);
  this project targets the **non-channel private chat** flow.
- `readBusinessMessage` is best-effort: it needs `can_read_messages`.
- The admin wizards are in-memory; restarting the bot clears a half-finished flow.
- OpenAI calls make the total per-message latency depend on the model; the
  assistant replies in a short, natural tone by design.