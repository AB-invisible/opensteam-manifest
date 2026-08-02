'use client'

import React, { useState, useEffect, useRef } from 'react'
import { X, AlertTriangle, AlertCircle } from 'lucide-react'

interface Notification {
  id: string
  title?: string
  message: string
  description?: string
  type: 'warning' | 'error'
  active?: boolean
}

export function NotificationBanner() {
  const [notification, setNotification] = useState<Notification | null>(null)
  const [isVisible, setIsVisible] = useState(false)
  /** In-memory only — dismissed until full page reload, not localStorage. */
  const dismissedIdRef = useRef<string | null>(null)

  useEffect(() => {
    async function fetchActive() {
      try {
        const res = await fetch('/api/notifications/active')
        const data = await res.json()

        if (!data.success || !data.notification) {
          dismissedIdRef.current = null
          setNotification(null)
          setIsVisible(false)
          return
        }

        const active: Notification = data.notification
        if (active.id === dismissedIdRef.current) {
          setNotification(null)
          setIsVisible(false)
          return
        }

        setNotification(active)
        setIsVisible(true)
      } catch {
        console.error('Failed to fetch platform notifications')
      }
    }

    void fetchActive()
    const interval = setInterval(fetchActive, 5 * 60 * 1000)
    return () => clearInterval(interval)
  }, [])

  const handleDismiss = () => {
    if (!notification) return
    dismissedIdRef.current = notification.id
    setIsVisible(false)
    setNotification(null)
  }

  if (!isVisible || !notification) return null

  const isError = notification.type === 'error'
  const icon = isError ? <AlertCircle className="w-5 h-5" /> : <AlertTriangle className="w-5 h-5" />

  return (
    <div className="relative w-full z-[100] animate-in fade-in slide-in-from-top duration-300">
      <div className={`${isError ? 'bg-red-500/90' : 'bg-amber-500/90'} backdrop-blur-md text-white shadow-xl border-b border-white/10`}>
        <div className="max-w-7xl mx-auto px-4 py-3 sm:px-6 lg:px-8 flex items-center justify-between min-h-[50px] gap-4">
          <div className="flex items-center flex-1">
            <span className="flex p-2 rounded-xl bg-black/20 mr-4 shadow-inner">
              {icon}
            </span>
            <div className="flex flex-col sm:flex-row sm:items-center sm:space-x-4">
              <p className="font-bold text-sm tracking-tight leading-none flex flex-col gap-1">
                {notification.title && (
                  <span className="text-[10px] uppercase tracking-widest text-white/60 mb-1">{notification.title}</span>
                )}
                <span className="md:hidden">
                  {notification.message.length > 50 ? notification.message.substring(0, 47) + '...' : notification.message}
                </span>
                <span className="hidden md:inline">{notification.message}</span>
              </p>
              <a
                href="/incidents"
                className="text-[10px] font-black uppercase tracking-widest bg-white/20 hover:bg-white/30 px-3 py-1 rounded-full transition-all mt-1 sm:mt-0 w-fit"
              >
                Incident History
              </a>
            </div>
          </div>

          <div className="flex-shrink-0 flex items-center space-x-2">
            <button
              type="button"
              onClick={handleDismiss}
              className="p-2 rounded-xl bg-black/10 hover:bg-black/20 focus:outline-none transition-all"
              title="Dismiss"
              aria-label="Dismiss notification"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
