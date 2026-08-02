/**
 * Production start for cloud VMs (no Ollama, no Windows PM2 bot spawn).
 * Web container only — bot runs as a separate compose service.
 */
const { execSync } = require('child_process');
const path = require('path');

console.log('[StartCloud] Running pre-start initialization...');

const scripts = ['wait-for-db.js', 'fix-enum.js', 'migrate-deploy.js', 'sync-forge-to-disk.js'];

for (const script of scripts) {
  const scriptPath = path.join(__dirname, script);
  console.log(`[StartCloud] Running ${script}...`);
  try {
    execSync(`node "${scriptPath}"`, { stdio: 'inherit' });
  } catch (err) {
    console.error(`[StartCloud] Error running ${script}:`, err.message);
    process.exit(1);
  }
}

console.log('[StartCloud] Launching Next.js server...');
const nextBin = path.join(__dirname, '..', 'node_modules', 'next', 'dist', 'bin', 'next');
process.argv = [process.argv[0], nextBin, 'start'];
require(nextBin);
