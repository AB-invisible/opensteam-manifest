-- CreateEnum
CREATE TYPE "VerificationSessionStatus" AS ENUM ('PENDING', 'OAUTH_COMPLETE', 'COMPLETED', 'EXPIRED', 'FAILED');

-- AlterTable
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "discordVerifiedAt" TIMESTAMP(3);
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "verifyIp" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "verifyCountry" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "verifyFingerprint" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "discordAccountCreatedAt" TIMESTAMP(3);
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "discordConnections" JSONB;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "discordGuildsSnapshot" JSONB;

-- CreateTable
CREATE TABLE IF NOT EXISTS "discord_verification_sessions" (
    "id" TEXT NOT NULL,
    "discordId" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "status" "VerificationSessionStatus" NOT NULL DEFAULT 'PENDING',
    "sessionSecret" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "oauthAccessToken" TEXT,
    "oauthRefreshToken" TEXT,
    "verifyIp" TEXT,
    "verifyCountry" TEXT,
    "verifyUserAgent" TEXT,
    "verifyFingerprint" TEXT,
    "verifyCanvasHash" TEXT,
    "vpnDetected" BOOLEAN NOT NULL DEFAULT false,
    "altMatchedUserIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "riskFlags" JSONB,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "discord_verification_sessions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "verification_audit_logs" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT,
    "discordId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "flags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "details" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "verification_audit_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "discord_verification_sessions_discordId_idx" ON "discord_verification_sessions"("discordId");
CREATE INDEX IF NOT EXISTS "discord_verification_sessions_status_idx" ON "discord_verification_sessions"("status");
CREATE INDEX IF NOT EXISTS "discord_verification_sessions_expiresAt_idx" ON "discord_verification_sessions"("expiresAt");
CREATE INDEX IF NOT EXISTS "verification_audit_logs_discordId_idx" ON "verification_audit_logs"("discordId");
CREATE INDEX IF NOT EXISTS "verification_audit_logs_sessionId_idx" ON "verification_audit_logs"("sessionId");
CREATE INDEX IF NOT EXISTS "verification_audit_logs_createdAt_idx" ON "verification_audit_logs"("createdAt");

ALTER TABLE "verification_audit_logs" DROP CONSTRAINT IF EXISTS "verification_audit_logs_sessionId_fkey";
ALTER TABLE "verification_audit_logs" ADD CONSTRAINT "verification_audit_logs_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "discord_verification_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
