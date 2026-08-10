require('dotenv').config()
const { PrismaClient } = require('@prisma/client')

async function main() {
  const dbUrl = (process.env.NEON_DATABASE_URL || process.env.DATABASE_URL || '').trim()
  if (!dbUrl) throw new Error('NEON_DATABASE_URL required')
  const prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } })
  try {
    const tables = await prisma.$queryRaw`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name IN ('app_sessions', 'app_events')
    `
    console.log('tables', tables)
    const count = await prisma.appSession.count()
    console.log('appSession count', count)
  } catch (e) {
    console.error('error', e.message)
  } finally {
    await prisma.$disconnect()
  }
}

main()
