-- Verification friend/guild blacklists for blocking verify until connections are removed

CREATE TABLE "verification_friend_blacklist" (
    "id" TEXT NOT NULL,
    "discordId" TEXT NOT NULL,
    "label" TEXT,
    "reason" TEXT NOT NULL,
    "addedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "verification_friend_blacklist_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "verification_friend_blacklist_discordId_key" ON "verification_friend_blacklist"("discordId");
CREATE INDEX "verification_friend_blacklist_discordId_idx" ON "verification_friend_blacklist"("discordId");

CREATE TABLE "verification_guild_blacklist" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "guildName" TEXT,
    "reason" TEXT NOT NULL,
    "addedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "verification_guild_blacklist_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "verification_guild_blacklist_guildId_key" ON "verification_guild_blacklist"("guildId");
CREATE INDEX "verification_guild_blacklist_guildId_idx" ON "verification_guild_blacklist"("guildId");
