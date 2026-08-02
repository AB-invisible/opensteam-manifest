const fs = require('fs');
const path = require('path');

const botInfoPath = path.join(require('os').homedir(), 'Desktop', 'bot info.txt');

function parseBotInfo(text) {
  const lines = text.split(/\r?\n/);
  const out = { denuvoToken: null, manifestToken: null, manifestSecret: null };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim().toLowerCase();

    if (line.includes('denuvo') && line.includes('token')) {
      for (let j = i + 1; j < lines.length; j++) {
        const candidate = lines[j].trim();
        if (/^[A-Za-z0-9_\-\.]+$/.test(candidate) && candidate.length > 30) {
          out.denuvoToken = candidate;
          break;
        }
      }
    }

    if ((line.includes('gen') || line.includes('manifest')) && line.includes('token') && !line.includes('secret')) {
      for (let j = i + 1; j < lines.length; j++) {
        const candidate = lines[j].trim();
        if (/^[A-Za-z0-9_\-\.]+$/.test(candidate) && candidate.length > 30) {
          out.manifestToken = candidate;
          break;
        }
      }
    }

    if ((line.includes('gen') || line.includes('manifest')) && line.includes('secret')) {
      for (let j = i + 1; j < lines.length; j++) {
        const candidate = lines[j].trim();
        if (candidate && !candidate.toLowerCase().includes('token') && candidate.length > 8) {
          out.manifestSecret = candidate;
          break;
        }
      }
    }
  }

  return out;
}

function clientIdFromToken(token) {
  try {
    return Buffer.from(token.split('.')[0], 'base64').toString('utf8');
  } catch {
    return null;
  }
}

function setEnvKey(envPath, key, value, quoted = false) {
  const rendered = quoted ? `${key}="${value}"` : `${key}=${value}`;
  const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
  let found = false;
  const out = lines.map((line) => {
    if (line.startsWith(`${key}=`)) {
      found = true;
      return rendered;
    }
    return line;
  });
  if (!found) out.push(rendered);
  fs.writeFileSync(envPath, out.join('\n') + '\n', 'utf8');
}

if (!fs.existsSync(botInfoPath)) {
  console.error('Desktop\\bot info.txt not found');
  process.exit(1);
}

const info = parseBotInfo(fs.readFileSync(botInfoPath, 'utf8'));
if (!info.denuvoToken || !info.manifestToken) {
  console.error('Could not parse both bot tokens from bot info.txt');
  process.exit(1);
}

const manifestClientId = clientIdFromToken(info.manifestToken);
const denuvoClientId = clientIdFromToken(info.denuvoToken);

const denuvoEnv = path.join(require('os').homedir(), 'Desktop', 'denuvo', '.env');
const manifestEnv = path.join(__dirname, '..', '.env');

setEnvKey(denuvoEnv, 'DISCORD_TOKEN', info.denuvoToken, false);
if (denuvoClientId) setEnvKey(denuvoEnv, 'CLIENT_ID', denuvoClientId, false);

setEnvKey(manifestEnv, 'DISCORD_BOT_TOKEN', info.manifestToken, true);
if (manifestClientId) setEnvKey(manifestEnv, 'DISCORD_CLIENT_ID', manifestClientId, true);
if (info.manifestSecret) {
  setEnvKey(manifestEnv, 'DISCORD_CLIENT_SECRET', info.manifestSecret, true);
}

setEnvKey(manifestEnv, 'NEXT_PUBLIC_APP_URL', 'https://opensteam.lol', true);
setEnvKey(manifestEnv, 'NEXTAUTH_URL', 'http://127.0.0.1:3000', true);
setEnvKey(manifestEnv, 'AUTH_TRUST_HOST', 'true', true);

console.log('Applied tokens from Desktop\\bot info.txt');
console.log(`  denuvo activation bot -> client ${denuvoClientId}`);
console.log(`  manifest platform bot -> client ${manifestClientId}`);

if (!info.manifestSecret) {
  console.log('');
  console.log('WARNING: gen manifest client secret missing — Discord login will NOT work.');
  console.log('Add this line to Desktop\\bot info.txt (from Discord Developer Portal):');
  console.log('');
  console.log('gen manifest client secret:');
  console.log('YOUR_SECRET_HERE');
  console.log('');
  console.log('Then rerun this script and restart: pm2 restart manifest-web --update-env');
} else {
  console.log('  manifest OAuth client secret -> applied');
}
