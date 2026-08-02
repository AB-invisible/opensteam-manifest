require('dotenv').config()
const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

async function main() {
  const gradeLogs = await prisma.auditLog.findMany({
    where: { action: 'GRADE_APPLICATION' }
  })
  console.log('Grade Logs Count:', gradeLogs.length)
  console.log('Grade Logs:', JSON.stringify(gradeLogs.slice(0, 5), null, 2))
}
main().catch(console.error).finally(() => prisma.$disconnect())
