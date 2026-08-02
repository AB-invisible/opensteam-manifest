'use client'

import { createContext, useContext, useState, useCallback, useRef, useEffect, ReactNode } from 'react'
import { CheckCircle, AlertCircle, AlertTriangle, Info, X } from 'lucide-react'

/* ─────────── Types ─────────── */
export type ToastType = 'success' | 'error' | 'warning' | 'info'

export interface Toast {
  id: string
  type: ToastType
  title: string
  message?: string
  duration?: number   // ms, default 4000; 0 = never auto-dismiss
  icon?: ReactNode
}

interface ToastCtx {
  toasts: Toast[]
  addToast: (t: Omit<Toast, 'id'>) => void
  removeToast: (id: string) => void
  /** Shorthand helpers */
  success: (title: string, message?: string) => void
  error:   (title: string, message?: string) => void
  warning: (title: string, message?: string) => void
  info:    (title: string, message?: string) => void
}

/* ─────────── Context ─────────── */
const ToastContext = createContext<ToastCtx | null>(null)

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])

  const removeToast = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id))
  }, [])

  const addToast = useCallback((t: Omit<Toast, 'id'>) => {
    const id = Math.random().toString(36).slice(2)
    setToasts(prev => [...prev, { ...t, id }])
    const dur = t.duration ?? 4000
    if (dur > 0) setTimeout(() => removeToast(id), dur)
  }, [removeToast])

  const success = useCallback((title: string, message?: string) => addToast({ type: 'success', title, message }), [addToast])
  const error   = useCallback((title: string, message?: string) => addToast({ type: 'error',   title, message }), [addToast])
  const warning = useCallback((title: string, message?: string) => addToast({ type: 'warning', title, message }), [addToast])
  const info    = useCallback((title: string, message?: string) => addToast({ type: 'info',    title, message }), [addToast])

  return (
    <ToastContext.Provider value={{ toasts, addToast, removeToast, success, error, warning, info }}>
      {children}
      <ToastContainer />
    </ToastContext.Provider>
  )
}

export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used inside ToastProvider')
  return ctx
}

/* ─────────── Visual config ─────────── */
const CONFIG: Record<ToastType, { icon: ReactNode; border: string; bg: string; title: string; bar: string }> = {
  success: {
    icon:  <CheckCircle  className="h-5 w-5 flex-shrink-0 text-emerald-400 mt-0.5" />,
    border: 'border-emerald-500/30',
    bg:     'bg-emerald-500/10',
    title:  'text-emerald-100',
    bar:    'bg-emerald-400',
  },
  error: {
    icon:  <AlertCircle   className="h-5 w-5 flex-shrink-0 text-red-400 mt-0.5" />,
    border: 'border-red-500/30',
    bg:     'bg-red-500/10',
    title:  'text-red-100',
    bar:    'bg-red-400',
  },
  warning: {
    icon:  <AlertTriangle className="h-5 w-5 flex-shrink-0 text-amber-400 mt-0.5" />,
    border: 'border-amber-500/30',
    bg:     'bg-amber-500/10',
    title:  'text-amber-100',
    bar:    'bg-amber-400',
  },
  info: {
    icon:  <Info          className="h-5 w-5 flex-shrink-0 text-indigo-400 mt-0.5" />,
    border: 'border-indigo-500/30',
    bg:     'bg-indigo-500/10',
    title:  'text-indigo-100',
    bar:    'bg-indigo-400',
  },
}

/* ─────────── Single toast item ─────────── */
function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  const [exiting, setExiting] = useState(false)
  const cfg = CONFIG[toast.type]
  const dur = toast.duration ?? 4000

  const dismiss = () => {
    setExiting(true)
    setTimeout(onDismiss, 320)
  }

  // Progress bar
  const barRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (dur <= 0 || !barRef.current) return
    const el = barRef.current
    // Animate width from 100% → 0% over `dur` ms
    el.style.transition = `width ${dur}ms linear`
    // Tiny delay so the initial 100% renders before we shrink it
    const raf = requestAnimationFrame(() => {
      requestAnimationFrame(() => { el.style.width = '0%' })
    })
    return () => cancelAnimationFrame(raf)
  }, [dur])

  return (
    <div
      role="alert"
      style={{
        animation: exiting
          ? 'toast-out 0.32s cubic-bezier(0.4,0,1,1) forwards'
          : 'toast-in  0.32s cubic-bezier(0,0,0.2,1) forwards',
      }}
      className={`
        relative overflow-hidden w-full max-w-sm rounded-2xl
        backdrop-blur-xl border shadow-2xl shadow-black/40
        ${cfg.border} ${cfg.bg}
      `}
    >
      {/* Content */}
      <div className="flex items-start gap-3 px-4 py-3.5 pr-10">
        {toast.icon ?? cfg.icon}
        <div className="flex-1 min-w-0">
          <p className={`text-sm font-semibold leading-tight ${cfg.title}`}>{toast.title}</p>
          {toast.message && (
            <p className="text-xs text-white/60 mt-1 leading-relaxed">{toast.message}</p>
          )}
        </div>
      </div>

      {/* Close button */}
      <button
        onClick={dismiss}
        className="absolute top-2.5 right-2.5 p-1 rounded-lg text-white/40 hover:text-white hover:bg-white/10 transition-colors"
        aria-label="Dismiss"
      >
        <X className="h-3.5 w-3.5" />
      </button>

      {/* Timer bar */}
      {dur > 0 && (
        <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-white/5">
          <div ref={barRef} className={`h-full ${cfg.bar} opacity-60`} style={{ width: '100%' }} />
        </div>
      )}
    </div>
  )
}

/* ─────────── Container (bottom-right stack) ─────────── */
function ToastContainer() {
  const { toasts, removeToast } = useToast()

  if (toasts.length === 0) return null

  return (
    <div
      aria-live="polite"
      className="fixed bottom-6 right-6 z-[9999] flex flex-col gap-3 items-end pointer-events-none"
    >
      {toasts.map(t => (
        <div key={t.id} className="pointer-events-auto w-full">
          <ToastItem toast={t} onDismiss={() => removeToast(t.id)} />
        </div>
      ))}
    </div>
  )
}
