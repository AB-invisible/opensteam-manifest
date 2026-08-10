require('dotenv').config()
const { PrismaClient } = require('@prisma/client')

const DISCORD_ID = process.argv[2] || process.env.OWNER_DISCORD_ID || '763912131153887264'

async function main() {
  const dbUrl = (process.env.NEON_DATABASE_URL || process.env.DATABASE_URL || '').trim()
  if (!dbUrl) throw new Error('NEON_DATABASE_URL or DATABASE_URL is required')
  const prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } })
  try {
    const user = await prisma.user.update({
      where: { discordId: DISCORD_ID },
      data: {
        role: 'OWNER',
        roleLevel: 150,
        plan: 'CUSTOM',
        planExpiry: new Date('2099-12-31T23:59:59.000Z'),
        securityBypass: true,
        isBanned: false,
        webSessionRevokedAt: null,
        webSessionRevokeReason: null,
        discordVerifiedAt: new Date(),
        discordMemberStatus: 'active',
      },
    })
    console.log(`Promoted ${user.username} (${user.discordId}) → ${user.role} / ${user.plan}`)
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
