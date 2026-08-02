'use client'

import { useEffect, useRef } from 'react'

const SDK_URL = 'https://secure.pandabase.io/v2/sdk.js'

type CheckoutMode = 'modal' | 'drawer' | 'overlay' | 'inline'

interface PandabaseCheckoutInstance {
  open: () => void
  close: () => void
  destroy: () => void
}

interface PandabaseCheckoutOptions {
  storeId: string
  sessionId: string
  mode?: CheckoutMode
  container?: string | HTMLElement
  theme?: 'light' | 'dark' | 'auto'
  appearance?: Record<string, unknown>
  on?: {
    payment_success?: (e: { orderId?: string; returnUrl?: string }) => void
    payment_failed?: (e: { error?: string }) => void
    error?: (e: { error: unknown }) => void
    close?: () => void
  }
}

declare global {
  interface Window {
    Pandabase?: {
      checkout: (opts: PandabaseCheckoutOptions) => PandabaseCheckoutInstance
    }
  }
}

let sdkPromise: Promise<void> | null = null

function loadSdk(): Promise<void> {
  if (typeof window !== 'undefined' && window.Pandabase) return Promise.resolve()
  if (sdkPromise) return sdkPromise

  sdkPromise = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${SDK_URL}"]`)
    if (existing) {
      existing.addEventListener('load', () => resolve())
      existing.addEventListener('error', () => reject(new Error('Failed to load Pandabase SDK')))
      if (window.Pandabase) resolve()
      return
    }
    const script = document.createElement('script')
    script.src = SDK_URL
    script.async = true
    script.onload = () => resolve()
    script.onerror = () => reject(new Error('Failed to load Pandabase SDK'))
    document.head.appendChild(script)
  })

  return sdkPromise
}

export interface PandabaseCheckoutEmbedProps {
  storeId: string
  sessionId: string
  returnUrl?: string
  theme?: 'light' | 'dark' | 'auto'
  onComplete?: (orderId?: string) => void
  onError?: (error: unknown) => void
}

/**
 * Renders Pandabase's hosted checkout inline via the browser SDK.
 * Replaces the previous `@whop/checkout` embed.
 */
export function PandabaseCheckoutEmbed({
  storeId,
  sessionId,
  returnUrl,
  theme = 'dark',
  onComplete,
  onError,
}: PandabaseCheckoutEmbedProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const instanceRef = useRef<PandabaseCheckoutInstance | null>(null)

  useEffect(() => {
    let cancelled = false

    loadSdk()
      .then(() => {
        if (cancelled || !containerRef.current || !window.Pandabase) return
        instanceRef.current = window.Pandabase.checkout({
          storeId,
          sessionId,
          mode: 'inline',
          container: containerRef.current,
          theme,
          on: {
            payment_success: (e) => {
              onComplete?.(e.orderId)
              if (e.returnUrl && typeof window !== 'undefined') {
                window.location.href = e.returnUrl
              } else if (returnUrl && typeof window !== 'undefined') {
                window.location.href = returnUrl
              }
            },
            payment_failed: (e) => onError?.(e.error),
            error: (e) => onError?.(e.error),
          },
        })
      })
      .catch((err) => {
        if (!cancelled) onError?.(err)
      })

    return () => {
      cancelled = true
      instanceRef.current?.destroy()
      instanceRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storeId, sessionId])

  return <div ref={containerRef} className="w-full min-h-[420px]" />
}

export default PandabaseCheckoutEmbed
