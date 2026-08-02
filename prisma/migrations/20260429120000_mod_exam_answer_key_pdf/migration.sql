-- Answer key snapshot for live moderator PDFs / staff tooling (derived at exam creation)
ALTER TABLE "trial_tests" ADD COLUMN IF NOT EXISTS "examAnswerKey" JSONB;
