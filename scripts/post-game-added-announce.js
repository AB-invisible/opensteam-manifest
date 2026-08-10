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

  let gameName = manifest?.name || `App ${appId}`
  let imageUrl = `https://cdn.akamai.steamstatic.com/steam/apps/${appId}/header.jpg`
  let shortDescription

  try {
    const key = process.env.STEAM_API_KEY?.trim()
    const url = key
      ? `https://api.steampowered.com/ISteamApps/GetAppList/v2/?key=${key}`
      : null
    // Prefer store API detail
    const detail = await fetch(
      `https://store.steampowered.com/api/appdetails?appids=${appId}&l=en`,
    ).then((r) => r.json())
    const data = detail?.[appId]?.data
    if (data?.name) gameName = data.name
    if (data?.header_image) imageUrl = data.header_image
    if (data?.short_description) shortDescription = data.short_description
  } catch {
    /* optional */
  }

  const result = await announceGameAddedViaRest(prisma, {
    appId,
    gameName,
    imageUrl,
    shortDescription,
  })

  console.log(result)
}

main().catch(console.error).finally(() => prisma.$disconnect())
