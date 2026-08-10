require('dotenv').config()
if (process.env.NEON_DATABASE_URL) process.env.DATABASE_URL = process.env.NEON_DATABASE_URL

const { PrismaClient } = require('@prisma/client')
const { findVerifiedAltForGeneration } = require('./lib/generation-alt-gate')

async function main() {
  const prisma = new PrismaClient()
  const ab = await prisma.user.findFirst({ where: { username: { contains: 'we.love.ab' } } })
  const alt = await findVerifiedAltForGeneration(prisma, ab)
  console.log('AB user', ab?.username, 'blocked?', alt)

  const ryx = await prisma.user.findFirst({ where: { username: 'ryx_sp00dey' } })
  const alt2 = await findVerifiedAltForGeneration(prisma, ryx)
  console.log('ryx blocked?', alt2)

  await prisma.$disconnect()
}

main().catch(console.error)
