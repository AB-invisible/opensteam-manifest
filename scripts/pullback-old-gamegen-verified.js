#!/usr/bin/env node
/**
 * Pull verified GameGen members into the OpenSteam Discord server using saved OAuth tokens.
 *
 * Requires the OLD GameGen Discord application (same client id/secret/bot that issued verify tokens).
 * Invite that bot to the target guild before running.
 *
 * Usage:
 *   OLD_DATABASE_URL="postgresql://..." ^
 *   OLD_DISCORD_CLIENT_ID="1476887293825515553" ^
 *   OLD_DISCORD_CLIENT_SECRET="..." ^
 *   OLD_DISCORD_BOT_TOKEN="..." ^
 *   TARGET_GUILD_ID="1532893645231886366" ^
 *   node scripts/pullback-old-gamegen-verified.js
 *
 * Options:
 *   --dry-run          List candidates only
 *   --import           Also upsert users into the current OpenSteam DATABASE_URL (no tokens)
 *   --limit=50         Max users to process
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const { PrismaClient } = require('@prisma/client');
const { runDiscordPullback } = require('./lib/discord-oauth-tokens');

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const doImport = args.includes('--import');
const limitArg = args.find((a) => a.startsWith('--limit='));
const limit = limitArg ? Math.max(1, Number.parseInt(limitArg.split('=')[1], 10) || 0) : null;

const OLD_DATABASE_URL = process.env.OLD_DATABASE_URL?.trim();
const TARGET_GUILD_ID =
  process.env.TARGET_GUILD_ID?.trim() ||
  process.env.DISCORD_GUILD_ID?.trim() ||
  '1532893645231886366';

const OLD_CREDENTIALS = {
  clientId: process.env.OLD_DISCORD_CLIENT_ID?.trim() || process.env.DISCORD_CLIENT_ID?.trim(),
  clientSecret:
    process.env.OLD_DISCORD_CLIENT_SECRET?.trim() || process.env.DISCORD_CLIENT_SECRET?.trim(),
};

const OLD_BOT_TOKEN =
  process.env.OLD_DISCORD_BOT_TOKEN?.trim() || process.env.DISCORD_BOT_TOKEN?.trim();

function createOldPrisma() {
  return new PrismaClient({
    datasources: { db: { url: OLD_DATABASE_URL } },
  });
}

async function fetchOldVerifiedUsers(oldPrisma) {
  return oldPrisma.user.findMany({
    where: {
      discordVerifiedAt: { not: null },
      isBanned: false,
      OR: [{ discordAccessToken: { not: null } }, { discordRefreshToken: { not: null } }],
    },
    select: {
      id: true,
      discordId: true,
      username: true,
      discriminator: true,
      avatar: true,
      discordVerifiedAt: true,
      discordAccessToken: true,
      discordRefreshToken: true,
    },
    orderBy: { discordVerifiedAt: 'desc' },
    ...(limit ? { take: limit } : {}),
  });
}

async function importUsersToOpenSteam(rows) {
  const prisma = new PrismaClient();
  let imported = 0;
  let updated = 0;

  try {
    for (const row of rows) {
      const existing = await prisma.user.findUnique({
        where: { discordId: String(row.discordId) },
        select: { id: true },
      });

      const data = {
        username: row.username || 'member',
        discriminator: row.discriminator || '0',
        avatar: row.avatar || null,
        discordVerifiedAt: row.discordVerifiedAt || null,
        discordMemberStatus: 'active',
      };

      if (existing) {
        await prisma.user.update({ where: { id: existing.id }, data });
        updated += 1;
      } else {
        await prisma.user.create({
          data: {
            discordId: String(row.discordId),
            ...data,
          },
        });
        imported += 1;
      }
    }
  } finally {
    await prisma.$disconnect();
  }

  return { imported, updated };
}

async function main() {
  if (!OLD_DATABASE_URL) {
    console.error('Missing OLD_DATABASE_URL — point this at the old GameGen Postgres database.');
    process.exit(1);
  }
  if (!OLD_CREDENTIALS.clientId || !OLD_CREDENTIALS.clientSecret) {
    console.error('Missing OLD_DISCORD_CLIENT_ID / OLD_DISCORD_CLIENT_SECRET.');
    process.exit(1);
  }
  if (!OLD_BOT_TOKEN) {
    console.error('Missing OLD_DISCORD_BOT_TOKEN (must be the bot for the old GameGen OAuth app).');
    process.exit(1);
  }

  const oldPrisma = createOldPrisma();

  try {
    const users = await fetchOldVerifiedUsers(oldPrisma);
    console.log(`Found ${users.length} verified GameGen user(s) with OAuth tokens.`);
    console.log(`Target guild: ${TARGET_GUILD_ID}`);

    if (users.length === 0) {
      console.log('Nothing to do.');
      return;
    }

    if (dryRun) {
      for (const u of users.slice(0, 20)) {
        console.log(`- ${u.username} (${u.discordId}) verified ${u.discordVerifiedAt?.toISOString?.() || u.discordVerifiedAt}`);
      }
      if (users.length > 20) console.log(`… and ${users.length - 20} more`);
      return;
    }

    if (doImport) {
      const stats = await importUsersToOpenSteam(users);
      console.log(
        `Imported ${stats.imported}, updated ${stats.updated} in OpenSteam DB (profiles only, no tokens).`,
      );
    }

    console.log('Starting guild pullback…');
    const result = await runDiscordPullback(oldPrisma, {
      users,
      guildId: TARGET_GUILD_ID,
      botToken: OLD_BOT_TOKEN,
      credentials: OLD_CREDENTIALS,
    });

    if (!result.ok) {
      console.error('Pullback failed:', result.error);
      process.exit(1);
    }

    console.log('Pullback complete:');
    console.log(`  Total processed: ${result.total}`);
    console.log(`  Newly joined:    ${result.joined}`);
    console.log(`  Already member:  ${result.alreadyMember}`);
    console.log(`  Expired/no token:${result.expired}`);
    console.log(`  Other failures:  ${result.failed}`);
    if (result.failureSamples?.length) {
      console.log('  Sample failures:');
      for (const line of result.failureSamples) console.log(`    - ${line}`);
    }
  } finally {
    await oldPrisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
