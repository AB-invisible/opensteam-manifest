-- Richer Discord profile data captured at verification
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "discordGlobalName" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "discordLocale" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "discordPremiumType" INTEGER;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "discordMfaEnabled" BOOLEAN;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "discordEmailVerified" BOOLEAN;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "discordPublicFlags" INTEGER;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "discordProfileSnapshot" JSONB;

ALTER TABLE "discord_verification_sessions" ADD COLUMN IF NOT EXISTS "discordIntelSnapshot" JSONB;
