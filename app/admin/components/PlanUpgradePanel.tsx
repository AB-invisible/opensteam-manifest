'use client'

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowUpCircle, RefreshCw, Search } from 'lucide-react'
import { Plan } from '@prisma/client'

type PlanOption = {
  value: Plan
  label: string
  limits: {
    webDaily: number
    apiDaily: number
    apiBurst: number
    allowRyuu: boolean
    allowMorrenusFallback: boolean
  }
}

type TargetUser = {
  id: string
  discordId: string
  username: string
  plan: Plan
  planExpiry: string | null
  role: string
}

function toDatetimeLocalValue(d: Date) {
  const pad = (n: number) => n.toString().padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function formatExpiry(expiry: string | null) {
  if (!expiry) return 'No expiry (permanent)'
  const d = new Date(expiry)
  if (Number.isNaN(d.getTime())) return 'Invalid date'
  if (d < new Date()) return `Expired ${d.toLocaleString()}`
  return d.toLocaleString()
}

export default function PlanUpgradePanel({
  toastSuccess,
  toastError,
}: {
  toastSuccess: (title: string, message?: string) => void
  toastError: (title: string, message?: string) => void
}) {
  const [loading, setLoading] = useState(true)
  const [lookupLoading, setLookupLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [plans, setPlans] = useState<PlanOption[]>([])
  const [userQuery, setUserQuery] = useState('')
  const [targetUser, setTargetUser] = useState<TargetUser | null>(null)
  const [plan, setPlan] = useState<Plan>('PREMIUM')
  const [indefinite, setIndefinite] = useState(false)
  const [months, setMonths] = useState('1')
  const [expiryDate, setExpiryDate] = useState('')

  const loadPlans = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/admin/users/upgrade')
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        toastError('Load failed', json.error || `HTTP ${res.status}`)
        return
      }
      setPlans(json.plans || [])
    } catch {
      toastError('Load failed', 'Could not load plan options')
    } finally {
      setLoading(false)
    }
  }, [toastError])

  useEffect(() => {
    loadPlans()
  }, [loadPlans])

  const selectedPlan = useMemo(
    () => plans.find((p) => p.value === plan) ?? null,
    [plans, plan]
  )

  const lookupUser = async () => {
    const q = userQuery.trim()
    if (!q) {
      toastError('Missing user', 'Enter a user ID or Discord ID.')
      return
    }

    setLookupLoading(true)
    try {
      const res = await fetch(`/api/admin/users/upgrade?q=${encodeURIComponent(q)}`)
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        toastError('Lookup failed', json.error || `HTTP ${res.status}`)
        return
      }
      if (!json.user) {
        setTargetUser(null)
        toastError('Not found', 'No user matches that ID.')
        return
      }
      setTargetUser(json.user)
      setPlan(json.user.plan === 'FREE' ? 'PREMIUM' : json.user.plan)
    } catch {
      toastError('Lookup failed', 'Could not look up user.')
    } finally {
      setLookupLoading(false)
    }
  }

  const submitUpgrade = async () => {
    if (!targetUser) {
      toastError('No user', 'Look up a user first.')
      return
    }

    setSubmitting(true)
    try {
      const res = await fetch('/api/admin/users/upgrade', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: targetUser.id,
          plan,
          indefinite: plan !== 'FREE' ? indefinite : false,
          months: plan !== 'FREE' && !indefinite && !expiryDate.trim() ? Number(months) : undefined,
          expiryDate: plan !== 'FREE' && !indefinite && expiryDate.trim() ? expiryDate : undefined,
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        toastError('Upgrade failed', json.error || `HTTP ${res.status}`)
        return
      }

      toastSuccess('Plan upgraded', json.message || 'User plan updated.')
      setTargetUser(json.user)
      setUserQuery(json.user.id)
    } catch {
      toastError('Upgrade failed', 'Could not apply plan upgrade.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-white/5 pb-6">
        <h3 className="text-xl font-black uppercase tracking-widest text-white flex items-center space-x-3">
          <ArrowUpCircle className="h-6 w-6 text-emerald-400" />
          <span>Plan Upgrade</span>
        </h3>
        <button
          onClick={loadPlans}
          disabled={loading}
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-white/5 border border-white/10 text-sm font-bold uppercase tracking-wider text-muted-foreground hover:text-white transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[380px_1fr] gap-8">
        <div className="bg-white/5 border border-white/10 rounded-[2rem] p-6 space-y-5 h-fit">
          <div>
            <h4 className="text-xs font-black uppercase tracking-widest text-emerald-300 mb-1">Upgrade account</h4>
            <p className="text-xs text-muted-foreground">
              Owner-only. Set plan and duration for any user by internal ID or Discord ID.
            </p>
          </div>

          <label className="block space-y-2">
            <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">User ID</span>
            <div className="flex gap-2">
              <input
                type="text"
                value={userQuery}
                onChange={(e) => setUserQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && lookupUser()}
                placeholder="cuid or Discord snowflake"
                className="flex-1 bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-sm text-white font-mono"
              />
              <button
                type="button"
                onClick={lookupUser}
                disabled={lookupLoading}
                className="px-4 rounded-xl bg-emerald-600 text-white text-xs font-black uppercase tracking-wider hover:bg-emerald-500 disabled:opacity-50"
              >
                <Search className={`h-4 w-4 ${lookupLoading ? 'animate-pulse' : ''}`} />
              </button>
            </div>
          </label>

          {targetUser && (
            <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-4 space-y-2 text-sm">
              <p className="font-bold text-white">{targetUser.username}</p>
              <p className="text-xs text-muted-foreground font-mono break-all">{targetUser.id}</p>
              <p className="text-xs text-muted-foreground">
                Current: <span className="text-emerald-300 font-bold">{targetUser.plan}</span>
                {' · '}
                {formatExpiry(targetUser.planExpiry)}
              </p>
            </div>
          )}

          <label className="block space-y-2">
            <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Plan</span>
            <select
              value={plan}
              onChange={(e) => setPlan(e.target.value as Plan)}
              className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-sm text-white"
            >
              {plans.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          {plan !== 'FREE' && (
            <div className="space-y-3 p-4 bg-black/30 rounded-2xl border border-white/10">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-bold text-white">Duration</p>
                  <p className="text-[10px] text-muted-foreground">Indefinite or limited subscription</p>
                </div>
                <button
                  type="button"
                  onClick={() => setIndefinite((v) => !v)}
                  className={`px-3 py-1 rounded-lg text-[10px] font-black uppercase transition-all ${
                    indefinite ? 'bg-emerald-500 text-white' : 'bg-white/10 text-white/40'
                  }`}
                >
                  {indefinite ? 'Indefinite' : 'Limited'}
                </button>
              </div>

              {!indefinite && (
                <div className="space-y-3">
                  <label className="block space-y-1.5">
                    <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
                      End date (optional)
                    </span>
                    <input
                      type="datetime-local"
                      value={expiryDate}
                      onChange={(e) => setExpiryDate(e.target.value)}
                      min={toDatetimeLocalValue(new Date())}
                      className="w-full bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-xs text-white font-mono"
                    />
                  </label>
                  {!expiryDate.trim() && (
                    <label className="block space-y-1.5">
                      <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
                        Months from now
                      </span>
                      <input
                        type="number"
                        min={1}
                        max={120}
                        value={months}
                        onChange={(e) => setMonths(e.target.value)}
                        className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-sm text-white"
                      />
                    </label>
                  )}
                </div>
              )}
            </div>
          )}

          {selectedPlan && (
            <div className="rounded-2xl border border-white/10 bg-black/20 p-4 text-xs text-muted-foreground space-y-1">
              <p>
                Web <span className="text-white font-bold">{selectedPlan.limits.webDaily.toLocaleString()}</span>/day
              </p>
              <p>
                API <span className="text-white font-bold">{selectedPlan.limits.apiDaily.toLocaleString()}</span>/day
              </p>
              <p>
                Burst <span className="text-white font-bold">{selectedPlan.limits.apiBurst.toLocaleString()}</span>/min
              </p>
            </div>
          )}

          <button
            type="button"
            onClick={submitUpgrade}
            disabled={submitting || !targetUser}
            className="w-full py-4 bg-emerald-600 text-white text-xs font-black uppercase tracking-widest rounded-2xl hover:bg-emerald-500 transition-all disabled:opacity-50"
          >
            {submitting ? 'Applying…' : 'Apply upgrade'}
          </button>
        </div>

        <div className="space-y-4">
          <h4 className="text-xs font-black uppercase tracking-widest text-muted-foreground">All plans</h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {plans.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setPlan(option.value)}
                className={`text-left rounded-2xl border p-5 transition-all ${
                  plan === option.value
                    ? 'border-emerald-500/40 bg-emerald-500/10 ring-1 ring-emerald-500/30'
                    : 'border-white/10 bg-white/5 hover:border-white/20'
                }`}
              >
                <p className="text-sm font-black text-white">{option.label}</p>
                <p className="text-[10px] font-mono text-muted-foreground mt-1">{option.value}</p>
                <div className="mt-3 space-y-1 text-xs text-muted-foreground">
                  <p>Web {option.limits.webDaily.toLocaleString()}/day</p>
                  <p>API {option.limits.apiDaily.toLocaleString()}/day</p>
                  <p>Burst {option.limits.apiBurst.toLocaleString()}/min</p>
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
