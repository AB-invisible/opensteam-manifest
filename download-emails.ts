import { PrismaClient } from '@prisma/client'
import * as fs from 'fs'
import * as path from 'path'

const prisma = new PrismaClient()

async function main() {
  console.log('Fetching users with emails...')
  
  // Fetch users that have an email address
  const users = await prisma.user.findMany({
    where: {
      email: {
        not: null
      }
    },
    select: {
      id: true,
      username: true,
      email: true
    }
  })

  if (users.length === 0) {
    console.log('No users with emails found.')
    return
  }

  // Format as CSV
  const csvHeader = 'id,username,email\n'
  const csvRows = users.map(u => `${u.id},"${u.username.replace(/"/g, '""')}",${u.email}`).join('\n')
  
  const outputPath = path.join(__dirname, 'user-emails.csv')
  fs.writeFileSync(outputPath, csvHeader + csvRows)
  
  console.log(`Successfully exported ${users.length} emails to ${outputPath}`)
}

main()
  .catch(e => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
