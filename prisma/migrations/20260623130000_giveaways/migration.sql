CREATE TABLE "giveaways" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "messageId" TEXT,
    "statusMessageId" TEXT,
    "createdByDiscordId" TEXT NOT NULL,
    "createdByUserId" TEXT,
    "prize" TEXT NOT NULL,
    "prizeType" TEXT NOT NULL DEFAULT 'CUSTOM',
    "plan" "Plan",
    "planDurationDays" INTEGER,
    "winnerCount" INTEGER NOT NULL,
    "rewardText" TEXT,
    "separatePrizes" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "endsAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),
    "claimDeadlineAt" TIMESTAMP(3),
    "claimWindowHours" INTEGER NOT NULL DEFAULT 12,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "giveaways_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "giveaway_entries" (
    "id" TEXT NOT NULL,
    "giveawayId" TEXT NOT NULL,
    "discordId" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "giveaway_entries_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "giveaway_winners" (
    "id" TEXT NOT NULL,
    "giveawayId" TEXT NOT NULL,
    "discordId" TEXT NOT NULL,
    "username" TEXT,
    "prizeIndex" INTEGER NOT NULL,
    "prizeText" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "selectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "claimedAt" TIMESTAMP(3),
    "rerolledAt" TIMESTAMP(3),
    "dmMessageId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "giveaway_winners_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "giveaways_messageId_key" ON "giveaways"("messageId");
CREATE INDEX "giveaways_guildId_channelId_idx" ON "giveaways"("guildId", "channelId");
CREATE INDEX "giveaways_status_endsAt_idx" ON "giveaways"("status", "endsAt");
CREATE INDEX "giveaways_status_claimDeadlineAt_idx" ON "giveaways"("status", "claimDeadlineAt");

CREATE UNIQUE INDEX "giveaway_entries_giveawayId_discordId_key" ON "giveaway_entries"("giveawayId", "discordId");
CREATE INDEX "giveaway_entries_discordId_idx" ON "giveaway_entries"("discordId");

CREATE UNIQUE INDEX "giveaway_winners_giveawayId_discordId_key" ON "giveaway_winners"("giveawayId", "discordId");
CREATE INDEX "giveaway_winners_giveawayId_status_idx" ON "giveaway_winners"("giveawayId", "status");
CREATE INDEX "giveaway_winners_status_selectedAt_idx" ON "giveaway_winners"("status", "selectedAt");

ALTER TABLE "giveaway_entries" ADD CONSTRAINT "giveaway_entries_giveawayId_fkey"
    FOREIGN KEY ("giveawayId") REFERENCES "giveaways"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "giveaway_winners" ADD CONSTRAINT "giveaway_winners_giveawayId_fkey"
    FOREIGN KEY ("giveawayId") REFERENCES "giveaways"("id") ON DELETE CASCADE ON UPDATE CASCADE;
