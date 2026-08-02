const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  try {
    const user = await prisma.user.update({
      where: { discordId: '1203636286834081852' },
      data: { 
        role: 'ADMIN', 
        plan: 'RESELLER' 
      }
    });
    console.log('Successfully updated the user:');
    console.log(`- Username: ${user.username}`);
    console.log(`- Role: ${user.role}`);
    console.log(`- Plan: ${user.plan}`);
  } catch (error) {
    if (error.code === 'P2025') {
      console.error('Error: User with that Discord ID was not found in the database. Are you sure you have logged in yet?');
    } else {
      console.error('An error occurred:', error);
    }
  }
}

main()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
