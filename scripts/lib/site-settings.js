const fs = require('fs');
const path = require('path');

const SETTINGS_PATH = path.join(__dirname, '..', '..', 'data', 'site-settings.json');

const DEFAULTS = {
  siteName: 'OpenSteam',
  siteUrl: 'http://opensteam.lol',
  tagline: 'Secure • Scalable • Developer-first',
  heroTitle: 'OpenSteam Manifests',
  heroSubtitle: 'Community-driven Steam manifest generation with real-time API integration.',
  desktopAppTitle: 'OpenSteam Desktop App',
  accentColor: '#22d3ee',
  secondaryColor: '#f59e0b',
  logoPath: '/opensteam.png',
  discordInvite: 'https://discord.gg/4RdMhcYws',
  telegramLink: 'https://t.me/opensteammanifest',
  footerText: '© 2026 OpenSteam Platform. Powered by OpenSteam | Manifests',
  loginUrl: 'http://opensteam.lol',
};

const ALLOWED_KEYS = Object.keys(DEFAULTS);

function ensureFile() {
  const dir = path.dirname(SETTINGS_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(SETTINGS_PATH)) {
    fs.writeFileSync(SETTINGS_PATH, JSON.stringify(DEFAULTS, null, 2) + '\n', 'utf8');
  }
}

function readSiteSettings() {
  ensureFile();
  try {
    const parsed = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8'));
    return { ...DEFAULTS, ...parsed };
  } catch {
    return { ...DEFAULTS };
  }
}

function writeSiteSettings(partial) {
  const current = readSiteSettings();
  const next = { ...current };
  for (const [key, value] of Object.entries(partial || {})) {
    if (!ALLOWED_KEYS.includes(key)) continue;
    if (value === null || value === undefined) continue;
    next[key] = String(value).trim();
  }
  ensureFile();
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(next, null, 2) + '\n', 'utf8');
  return next;
}

module.exports = {
  DEFAULTS,
  ALLOWED_KEYS,
  SETTINGS_PATH,
  readSiteSettings,
  writeSiteSettings,
};
