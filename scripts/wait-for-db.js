const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function waitForDb(retries = 30, interval = 5000) {
  for (let i = 0; i < retries; i++) {
    try {
      await prisma.$connect();
      console.log('Successfully connected to the database.');
      await prisma.$disconnect();
      process.exit(0);
    } catch (error) {
      console.log(`Database not ready yet (attempt ${i + 1}/${retries}). Renrying in ${interval/1000}s...`);
      if (i === retries - 1) {
        console.error('Max retries reached. Database is still not reachable. Continuing anyway...');
        console.error(error);
        process.exit(0); // Non-fatal — Next.js has its own DB retry logic
      }
      await new Promise(resolve => setTimeout(resolve, interval));
    }
  }
}

waitForDb();
