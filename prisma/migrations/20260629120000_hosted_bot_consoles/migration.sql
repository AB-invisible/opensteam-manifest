-- CreateEnum (idempotent: hosted bot tables were originally created via db push)
DO $$ BEGIN
  CREATE TYPE "HostedBotLogLevel" AS ENUM ('INFO', 'WARN', 'ERROR', 'EVENT');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "HostedBotCommandType" AS ENUM ('SEND_MESSAGE', 'RECONNECT');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "HostedBotCommandStatus" AS ENUM ('PENDING', 'RUNNING', 'DONE', 'FAILED');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- AlterTable: runtime metadata captured by the hosted bot daemons
ALTER TABLE "hosted_bot_instances" ADD COLUMN IF NOT EXISTS "botUsername" TEXT;
ALTER TABLE "hosted_bot_instances" ADD COLUMN IF NOT EXISTS "guildName" TEXT;
ALTER TABLE "hosted_bot_instances" ADD COLUMN IF NOT EXISTS "guildOwnerId" TEXT;
ALTER TABLE "hosted_bot_instances" ADD COLUMN IF NOT EXISTS "guildOwnerName" TEXT;
ALTER TABLE "hosted_bot_instances" ADD COLUMN IF NOT EXISTS "memberCount" INTEGER;
ALTER TABLE "hosted_bot_instances" ADD COLUMN IF NOT EXISTS "connectedAt" TIMESTAMP(3);
ALTER TABLE "hosted_bot_instances" ADD COLUMN IF NOT EXISTS "lastHeartbeatAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE IF NOT EXISTS "hosted_bot_logs" (
    "id" TEXT NOT NULL,
    "instanceId" TEXT,
    "scope" "HostedBotType",
    "level" "HostedBotLogLevel" NOT NULL DEFAULT 'INFO',
    "source" TEXT,
    "message" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hosted_bot_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "hosted_bot_commands" (
    "id" TEXT NOT NULL,
    "instanceId" TEXT NOT NULL,
    "type" "HostedBotCommandType" NOT NULL,
    "payload" TEXT,
    "status" "HostedBotCommandStatus" NOT NULL DEFAULT 'PENDING',
    "result" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "executedAt" TIMESTAMP(3),

    CONSTRAINT "hosted_bot_commands_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "hosted_bot_logs_instanceId_createdAt_idx" ON "hosted_bot_logs"("instanceId", "createdAt");
CREATE INDEX IF NOT EXISTS "hosted_bot_logs_scope_createdAt_idx" ON "hosted_bot_logs"("scope", "createdAt");
CREATE INDEX IF NOT EXISTS "hosted_bot_commands_status_createdAt_idx" ON "hosted_bot_commands"("status", "createdAt");
CREATE INDEX IF NOT EXISTS "hosted_bot_commands_instanceId_createdAt_idx" ON "hosted_bot_commands"("instanceId", "createdAt");

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "hosted_bot_logs" ADD CONSTRAINT "hosted_bot_logs_instanceId_fkey" FOREIGN KEY ("instanceId") REFERENCES "hosted_bot_instances"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "hosted_bot_commands" ADD CONSTRAINT "hosted_bot_commands_instanceId_fkey" FOREIGN KEY ("instanceId") REFERENCES "hosted_bot_instances"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
