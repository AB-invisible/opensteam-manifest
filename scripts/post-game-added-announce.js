#!/usr/bin/env node
/** Post a game-added embed for a manifest (backfill / test). */
require('dotenv').config()
if (process.env.NEON_DATABASE_URL) process.env.DATABASE_URL = process.env.NEON_DATABASE_URL

const appId = (process.argv[2] || '').trim()
if (!/^\d+$/.test(appId)) {
  console.error('Usage: node scripts/post-game-added-announce.js <steam-app-id>')
  process.exit(1)
}

const { PrismaClient } = require('@prisma/client')
const { announceGameAddedViaRest } = require('./lib/discord-game-added')
const prisma = new PrismaClient()

async function main() {
  const manifest = await prisma.manifest.findUnique({
    where: { steamAppId: appId },
    select: { name: true, steamAppId: true },
  })

  const result = await announceGameAddedViaRest(prisma, {
    appId,
    gameName: manifest?.name || `App ${appId}`,
  })
  console.log(result)
}

main().catch(console.error).finally(() => prisma.$disconnect())
