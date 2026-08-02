'use client'

import { useEffect, useState } from 'react'

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

const FALLBACK: SiteSettings = {
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

export function useSiteSettings() {
  const [settings, setSettings] = useState<SiteSettings>(FALLBACK)

  useEffect(() => {
    fetch('/api/public/site-settings', { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : FALLBACK))
      .then((data) => setSettings({ ...FALLBACK, ...data }))
      .catch(() => setSettings(FALLBACK))
  }, [])

  useEffect(() => {
    document.documentElement.style.setProperty('--brand-accent', settings.accentColor)
    document.documentElement.style.setProperty('--brand-secondary', settings.secondaryColor)
  }, [settings.accentColor, settings.secondaryColor])

  return settings
}
