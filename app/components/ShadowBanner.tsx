'use client'

import { useSession, signOut } from 'next-auth/react'
import { Eye, Power, AlertTriangle, RefreshCw } from 'lucide-react'
import { useState } from 'react'

export function ShadowBanner() {
  const { data: session, status, update } = useSession()
  const [exiting, setExiting] = useState(false)

  if (status !== 'authenticated' || !(session?.user as any)?.isShadowing) {
    return null
  }

  const user = session.user as any

  const stopShadowing = async () => {
    setExiting(true)
    try {
      const res = await fetch('/api/admin/shadow/stop', { method: 'POST' })
      if (res.ok) {
        // Refresh session and redirect to admin
        await update()
        window.location.href = '/admin'
      }
    } catch (error) {
      console.error('Failed to stop shadowing:', error)
      setExiting(false)
    }
  }

  return (
    <div className="fixed top-0 left-0 right-0 z-[9999] animate-in slide-in-from-top duration-500">
      <div className="bg-gradient-to-r from-amber-600 via-amber-500 to-amber-600 border-b border-amber-400/30 px-4 py-2.5 shadow-2xl flex items-center justify-between">
        <div className="flex items-center space-x-4">
          <div className="bg-black/20 p-1.5 rounded-lg border border-white/10">
            <Eye className="h-4 w-4 text-white animate-pulse" />
          </div>
          <div className="flex flex-col">
            <div className="flex items-center space-x-2">
              <span className="text-xs font-black uppercase tracking-widest text-white leading-none">Shadow Mode Active</span>
              <span className="h-1.5 w-1.5 rounded-full bg-white animate-ping" />
            </div>
            <p className="text-[10px] font-bold text-amber-950/80 leading-none mt-1">
              Currently viewing as <span className="text-white underline">{user.shadowingName || 'Target User'}</span>
            </p>
          </div>
        </div>

        <div className="flex items-center space-x-3">
          <div className="hidden sm:flex items-center space-x-2 px-3 py-1 bg-black/10 rounded-full border border-white/5 text-[9px] font-bold text-amber-950/60 uppercase tracking-tighter">
            <AlertTriangle className="h-3 w-3" />
            <span>Admin Control Active</span>
          </div>
          
          <button
            onClick={stopShadowing}
            disabled={exiting}
            className="flex items-center space-x-2 px-4 py-1.5 bg-white text-amber-600 hover:bg-amber-50 rounded-full text-xs font-black uppercase tracking-widest transition-all shadow-md active:scale-95 disabled:opacity-50"
          >
            {exiting ? (
              <RefreshCw className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Power className="h-3.5 w-3.5" />
            )}
            <span>{exiting ? 'Exiting...' : 'Exit Session'}</span>
          </button>
        </div>
      </div>
      
      {/* Visual Overlay to signify non-primary session */}
      <div className="absolute inset-x-0 bottom-[-4px] h-1 bg-gradient-to-r from-transparent via-amber-500/50 to-transparent blur-sm" />
    </div>
  )
}
