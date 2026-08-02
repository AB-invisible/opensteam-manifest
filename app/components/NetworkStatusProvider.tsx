'use client'

import { useEffect, useRef } from 'react'
import { Wifi, WifiOff } from 'lucide-react'
import { useToast } from './Toast'

export function NetworkStatusProvider({ children }: { children: React.ReactNode }) {
  const { addToast } = useToast()
  const isOnlineRef = useRef(typeof navigator !== 'undefined' ? navigator.onLine : true)
  const mountedRef = useRef(false)

  useEffect(() => {
    const handleOnline = () => {
      if (!mountedRef.current) return
      if (isOnlineRef.current) return
      isOnlineRef.current = true
      addToast({
        type: 'success',
        title: 'Welcome back! You are Online.',
        duration: 5000,
        icon: <Wifi className="h-5 w-5 flex-shrink-0 text-emerald-400 mt-0.5" />,
      })
    }

    const handleOffline = () => {
      if (!mountedRef.current) return
      if (!isOnlineRef.current) return
      isOnlineRef.current = false
      addToast({
        type: 'warning',
        title: 'What Happened? You are Offline.',
        duration: 5000,
        icon: <WifiOff className="h-5 w-5 flex-shrink-0 text-amber-400 mt-0.5" />,
      })
    }

    const raf = requestAnimationFrame(() => {
      mountedRef.current = true
      isOnlineRef.current = navigator.onLine
    })

    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)

    return () => {
      cancelAnimationFrame(raf)
      mountedRef.current = false
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [addToast])

  return <>{children}</>
}
