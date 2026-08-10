-- AlterTable
ALTER TABLE "online_fix_games" ADD COLUMN IF NOT EXISTS "imageUrl" TEXT;
ALTER TABLE "online_fix_games" ADD COLUMN IF NOT EXISTS "sourceUrl" TEXT;
ALTER TABLE "online_fix_games" ADD COLUMN IF NOT EXISTS "steamAppId" INTEGER;
