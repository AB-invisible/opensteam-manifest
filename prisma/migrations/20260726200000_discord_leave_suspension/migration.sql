-- Migration: discord_leave_suspension
-- Adds discordMemberStatus and discordLeftAt to users table
-- Adds suspendedByLeave to api_keys table

ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "discordMemberStatus" TEXT NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS "discordLeftAt" TIMESTAMP(3);

ALTER TABLE "api_keys"
  ADD COLUMN IF NOT EXISTS "suspendedByLeave" BOOLEAN NOT NULL DEFAULT false;
