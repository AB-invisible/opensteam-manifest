

ALTER TYPE "TrialTestStatus" ADD VALUE IF NOT EXISTS 'AWAITING_STAFF';

ALTER TABLE "trial_tests" ADD COLUMN IF NOT EXISTS "examKind" TEXT NOT NULL DEFAULT 'legacy';
UPDATE "trial_tests" SET "examKind" = 'legacy' WHERE "examKind" IS NULL OR "examKind" = '';
ALTER TABLE "trial_tests" ADD COLUMN IF NOT EXISTS "sessionState" TEXT;
ALTER TABLE "trial_tests" ADD COLUMN IF NOT EXISTS "pausedAt" TIMESTAMP(3);
ALTER TABLE "trial_tests" ADD COLUMN IF NOT EXISTS "lastPauseReason" TEXT;
ALTER TABLE "trial_tests" ADD COLUMN IF NOT EXISTS "aiGrade" JSONB;
ALTER TABLE "trial_tests" ADD COLUMN IF NOT EXISTS "regradeRequestedAt" TIMESTAMP(3);
ALTER TABLE "trial_tests" ADD COLUMN IF NOT EXISTS "reviewedByUserId" TEXT;

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "trialModEndsAt" TIMESTAMP(3);
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "modTestReadyAt" TIMESTAMP(3);

DO $$ BEGIN
  ALTER TABLE "trial_tests" ADD CONSTRAINT "trial_tests_reviewedByUserId_fkey"
    FOREIGN KEY ("reviewedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "trial_tests_reviewedByUserId_idx" ON "trial_tests"("reviewedByUserId");

DROP TABLE IF EXISTS "mod_attempts" CASCADE;
DROP TABLE IF EXISTS "mod_assessments" CASCADE;
