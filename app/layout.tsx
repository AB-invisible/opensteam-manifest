import './globals.css'
import { Outfit } from 'next/font/google'
import { Providers } from './providers'
import { ShadowBanner } from './components/ShadowBanner'
import { NotificationBanner } from './components/NotificationBanner'

const outfit = Outfit({ subsets: ['latin'] })

import { APP_NAME, APP_TAGLINE } from './lib/brand'

export const metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL || 'http://opensteam.lol'),
  title: `${APP_TAGLINE} | Join us and our own game DB`,
  description: 'Join the community-driven Steam manifest database. Pro-grade generation with real-time API integration and smart firewall protection.',
  keywords: ['steam', 'manifest', 'game manifests', 'steam api', 'opensteam', 'manifest generator'],
  authors: [{ name: `${APP_NAME} Team` }],
  openGraph: {
    title: `${APP_TAGLINE} | Join us and our own game DB`,
    description: 'Join the community-driven Steam manifest database. Pro-grade generation with real-time API integration.',
    url: process.env.NEXT_PUBLIC_APP_URL || 'http://opensteam.lol',
    siteName: APP_NAME,
    locale: 'en_US',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: `${APP_TAGLINE} | Join us and our own game DB`,
    description: 'Join the community-driven Steam manifest database. Pro-grade generation with real-time API integration.',
  },
  icons: {
    icon: '/opensteam.png',
    shortcut: '/opensteam.png',
    apple: '/opensteam.png',
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className="dark">
      <body className={`${outfit.className} bg-background text-foreground antialiased selection:bg-primary/30 min-h-screen flex flex-col`}>
        <NotificationBanner />
        <Providers>
          <ShadowBanner />
          {children}
        </Providers>
      </body>
    </html>
  )
}
