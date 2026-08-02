-- Discord guild ban: revoke web session + restrict gen/API/requests without full site ban.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "webSessionRevokedAt" TIMESTAMP(3);
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "webSessionRevokeReason" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "discordGuildBannedAt" TIMESTAMP(3);
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "webLoginAt" TIMESTAMP(3);
