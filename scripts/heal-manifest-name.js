require('dotenv').config()
if (process.env.NEON_DATABASE_URL) process.env.DATABASE_URL = process.env.NEON_DATABASE_URL
const { PrismaClient } = require('@prisma/client')
const { resolveSteamStoreMeta } = require('./lib/steam-store-meta')
const prisma = new PrismaClient()

async function main() {
  const appId = process.argv[2] || '1067360'
  const meta = await resolveSteamStoreMeta(appId)
  console.log(meta)
  if (meta?.gameName || meta?.imageUrl) {
    await prisma.manifest.update({
      where: { steamAppId: String(appId) },
      data: {
        ...(meta.gameName ? { name: meta.gameName } : {}),
        ...(meta.imageUrl ? { imageUrl: meta.imageUrl } : {}),
        ...(meta.shortDescription ? { description: meta.shortDescription } : {}),
      },
    })
    console.log('Updated manifest metadata for', appId)
  }
}

main().catch(console.error).finally(() => prisma.$disconnect())
