#!/usr/bin/env node
/**
 * Zip a Wispbyte-ready bot bundle (no Next.js, no node_modules).
 * Output: dist/wispbyte-opensteam-bot.zip
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'dist');
const ZIP = path.join(OUT_DIR, 'wispbyte-opensteam-bot.zip');
const STAGE = path.join(OUT_DIR, 'wispbyte-stage');

function rimraf(dir) {
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
}

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(from, to);
    else fs.copyFileSync(from, to);
  }
}

function copyIfExists(src, dest) {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

rimraf(STAGE);
fs.mkdirSync(STAGE, { recursive: true });

copyDir(path.join(ROOT, 'scripts'), path.join(STAGE, 'scripts'));
copyDir(path.join(ROOT, 'prisma'), path.join(STAGE, 'prisma'));

const dataDir = path.join(STAGE, 'data');
fs.mkdirSync(dataDir, { recursive: true });
copyIfExists(path.join(ROOT, 'data', 'site-settings.json'), path.join(dataDir, 'site-settings.json'));

fs.copyFileSync(path.join(ROOT, 'package.wispbyte.json'), path.join(STAGE, 'package.json'));
fs.copyFileSync(path.join(ROOT, 'index.wispbyte.js'), path.join(STAGE, 'index.js'));

const envExample = `# Paste these in Wispbyte → Startup → Environment variables
# (Also generated: dist/wispbyte-env.txt from your .env)

DATABASE_URL=<your-neon-url>
DISCORD_BOT_TOKEN=
DISCORD_CLIENT_ID=
DISCORD_CLIENT_SECRET=
DISCORD_GUILD_ID=
ADMIN_API_KEY=
NEXT_PUBLIC_APP_URL=https://opensteam.lol
MANIFEST_UPLOAD_BASE_URL=https://opensteam.lol
INTERNAL_APP_URL=https://opensteam.lol
NODE_ENV=production
NODE_OPTIONS=--use-system-ca
SKIP_ENSURE_BOT=1
`;
fs.writeFileSync(path.join(STAGE, 'WISPBYTE-ENV.txt'), envExample, 'utf8');

fs.writeFileSync(
  path.join(STAGE, 'README-WISPBYTE.txt'),
  `OpenSteam bot bundle for Wispbyte
===========================

1. Upload ALL files in this zip to your Wispbyte server file manager.
2. In Startup settings:
   - Docker image: Node.js **20** or **22** (NOT Node 19)
   - Either set JS_FILE=index.js  (default egg runs node index.js)
   - Or set startup command to: npm start
3. Copy env vars from WISPBYTE-ENV.txt / dist/wispbyte-env.txt into Startup → Environment variables.
4. Stop your local bot: pm2 stop manifest-bot
5. First start: npm install takes 2–4 minutes — wait before restarting.

Docs: docs/WISPBYTE.md
Log in at wispbyte.com/client every 2 weeks to keep the free server active.
`,
  'utf8',
);

rimraf(ZIP);
fs.mkdirSync(OUT_DIR, { recursive: true });

if (process.platform === 'win32') {
  execSync(
    `powershell -NoProfile -Command "Compress-Archive -Path '${STAGE}\\*' -DestinationPath '${ZIP}' -Force"`,
    { stdio: 'inherit' },
  );
} else {
  execSync(`cd "${STAGE}" && zip -r "${ZIP}" .`, { stdio: 'inherit' });
}

rimraf(STAGE);
console.log('Created', ZIP);
