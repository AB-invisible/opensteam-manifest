const { execSync } = require('child_process');
const path = require('path');

console.log('[StartWeb] Running pre-start initialization scripts...');

const scripts = [
  'wait-for-db.js',
  'fix-enum.js',
  'migrate-deploy.js',
  'sync-forge-to-disk.js',
  'ensure-bot.js',
  'ensure-hosted-bots.js',
];

for (const script of scripts) {
  const scriptPath = path.join(__dirname, script);
  console.log(`[StartWeb] Running ${script}...`);
  try {
    execSync(`node "${scriptPath}"`, { stdio: 'inherit' });
  } catch (err) {
    console.error(`[StartWeb] Error running ${script}:`, err.message);
  }
}

console.log('[StartWeb] Launching Next.js server...');
const nextBin = path.join(__dirname, '..', 'node_modules', 'next', 'dist', 'bin', 'next');
process.argv = [process.argv[0], nextBin, 'start'];
require(nextBin);
