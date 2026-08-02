'use client'

import { useEffect, useState } from 'react'
import { ShieldCheck, X } from 'lucide-react'

const LOCAL_STORAGE_KEY = 'gamegen_seen_antiphishing_v1'

export function AntiPhishingModal() {
  const [open, setOpen] = useState(false)
  const [code, setCode] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false

    async function load() {
      if (typeof window === 'undefined') return
      if (localStorage.getItem(LOCAL_STORAGE_KEY) === 'true') {
        setLoading(false)
        return
      }

      try {
        const res = await fetch('/api/user/anti-phishing')
        if (!res.ok) {
          setLoading(false)
          return
        }

        const data = await res.json()
        if (cancelled) return

        if (!data.introSeen) {
          setCode(data.code)
          setOpen(true)
        } else {
          localStorage.setItem(LOCAL_STORAGE_KEY, 'true')
        }
      } catch {
        // ignore
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [])

  const dismiss = async () => {
    setOpen(false)
    localStorage.setItem(LOCAL_STORAGE_KEY, 'true')
    try {
      await fetch('/api/user/anti-phishing', { method: 'POST' })
    } catch {
      // non-blocking
    }
  }

  if (loading || !open || !code) return null

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-300">
      <div
        className="relative w-full max-w-lg glass border border-emerald-500/25 bg-emerald-500/5 rounded-2xl p-6 shadow-2xl shadow-emerald-950/30 animate-in zoom-in-95 duration-300"
        role="dialog"
        aria-modal="true"
        aria-labelledby="anti-phishing-title"
      >
        <button
          type="button"
          onClick={() => void dismiss()}
          className="absolute top-4 right-4 p-2 rounded-lg text-white/40 hover:text-white hover:bg-white/5 transition-colors"
          aria-label="Close"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="flex items-start gap-3 mb-4">
          <div className="p-2 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 shrink-0">
            <ShieldCheck className="h-5 w-5" />
          </div>
          <div>
            <h2 id="anti-phishing-title" className="text-lg font-bold text-white">
              Your Anti-Phishing Code
            </h2>
            <p className="text-sm text-white/60 mt-1 leading-relaxed">
              Every legitimate OpenSteam email and Discord DM includes this personal code. If a message claims to be from us but is missing your code, do not click links or reply.
            </p>
          </div>
        </div>

        <div className="rounded-xl border border-emerald-500/20 bg-black/30 px-4 py-5 text-center mb-4">
          <p className="text-[11px] uppercase tracking-[0.2em] text-emerald-300/70 mb-2 font-semibold">
            Your Code
          </p>
          <p className="text-2xl font-mono font-bold tracking-[0.18em] text-white">{code}</p>
        </div>

        <ul className="text-sm text-white/55 space-y-2 mb-6 list-disc pl-5">
          <li>Save this code somewhere safe (password manager, notes).</li>
          <li>We will never ask you to share it in Discord or support chat.</li>
          <li>Find it anytime in Dashboard → Settings.</li>
        </ul>

        <button
          type="button"
          onClick={() => void dismiss()}
          className="w-full py-3 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-black font-bold text-sm transition-colors"
        >
          I understand — protect my account
        </button>
      </div>
    </div>
  )
}
