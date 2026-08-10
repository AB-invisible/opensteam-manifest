#!/usr/bin/env node
/** One-shot: align api_keys.rateLimit with each owner's current plan hourly cap. */
require('dotenv').config()
if (process.env.NEON_DATABASE_URL) process.env.DATABASE_URL = process.env.NEON_DATABASE_URL

const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

const PLAN_HOURLY = {
  FREE: 15,
  REGULAR: 500,
  PREMIUM: 5000,
  RESELLER: 20000,
  BUSINESS: 20000,
  CUSTOM: 20000,
}

async function main() {
  const keys = await prisma.apiKey.findMany({
    where: { enabled: true },
    select: { id: true, rateLimit: true, user: { select: { plan: true, username: true } } },
  })

  let updated = 0
  for (const key of keys) {
    const target = PLAN_HOURLY[key.user.plan] ?? 15
    if (key.rateLimit >= target) continue
    await prisma.apiKey.update({ where: { id: key.id }, data: { rateLimit: target } })
    updated++
    console.log(`healed ${key.user.username}: ${key.rateLimit} → ${target}`)
  }
  console.log(`Done. Updated ${updated}/${keys.length} keys.`)
}

main().catch(console.error).finally(() => prisma.$disconnect())
