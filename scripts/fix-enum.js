/**
 * fix-enum.js
 * Runs BEFORE `prisma db push` to clean up stale enum state.
 *
 * When a previous `db push` fails mid-way through an AlterEnum, Postgres
 * can be left with a temporary "Role_new" enum type. The next push then
 * chokes because the old half-finished migration is still there.
 *
 * This script:
 *  1. Drops the leftover "Role_new" type if it exists.
 *  2. Ensures every value the Prisma schema expects is present in the
 *     live "Role" enum (adds missing ones so db push never needs to drop+recreate).
 */

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  try {
    // 1. Drop any leftover temporary enum from a previously-failed migration
    await prisma.$executeRawUnsafe('DROP TYPE IF EXISTS "Role_new" CASCADE');
    console.log('[fix-enum] Cleaned up stale Role_new type (if any).');

    // 2. Make sure every expected variant exists in the live Role enum
    const expected = ['USER', 'TRIAL_MODERATOR', 'MODERATOR', 'SENIOR_MODERATOR', 'HEAD_MODERATOR', 'EXECUTIVE_OFFICER', 'ADMIN', 'OWNER'];

    const existing = await prisma.$queryRawUnsafe(`
      SELECT enumlabel::text FROM pg_enum
      WHERE enumtypid = (SELECT oid FROM pg_type WHERE typname = 'Role')
    `);
    const existingSet = new Set(existing.map(r => r.enumlabel));

    for (const val of expected) {
      if (!existingSet.has(val)) {
        await prisma.$executeRawUnsafe(`ALTER TYPE "Role" ADD VALUE IF NOT EXISTS '${val}'`);
        console.log(`[fix-enum] Added missing enum value: ${val}`);
      }
    }

    console.log('[fix-enum] Role enum is clean.');
  } catch (err) {
    // Non-fatal — let db push attempt it anyway
    console.warn('[fix-enum] Warning:', err.message);
  } finally {
    await prisma.$disconnect();
  }
}

main();
