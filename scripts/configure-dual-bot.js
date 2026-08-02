require('dotenv').config();
const fs = require('fs');
const path = require('path');

const envPath = path.join(__dirname, '..', '.env');
const desktopBotInfo = path.join(require('os').homedir(), 'Desktop', 'bot info.txt');

function readEnv() {
  const map = new Map();
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([^#=]+)="?(.*?)"?\s*$/);
    if (m) map.set(m[1], m[2]);
  }
  return map;
}

function writeEnv(map) {
  const order = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
  const seen = new Set();
  const out = [];
  for (const line of order) {
    const m = line.match(/^([^#=]+)=/);
    if (m && map.has(m[1])) {
      out.push(`${m[1]}="${map.get(m[1])}"`);
      seen.add(m[1]);
    } else {
      out.push(line);
    }
  }
  for (const [key, value] of map.entries()) {
    if (!seen.has(key)) out.push(`${key}="${value}"`);
  }
  fs.writeFileSync(envPath, out.filter((l, i, arr) => !(i === arr.length - 1 && l === '')).join('\n') + '\n', 'utf8');
}

function parseDesktopBotInfo() {
  if (!fs.existsSync(desktopBotInfo)) return null;
  const lines = fs.readFileSync(desktopBotInfo, 'utf8').split(/\r?\n/);
  const info = {};
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (/^Application ID$|^Client ID$/.test(line)) {
      for (let j = i + 1; j < Math.min(i + 6, lines.length); j++) {
        const candidate = lines[j].trim();
        if (/^\d{17,20}$/.test(candidate)) {
          info.clientId = candidate;
          break;
        }
      }
    }
    if (/^guild id\s*$/i.test(line)) {
      for (let j = i + 1; j < Math.min(i + 4, lines.length); j++) {
        const candidate = lines[j].trim();
        if (/^\d{17,20}$/.test(candidate)) {
          info.guildId = candidate;
          break;
        }
      }
    }
    if (line === 'Token') {
      for (let j = i + 1; j < lines.length; j++) {
        const candidate = lines[j].trim();
        if (/^[A-Za-z0-9_\-\.]+$/.test(candidate) && candidate.length > 30) {
          info.token = candidate;
          break;
        }
      }
    }
  }
  return info.clientId && info.token ? info : null;
}

const env = readEnv();
const desktop = parseDesktopBotInfo();

const manifestToken = env.get('DISCORD_BACKUP_BOT_TOKEN');
const manifestClientId = env.get('DISCORD_BACKUP_CLIENT_ID');
const manifestClientSecret = env.get('DISCORD_BACKUP_CLIENT_SECRET');

if (!manifestToken || !manifestClientId) {
  console.error('DISCORD_BACKUP_BOT_TOKEN / DISCORD_BACKUP_CLIENT_ID required in .env for manifest bot');
  process.exit(1);
}

env.set('DISCORD_BOT_TOKEN', manifestToken);
env.set('DISCORD_CLIENT_ID', manifestClientId);
if (manifestClientSecret) env.set('DISCORD_CLIENT_SECRET', manifestClientSecret);

if (desktop) {
  env.set('OPENSTEAM_ACTIVATION_CLIENT_ID', desktop.clientId);
  env.set('OPENSTEAM_ACTIVATION_GUILD_ID', desktop.guildId || env.get('DISCORD_GUILD_ID') || '');
  env.set('BRAND_NAME', 'OpenSteam');
  env.set('BRAND_TAGLINE', 'OpenSteam Manifests');
}

writeEnv(env);

console.log('Dual-bot config applied:');
console.log('  denuvo/OpenSteam activation bot -> Desktop bot info (primary token, separate process)');
console.log(`  manifest platform bot -> Discord app ${manifestClientId} (backup app, no token conflict)`);
