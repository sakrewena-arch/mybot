-- Re-engagement / follow-up support
ALTER TABLE "conversations" ADD COLUMN "last_inbound_at" TIMESTAMP(3);
ALTER TABLE "conversations" ADD COLUMN "last_outbound_at" TIMESTAMP(3);
ALTER TABLE "conversations" ADD COLUMN "follow_up_count" INTEGER NOT NULL DEFAULT 0;

-- Backfill from the messages table so existing chats can be re-engaged too.
UPDATE "conversations" c
SET "last_inbound_at" = sub.last_in
FROM (
  SELECT "conversation_id", MAX("created_at") AS last_in
  FROM "messages"
  WHERE "direction" = 'IN'
  GROUP BY "conversation_id"
) sub
WHERE sub."conversation_id" = c."id";

UPDATE "conversations" c
SET "last_outbound_at" = sub.last_out
FROM (
  SELECT "conversation_id", MAX("created_at") AS last_out
  FROM "messages"
  WHERE "direction" = 'OUT'
  GROUP BY "conversation_id"
) sub
WHERE sub."conversation_id" = c."id";