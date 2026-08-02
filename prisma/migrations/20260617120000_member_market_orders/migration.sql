-- CreateTable
CREATE TABLE "member_market_orders" (
    "id" TEXT NOT NULL,
    "vaultOrderId" TEXT NOT NULL,
    "reference" TEXT,
    "marketId" INTEGER NOT NULL,
    "amount" INTEGER NOT NULL,
    "costCents" INTEGER,
    "inviteCode" TEXT NOT NULL,
    "guildId" TEXT,
    "buyerEmail" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'paid',
    "sellerTitle" TEXT,
    "sellerServer" TEXT,
    "inviteUrl" TEXT,
    "orderUrl" TEXT,
    "newBalanceCents" INTEGER,
    "pulledAt" TIMESTAMP(3),
    "refundedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "member_market_orders_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "member_market_orders_vaultOrderId_key" ON "member_market_orders"("vaultOrderId");

-- CreateIndex
CREATE INDEX "member_market_orders_createdById_createdAt_idx" ON "member_market_orders"("createdById", "createdAt");

-- CreateIndex
CREATE INDEX "member_market_orders_status_createdAt_idx" ON "member_market_orders"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "member_market_orders" ADD CONSTRAINT "member_market_orders_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
