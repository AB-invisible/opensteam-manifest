#!/usr/bin/env node
/**
 * Post (or repost) the Discord verify panel in the configured channel.
 * Uses NEON_DATABASE_URL when set, otherwise DATABASE_URL from .env.
 */
require('dotenv').config();

const { PrismaClient } = require('@prisma/client');

const VERIFY_CHANNEL_ID = '1532910591264423988';
const APP_URL =
  process.env.NEXT_PUBLIC_APP_URL ||
  process.env.NEXTAUTH_URL ||
  'https://manifest-web-ylio.onrender.com';

async function getConfig(prisma) {
  const keys = [
    'DISCORD_VERIFY_CHANNEL_ID',
    'DISCORD_VERIFY_BANNER_URL',
    'DISCORD_VERIFY_MESSAGE_ID',
    'DISCORD_BOT_TOKEN',
  ];
  const rows = await prisma.systemConfig.findMany({ where: { key: { in: keys } } });
  const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  return {
    channelId: map.DISCORD_VERIFY_CHANNEL_ID || VERIFY_CHANNEL_ID,
    bannerUrl: map.DISCORD_VERIFY_BANNER_URL || `${APP_URL.replace(/\/$/, '')}/opensteam.png`,
    token: process.env.DISCORD_BOT_TOKEN || map.DISCORD_BOT_TOKEN,
  };
}

async function main() {
  const dbUrl = (process.env.NEON_DATABASE_URL || process.env.DATABASE_URL || '').trim();
  if (!dbUrl) throw new Error('NEON_DATABASE_URL or DATABASE_URL is required');

  const prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } });
  const cfg = await getConfig(prisma);
  if (!cfg.token) throw new Error('DISCORD_BOT_TOKEN is required');

  const body = {
    embeds: [
      {
        title: 'OpenSteam Manifests Verification',
        description:
          'To gain access to OpenSteam Manifests you need to prove you are a human by completing verification. Click the button below to get started!',
        color: 0x6366f1,
        image: { url: cfg.bannerUrl },
      },
    ],
    components: [
      {
        type: 1,
        components: [{ type: 2, style: 3, label: 'Verify', custom_id: 'verify:start' }],
      },
    ],
  };

  const res = await fetch(`https://discord.com/api/v10/channels/${cfg.channelId}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bot ${cfg.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  const text = await res.text();
  if (!res.ok) throw new Error(`Discord API ${res.status}: ${text.slice(0, 400)}`);

  const message = JSON.parse(text);
  await prisma.systemConfig.upsert({
    where: { key: 'DISCORD_VERIFY_MESSAGE_ID' },
    update: { value: message.id },
    create: { key: 'DISCORD_VERIFY_MESSAGE_ID', value: message.id, isSecret: false },
  });

  console.log(`Posted verify panel ${message.id} in channel ${cfg.channelId}`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error('[post-verify-panel]', err.message || err);
  process.exit(1);
});
