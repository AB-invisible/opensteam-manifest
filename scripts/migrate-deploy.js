/**
 * Runs `prisma migrate deploy`, baselining existing production databases that were
 * previously managed with `db push` (Prisma error P3005).
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('@prisma/client');

const MIGRATIONS_DIR = path.join(__dirname, '..', 'prisma', 'migrations');

const MIGRATION_CHECKS = [
  {
    name: '20260428220000_live_exam_on_trial_tests',
    check: (prisma) => columnExists(prisma, 'trial_tests', 'examKind'),
  },
  {
    name: '20260429120000_mod_exam_answer_key_pdf',
    check: (prisma) => columnExists(prisma, 'trial_tests', 'examAnswerKey'),
  },
  {
    name: '20260609120000_add_last_web_activity_at',
    check: (prisma) => columnExists(prisma, 'users', 'lastWebActivityAt'),
  },
  {
    name: '20260609140000_discord_verification_system',
    check: (prisma) => tableExists(prisma, 'discord_verification_sessions'),
  },
  {
    name: '20260614120000_forge_moderation_status',
    check: (prisma) => columnExists(prisma, 'extension_scripts', 'moderationStatus'),
  },
  {
    name: '20260615120000_discord_verify_intel',
    check: (prisma) => columnExists(prisma, 'users', 'discordProfileSnapshot'),
  },
  {
    name: '20260616120000_discord_guild_ban_restrictions',
    check: (prisma) => columnExists(prisma, 'users', 'discordGuildBannedAt'),
  },
  {
    name: '20260617120000_member_market_orders',
    check: (prisma) => tableExists(prisma, 'member_market_orders'),
  },
  {
    name: '20260618120000_discord_relationships_snapshot',
    check: (prisma) => columnExists(prisma, 'users', 'discordRelationshipsSnapshot'),
  },
  {
    name: '20260629120000_hosted_bot_consoles',
    check: (prisma) => tableExists(prisma, 'hosted_bot_logs'),
  },
  {
    name: '20260623130000_giveaways',
    check: (prisma) => tableExists(prisma, 'giveaways'),
  },
  {
    name: '20260623140000_giveaway_description',
    check: (prisma) => columnExists(prisma, 'giveaways', 'description'),
  },
  {
    name: '20260629130000_promotional_tests',
    check: (prisma) => tableExists(prisma, 'discord_role_tenure'),
  },
  {
    name: '20260702120000_executive_officer_exam',
    check: (prisma) => columnExists(prisma, 'trial_tests', 'typingMetrics'),
  },
  {
    name: '20260703140000_verification_blacklists',
    check: (prisma) => tableExists(prisma, 'verification_friend_blacklist'),
  },
  {
    name: '20260708180000_user_anti_phishing_code',
    check: (prisma) => columnExists(prisma, 'users', 'antiPhishingCode'),
  },
  {
    name: '20260712180000_steam_account_shop',
    check: (prisma) => tableExists(prisma, 'steam_account_orders'),
  },
  {
    name: '20260714120000_rename_whop_payment_id_to_pandabase_order_id',
    check: (prisma) => columnExists(prisma, 'steam_account_orders', 'pandabaseOrderId'),
  },
  {
    name: '20260726200000_discord_leave_suspension',
    check: (prisma) => columnExists(prisma, 'users', 'discordMemberStatus'),
  },
  {
    name: '20260810120000_device_pairing',
    check: (prisma) => tableExists(prisma, 'device_pairings'),
  },
];

function runPrisma(args) {
  const result = spawnSync('npx', ['prisma', ...args], {
    encoding: 'utf8',
    shell: true,
  });
  const output = `${result.stdout || ''}${result.stderr || ''}`;
  return { code: result.status ?? 1, output };
}

async function tableExists(prisma, tableName) {
  const rows = await prisma.$queryRaw`
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = ${tableName}
    ) AS exists
  `;
  return Boolean(rows[0]?.exists);
}

async function columnExists(prisma, tableName, columnName) {
  const rows = await prisma.$queryRaw`
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = ${tableName}
        AND column_name = ${columnName}
    ) AS exists
  `;
  return Boolean(rows[0]?.exists);
}

function listMigrations() {
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((entry) => fs.statSync(path.join(MIGRATIONS_DIR, entry)).isDirectory())
    .sort();
}

async function detectAppliedMigrations(prisma) {
  const applied = [];
  for (const migration of MIGRATION_CHECKS) {
    try {
      if (await migration.check(prisma)) {
        applied.push(migration.name);
      }
    } catch (err) {
      console.warn(`[migrate] Could not inspect ${migration.name}:`, err.message);
    }
  }
  return applied;
}

async function baselineExistingDatabase(prisma) {
  const hasUsers = await tableExists(prisma, 'users');
  if (!hasUsers) {
    console.log('[migrate] Empty or fresh database — no baseline needed.');
    return;
  }

  const hasHistory = await tableExists(prisma, '_prisma_migrations');
  if (hasHistory) {
    console.log('[migrate] Migration history already present — skipping baseline.');
    return;
  }

  console.log('[migrate] Existing schema without migration history detected (db push era). Baselining...');

  const detected = await detectAppliedMigrations(prisma);
  const migrations = listMigrations();
  const newest = '20260618120000_discord_relationships_snapshot';
  const toBaseline =
    detected.length > 0
      ? detected
      : migrations.filter((name) => name !== newest);

  if (toBaseline.length === 0) {
    console.log('[migrate] No prior schema detected to baseline.');
    return;
  }

  for (const migrationName of toBaseline) {
    console.log(`[migrate] Marking applied: ${migrationName}`);
    const { code, output } = runPrisma(['migrate', 'resolve', '--applied', migrationName]);
    if (code !== 0) {
      console.error(output);
      throw new Error(`Failed to baseline migration ${migrationName}`);
    }
  }
}

async function listFailedMigrations(prisma) {
  const rows = await prisma.$queryRaw`
    SELECT migration_name
    FROM "_prisma_migrations"
    WHERE started_at IS NOT NULL
      AND finished_at IS NULL
      AND rolled_back_at IS NULL
  `;
  return rows.map((row) => row.migration_name);
}

async function recoverFailedMigrations(prisma) {
  const failed = await listFailedMigrations(prisma);
  if (failed.length === 0) return false;

  let recovered = false;
  for (const migrationName of failed) {
    const known = MIGRATION_CHECKS.find((entry) => entry.name === migrationName);
    if (!known) {
      console.warn(`[migrate] Failed migration has no recovery rule: ${migrationName}`);
      continue;
    }

    const alreadyApplied = await known.check(prisma);
    if (alreadyApplied) {
      console.log(`[migrate] Failed migration already applied in schema — marking resolved: ${migrationName}`);
      const { code, output } = runPrisma(['migrate', 'resolve', '--applied', migrationName]);
      if (code !== 0) {
        console.error(output);
        throw new Error(`Failed to resolve migration ${migrationName} as applied`);
      }
      recovered = true;
      continue;
    }

    console.log(`[migrate] Clearing failed migration record for retry: ${migrationName}`);
    const { code, output } = runPrisma(['migrate', 'resolve', '--rolled-back', migrationName]);
    if (code !== 0) {
      console.error(output);
      throw new Error(`Failed to roll back failed migration ${migrationName}`);
    }
    recovered = true;
  }

  return recovered;
}

async function main() {
  const prisma = new PrismaClient();
  try {
    await prisma.$connect();
    await baselineExistingDatabase(prisma);
    await recoverFailedMigrations(prisma);
  } finally {
    await prisma.$disconnect();
  }

  console.log('[migrate] Running prisma migrate deploy...');
  let attempts = 0;
  while (attempts < 20) {
    attempts += 1;
    let { code, output } = runPrisma(['migrate', 'deploy']);
    console.log(output);

    if (code === 0) {
      console.log('[migrate] Database migrations are up to date.');
      return;
    }

    if (!(output.includes('P3005') || output.includes('P3009') || output.includes('P3018'))) {
      process.exit(code);
    }

    console.log('[migrate] Migration deploy blocked — retrying recovery then deploy...');
    const prismaRetry = new PrismaClient();
    try {
      await prismaRetry.$connect();
      if (output.includes('P3005')) {
        await baselineExistingDatabase(prismaRetry);
      }
      if (output.includes('P3009') || output.includes('P3018')) {
        await recoverFailedMigrations(prismaRetry);
      }
    } finally {
      await prismaRetry.$disconnect();
    }
  }

  console.error('[migrate] Gave up after repeated migration recovery attempts.');
  process.exit(1);
}

main().catch((err) => {
  console.error('[migrate] Fatal error:', err);
  process.exit(1);
});
