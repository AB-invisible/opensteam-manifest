-- AlterTable
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "antiPhishingCode" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "antiPhishingIntroSeenAt" TIMESTAMP(3);

CREATE UNIQUE INDEX IF NOT EXISTS "users_antiPhishingCode_key" ON "users"("antiPhishingCode");
