-- Executive Officer exam: Head Moderator -> Executive Officer (200 questions, single 4h timer,
-- typing analytics + estimated CEFR / Cambridge English level).

-- New platform role granted on passing the Executive Officer exam.
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'EXECUTIVE_OFFICER';

-- Executive Officer specific state on the shared trial_tests table.
ALTER TABLE "trial_tests" ADD COLUMN IF NOT EXISTS "typingMetrics" JSONB;
ALTER TABLE "trial_tests" ADD COLUMN IF NOT EXISTS "englishLevel" TEXT;
ALTER TABLE "trial_tests" ADD COLUMN IF NOT EXISTS "englishAssessment" JSONB;
ALTER TABLE "trial_tests" ADD COLUMN IF NOT EXISTS "categoryReports" JSONB;
