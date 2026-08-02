#!/usr/bin/env node
/**
 * OpenSteam Discord Account Transfer CLI
 *
 * Merges all platform data from an old Discord account into a new (registered) account,
 * syncs Discord guild roles, and notifies the user via email + DM.
 *
 * TRUSTED STAFF ONLY — requires direct database access.
 *
 * Usage:
 *   node scripts/transfer-discord-account.js
 *   npm run transfer-account
 *   transfer-discord-account.bat
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { PrismaClient } = require('@prisma/client');
const { normalizeDiscordSnowflake, isValidDiscordSnowflake } = require('./lib/discord-id');
const { fetchUserPreview, transferDiscordAccount } = require('./lib/discord-account-transfer');
const { syncDiscordRolesAfterTransfer } = require('./lib/discord-role-sync');
const { notifyTransferComplete } = require('./lib/transfer-notify');

const envPath = path.join(__dirname, '../.env');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  envContent.split('\n').forEach((line) => {
    const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
    if (match) {
      const key = match[1];
      let value = match[2] || '';
      if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
      if (value.startsWith("'") && value.endsWith("'")) value = value.slice(1, -1);
      process.env[key] = value;
    }
  });
}

const prisma = new PrismaClient();

function createPrompt() {
  return readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
}

function ask(rl, question) {
  return new Promise((resolve) => {
    rl.question(question, (answer) => resolve(answer.trim()));
  });
}

function parseYesNo(input) {
  const v = String(input).trim().toLowerCase();
  if (['y', 'yes'].includes(v)) return true;
  if (['n', 'no'].includes(v)) return false;
  return null;
}

function maskId(id) {
  if (!id || id.length < 8) return id;
  return `${id.slice(0, 4)}…${id.slice(-4)}`;
}

function formatUserLine(user) {
  const tag = user.discriminator && user.discriminator !== '0'
    ? `${user.username}#${user.discriminator}`
    : user.username;
  const expiry = user.planExpiry
    ? user.planExpiry.toISOString().slice(0, 10)
    : 'none';
  const jail = user.jailLevel > 0
    ? `jail L${user.jailLevel}${user.jailUntil ? ` until ${user.jailUntil.toISOString()}` : ''}`
    : 'none';
  return [
    `  Username:     ${tag}`,
    `  Discord ID:   ${user.discordId}`,
    `  Internal ID:  ${user.id}`,
    `  Email:        ${user.email || '(none)'}`,
    `  Role:         ${user.role}`,
    `  Plan:         ${user.plan}${user.planExpiry ? ` (expires ${expiry})` : ''}`,
    `  Coins:        ${user.coins}`,
    `  Banned:       ${user.isBanned ? 'yes' : 'no'}`,
    `  Jail:         ${jail}`,
    `  API keys:     ${user._count?.apiKeys ?? 0}`,
    `  Manifests:    ${user._count?.manifests ?? 0}`,
    `  Generations:  ${user._count?.webGenerations ?? 0}`,
    `  Warns:        ${user.warnCount ?? 0} (${user.punishmentCount ?? 0} total punishments)`,
    `  Hosted bot:   ${user.hostedBotInstance ? `${user.hostedBotInstance.type}/${user.hostedBotInstance.status}` : 'none'}`,
    `  Orgs owned:   ${user._count?.ownedOrgs ?? 0}`,
  ].join('\n');
}

function hasNonTrivialData(user) {
  return (
    user.plan !== 'FREE' ||
    user.role !== 'USER' ||
    (user._count?.apiKeys ?? 0) > 0 ||
    (user._count?.manifests ?? 0) > 0 ||
    (user.coins ?? 0) > 0
  );
}

async function promptDiscordId(rl, label) {
  while (true) {
    const raw = await ask(rl, `${label}: `);
    if (!raw) {
      console.log('  (cancelled — empty input)\n');
      return null;
    }
    const normalized = normalizeDiscordSnowflake(raw);
    if (!isValidDiscordSnowflake(normalized)) {
      console.log('  Invalid Discord ID. Enter a 15–22 digit snowflake or mention (<@id>).\n');
      continue;
    }
    return normalized;
  }
}

async function main() {
  console.log('');
  console.log('========================================');
  console.log('  OpenSteam Discord Account Transfer');
  console.log('========================================');
  console.log('');
  console.log('This tool merges ALL data from an OLD Discord account');
  console.log('into a NEW account that has already logged in at gamegen.lol.');
  console.log('');

  const rl = createPrompt();

  try {
    const oldDiscordId = await promptDiscordId(rl, 'Enter OLD Discord ID');
    if (!oldDiscordId) return;

    const oldUser = await fetchUserPreview(prisma, oldDiscordId);
    if (!oldUser) {
      console.error(`\n[ERROR] Old account not found for Discord ID ${oldDiscordId}.`);
      console.error('        The user must have registered on OpenSteam at least once.\n');
      return;
    }

    console.log('\n--- Old account (source) ---');
    console.log(formatUserLine(oldUser));
    console.log('');

    const newDiscordId = await promptDiscordId(rl, 'Enter NEW Discord ID');
    if (!newDiscordId) return;

    if (newDiscordId === oldDiscordId) {
      console.error('\n[ERROR] Old and new Discord IDs are the same.\n');
      return;
    }

    const newUser = await fetchUserPreview(prisma, newDiscordId);
    if (!newUser) {
      console.error(`\n[ERROR] New account not found for Discord ID ${newDiscordId}.`);
      console.error('        The user must log in to http://127.0.0.1:3000 at least once before transfer.\n');
      return;
    }

    console.log('\n--- New account (destination) ---');
    console.log(formatUserLine(newUser));
    console.log('');

    if (hasNonTrivialData(newUser)) {
      console.log('[WARN] New account already has plan/role/data.');
      console.log('       Old account entitlements will overwrite the new account.\n');
    }

    console.log('--- Transfer summary ---');
    console.log(`  From: ${oldUser.username} (${maskId(oldDiscordId)})`);
    console.log(`  To:   ${newUser.username} (${maskId(newDiscordId)})`);
    console.log(`  Will copy: ${oldUser.plan} plan, ${oldUser.role} role, ${oldUser.coins} coins`);
    console.log(`  Will move: ${oldUser._count?.apiKeys ?? 0} keys, ${oldUser._count?.manifests ?? 0} manifests,`);
    console.log(`             ${oldUser._count?.webGenerations ?? 0} generations, ${oldUser.warnCount ?? 0} warns`);
    console.log(`  Old account will be DELETED after merge.`);
    console.log('');

    let confirmed = null;
    while (confirmed === null) {
      const answer = await ask(rl, 'Proceed with transfer? (Yes/No): ');
      confirmed = parseYesNo(answer);
      if (confirmed === null) {
        console.log('  Please enter Yes or No.\n');
      }
    }

    if (!confirmed) {
      console.log('\nTransfer cancelled. No changes were made.\n');
      return;
    }

    console.log('\n[1/3] Merging database records...');
    const wasVerified = Boolean(oldUser.discordVerifiedAt);
    const { newUser: mergedUser } = await transferDiscordAccount(
      prisma,
      oldDiscordId,
      newDiscordId
    );
    console.log('[OK]  Database merged. Old account deleted.');

    console.log('\n[2/3] Syncing Discord guild roles...');
    const roleResult = await syncDiscordRolesAfterTransfer(prisma, {
      oldDiscordId,
      newDiscordId,
      transferredUser: mergedUser,
      wasVerified,
    });

    if (roleResult.skipped) {
      console.log('[WARN] Role sync skipped.');
    } else if (roleResult.applied.length > 0) {
      console.log(`[OK]  Roles applied (${roleResult.source || 'unknown'}): ${roleResult.applied.join(', ')}`);
    } else {
      console.log('[WARN] No Discord roles were applied.');
    }
    if (roleResult.removed.length > 0) {
      console.log(`      Roles removed from old account: ${roleResult.removed.join(', ')}`);
    }
    for (const w of roleResult.warnings) {
      console.log(`[WARN] ${w}`);
    }

    console.log('\n[3/3] Sending notifications...');
    const notifyResult = await notifyTransferComplete(prisma, mergedUser, oldDiscordId);

    if (notifyResult.dm?.ok) {
      console.log('[OK]  Discord DM sent to new account.');
    } else {
      console.log(`[WARN] Discord DM failed: ${notifyResult.dm?.error || 'unknown error'}`);
    }

    if (notifyResult.email?.ok) {
      console.log(`[OK]  Email sent to ${mergedUser.email} via ${notifyResult.email.provider}.`);
    } else {
      console.log(`[WARN] Email not sent: ${notifyResult.email?.error || 'unknown error'}`);
    }

    console.log('\n========================================');
    console.log('  Transfer complete');
    console.log('========================================');
    console.log(`  Survivor: ${mergedUser.username} (${mergedUser.discordId})`);
    console.log(`  Plan:     ${mergedUser.plan}`);
    console.log(`  Role:     ${mergedUser.role}`);
    console.log(`  Coins:    ${mergedUser.coins}`);
    console.log('');
  } catch (err) {
    console.error('\n[FATAL] Transfer failed:', err.message);
    if (process.env.DEBUG) console.error(err);
    process.exitCode = 1;
  } finally {
    rl.close();
    await prisma.$disconnect();
  }
}

main();
