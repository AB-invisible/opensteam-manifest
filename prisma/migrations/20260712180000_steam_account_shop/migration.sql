-- Drop legacy partner likes; add Steam account shop orders.

DROP TABLE IF EXISTS "partner_likes";

CREATE TYPE "SteamAccountOrderStatus" AS ENUM ('PAID', 'DELIVERING', 'DELIVERED', 'FAILED', 'REFUNDED');

CREATE TABLE "steam_account_orders" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "whopPaymentId" TEXT,
    "status" "SteamAccountOrderStatus" NOT NULL DEFAULT 'PAID',
    "deliveryPayload" JSONB,
    "deliveryError" TEXT,
    "deliveredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "steam_account_orders_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "steam_account_orders_whopPaymentId_key" ON "steam_account_orders"("whopPaymentId");
CREATE INDEX "steam_account_orders_userId_createdAt_idx" ON "steam_account_orders"("userId", "createdAt");
CREATE INDEX "steam_account_orders_productId_idx" ON "steam_account_orders"("productId");

ALTER TABLE "steam_account_orders" ADD CONSTRAINT "steam_account_orders_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
