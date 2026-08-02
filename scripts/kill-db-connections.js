/**
 * kill-db-connections.js
 *
 * Terminates ALL active PostgreSQL connections (except this script's own).
 * Run this before `npx next build` to free the connection pool when PM2
 * processes have leaked stale connections.
 *
 * Usage:  node scripts/kill-db-connections.js
 */

const path = require('path');
const fs = require('fs');

// Load .env manually (same pattern as bot-daemon.js)
const envPath = path.join(__dirname, '../.env');
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
    const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
    if (match) {
      let value = (match[2] || '').trim();
      if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
      if (!process.env[match[1]]) process.env[match[1]] = value;
    }
  });
}

const { PrismaClient } = require('@prisma/client');

async function main() {
  const prisma = new PrismaClient();

  try {
    console.log('Connecting to database...');

    // Get current DB name and running connections
    const before = await prisma.$queryRaw`
      SELECT count(*) AS total FROM pg_stat_activity WHERE pid <> pg_backend_pid()
    `;
    console.log(`Active connections before: ${before[0].total}`);

    // Terminate every connection except this one
    const result = await prisma.$queryRaw`
      SELECT pg_terminate_backend(pid), pid, usename, application_name, state
      FROM pg_stat_activity
      WHERE pid <> pg_backend_pid()
        AND state IS NOT NULL
    `;

    console.log(`Terminated ${result.length} connection(s):`);
    result.forEach(r => {
      console.log(`  pid=${r.pid}  user=${r.usename}  app=${r.application_name}  state=${r.state}`);
    });

    const after = await prisma.$queryRaw`
      SELECT count(*) AS total FROM pg_stat_activity WHERE pid <> pg_backend_pid()
    `;
    console.log(`Active connections after: ${after[0].total}`);
    console.log('Done. You can now run: npx next build');
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
