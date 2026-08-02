-- Add Forge script moderation fields
ALTER TABLE "extension_scripts" ADD COLUMN IF NOT EXISTS "moderationStatus" TEXT NOT NULL DEFAULT 'APPROVED';
ALTER TABLE "extension_scripts" ADD COLUMN IF NOT EXISTS "moderationReason" TEXT;
