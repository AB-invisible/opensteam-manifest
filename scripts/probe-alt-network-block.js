require('dotenv').config()
if (process.env.NEON_DATABASE_URL) process.env.DATABASE_URL = process.env.NEON_DATABASE_URL

const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

async function showUser(query) {
  const users = await prisma.user.findMany({
    where: {
      OR: [
        { username: { contains: query, mode: 'insensitive' } },
        { discordId: query },
      ],
    },
    select: {
      id: true,
      username: true,
      discordId: true,
      verifyIp: true,
      lastIp: true,
      verifyFingerprint: true,
      fingerprint: true,
      discordVerifiedAt: true,
      role: true,
      email: true,
      securityBypass: true,
      createdAt: true,
    },
    take: 5,
  })
  return users
}

async function main() {
  for (const q of ['AB', 'ryx_sp00dey', 'invisible7']) {
    const users = await showUser(q)
    console.log('\n=== search:', q, '===')
    for (const u of users) {
      console.log(JSON.stringify(u, null, 2))
    }
  }

  const abUsers = await showUser('AB')
  const ab = abUsers.find((u) => u.username === 'AB' || u.username.startsWith('AB'))
  if (ab) {
    const ip = ab.verifyIp || ab.lastIp
    if (ip) {
      const sameIp = await prisma.user.findMany({
        where: {
          id: { not: ab.id },
          discordVerifiedAt: { not: null },
          OR: [{ verifyIp: ip }, { lastIp: ip }],
        },
        select: { username: true, discordId: true, verifyIp: true, lastIp: true, discordVerifiedAt: true },
      })
      console.log('\n=== verified users sharing IP with AB:', ip, '===')
      console.log(JSON.stringify(sameIp, null, 2))
    }
  }

  const cfg = await prisma.systemConfig.findMany({
    where: {
      key: {
        in: [
          'DISCORD_VERIFY_ALT_BLOCK_MODE',
          'DISCORD_VERIFY_ALT_BLOCK_FLAGS',
        ],
      },
    },
  })
  console.log('\n=== alt policy config ===')
  console.log(cfg)
}

main().catch(console.error).finally(() => prisma.$disconnect())
