-- Device pairing for OpenSteam Desktop App (Discord /key pair flow)
CREATE TABLE "device_pairings" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "machineId" TEXT NOT NULL,
    "os" TEXT,
    "appVersion" TEXT,
    "apiKeyId" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "device_pairings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "device_pairings_code_key" ON "device_pairings"("code");
CREATE INDEX "device_pairings_machineId_idx" ON "device_pairings"("machineId");
CREATE INDEX "device_pairings_expiresAt_idx" ON "device_pairings"("expiresAt");

-- ApiKey desktop binding columns (if not already present from db push)
ALTER TABLE "api_keys" ADD COLUMN IF NOT EXISTS "machineId" TEXT;
ALTER TABLE "api_keys" ADD COLUMN IF NOT EXISTS "createdVia" TEXT NOT NULL DEFAULT 'WEB';
CREATE INDEX IF NOT EXISTS "api_keys_machineId_idx" ON "api_keys"("machineId");
CREATE UNIQUE INDEX IF NOT EXISTS "api_keys_userId_machineId_key" ON "api_keys"("userId", "machineId");
