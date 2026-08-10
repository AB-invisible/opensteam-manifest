#!/usr/bin/env node
/** Set DISCORD_ADDED_GAMES_CHANNEL_ID in system_configs (overrides env on the bot). */
require('dotenv').config()
if (process.env.NEON_DATABASE_URL) process.env.DATABASE_URL = process.env.NEON_DATABASE_URL

const channelId = (process.argv[2] || '').trim()
if (!/^\d{17,20}$/.test(channelId)) {
  console.error('Usage: node scripts/set-added-games-channel.js <discord-channel-id>')
  process.exit(1)
}

const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

async function main() {
  await prisma.systemConfig.upsert({
    where: { key: 'DISCORD_ADDED_GAMES_CHANNEL_ID' },
    update: { value: channelId, isSecret: false },
    create: { key: 'DISCORD_ADDED_GAMES_CHANNEL_ID', value: channelId, isSecret: false },
  })
  console.log(`Added games channel set to ${channelId}`)
}

main().catch(console.error).finally(() => prisma.$disconnect())
