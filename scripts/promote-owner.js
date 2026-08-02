require('dotenv').config()
const { PrismaClient } = require('@prisma/client')

const DISCORD_ID = process.argv[2] || process.env.OWNER_DISCORD_ID || '763912131153887264'

async function main() {
  const prisma = new PrismaClient()
  try {
    const user = await prisma.user.update({
      where: { discordId: DISCORD_ID },
      data: {
        role: 'OWNER',
        roleLevel: 150,
        plan: 'CUSTOM',
        avatar: 'e540d187cded514dd44319b946b1224f',
        securityBypass: true,
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
