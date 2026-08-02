import fs from 'fs'
import path from 'path'

export type SiteSettings = {
  siteName: string
  siteUrl: string
  publicAccessUrl?: string
  tagline: string
  heroTitle: string
  heroSubtitle: string
  desktopAppTitle: string
  desktopInstallCommand: string
  accentColor: string
  secondaryColor: string
  logoPath: string
  discordInvite: string
  telegramLink: string
  footerText: string
}

const DEFAULTS: SiteSettings = {
  siteName: 'OpenSteam',
  siteUrl: 'https://opensteam.lol',
  tagline: 'Secure • Scalable • Developer-first',
  heroTitle: 'OpenSteam Manifests',
  heroSubtitle: 'Community-driven Steam manifest generation with real-time API integration.',
  desktopAppTitle: 'OpenSteam Desktop App',
  desktopInstallCommand:
    'irm https://raw.githubusercontent.com/AB-invisible/opensteam-app/main/download.ps1 | iex',
  accentColor: '#22d3ee',
  secondaryColor: '#f59e0b',
  logoPath: '/opensteam.png',
  discordInvite: 'https://discord.gg/4RdMhcYws',
  telegramLink: 'https://t.me/opensteammanifest',
  footerText: '© 2026 OpenSteam Platform. Powered by OpenSteam | Manifests',
}

function settingsPath() {
  return path.join(process.cwd(), 'data', 'site-settings.json')
}

export function readSiteSettings(): SiteSettings {
  const file = settingsPath()
  try {
    if (!fs.existsSync(file)) return { ...DEFAULTS }
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'))
    return { ...DEFAULTS, ...parsed }
  } catch {
    return { ...DEFAULTS }
  }
}

export function writeSiteSettings(partial: Partial<SiteSettings>): SiteSettings {
  const current = readSiteSettings()
  const next = { ...current, ...partial }
  const dir = path.dirname(settingsPath())
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(settingsPath(), JSON.stringify(next, null, 2) + '\n', 'utf8')
  return next
}

export { DEFAULTS as SITE_SETTINGS_DEFAULTS }
