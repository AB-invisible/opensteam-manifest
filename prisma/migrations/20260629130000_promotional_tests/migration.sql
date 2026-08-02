-- Promotional (rank progression) tests: Moderator -> Senior Moderator -> Head Moderator.

-- New platform role for Head Moderator.
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'HEAD_MODERATOR';

-- Timed two-section promo exam state on the shared trial_tests table.
ALTER TABLE "trial_tests" ADD COLUMN IF NOT EXISTS "currentSection" TEXT;
ALTER TABLE "trial_tests" ADD COLUMN IF NOT EXISTS "timerState" JSONB;

-- Discord role tenure tracking (time-on-role) for promo eligibility gating.
CREATE TABLE IF NOT EXISTS "discord_role_tenure" (
  "id" TEXT NOT NULL,
  "discordId" TEXT NOT NULL,
  "roleId" TEXT NOT NULL,
  "since" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "removedAt" TIMESTAMP(3),
  "source" TEXT NOT NULL DEFAULT 'bot',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "discord_role_tenure_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "discord_role_tenure_discordId_roleId_key"
  ON "discord_role_tenure"("discordId", "roleId");
CREATE INDEX IF NOT EXISTS "discord_role_tenure_discordId_idx"
  ON "discord_role_tenure"("discordId");
CREATE INDEX IF NOT EXISTS "discord_role_tenure_roleId_idx"
  ON "discord_role_tenure"("roleId");
