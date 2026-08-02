'use client'

import { SessionProvider } from 'next-auth/react'
import { ToastProvider } from './components/Toast'
import { SentinelProvider } from './components/SentinelProvider'
import { NetworkStatusProvider } from './components/NetworkStatusProvider'
import { AuthNotificationHandler } from './components/AuthNotificationHandler'

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider refetchInterval={60} refetchOnWindowFocus={false}>
      <SentinelProvider>
        <ToastProvider>
          <NetworkStatusProvider>
            <AuthNotificationHandler>
              {children}
            </AuthNotificationHandler>
          </NetworkStatusProvider>
        </ToastProvider>
      </SentinelProvider>
    </SessionProvider>
  )
}
