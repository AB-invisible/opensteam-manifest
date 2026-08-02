'use client'

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Copy, Gift, Plus, RefreshCw, Trash2 } from 'lucide-react'
import { Plan } from '@prisma/client'

type VoucherRow = {
  id: string
  code: string
  type: string
  value: string
  uses: number
  usedCount: number
  expiresAt: string | null
  createdAt: string
  creator?: { username: string; discordId: string }
  usedBy?: { username: string; discordId: string } | null
}

const PLAN_OPTIONS: { value: Plan; label: string }[] = [
  { value: 'REGULAR', label: 'Regular' },
  { value: 'PREMIUM', label: 'Premium' },
  { value: 'RESELLER', label: 'Reseller' },
  { value: 'BUSINESS', label: 'Business' },
  { value: 'CUSTOM', label: 'Custom' },
]

function formatVoucherValue(value: string) {
  if (value.includes(':')) {
    const [plan, months] = value.split(':')
    const m = Number(months) || 1
    return `${plan} · ${m} month${m === 1 ? '' : 's'}`
  }
  return value
}

function toDatetimeLocalValue(d: Date) {
  const pad = (n: number) => n.toString().padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export default function VouchersPanel({
  toastSuccess,
  toastError,
}: {
  toastSuccess: (title: string, message?: string) => void
  toastError: (title: string, message?: string) => void
}) {
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [vouchers, setVouchers] = useState<VoucherRow[]>([])
  const [lastCreated, setLastCreated] = useState<VoucherRow[]>([])

  const [plan, setPlan] = useState<Plan>('PREMIUM')
  const [months, setMonths] = useState('1')
  const [uses, setUses] = useState('1')
  const [quantity, setQuantity] = useState('1')
  const [customCode, setCustomCode] = useState('')
  const [expiresAt, setExpiresAt] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/admin/vouchers')
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        toastError('Load failed', json.error || `HTTP ${res.status}`)
        return
      }
      setVouchers(json.vouchers || [])
    } catch {
      toastError('Load failed', 'Could not load vouchers')
    } finally {
      setLoading(false)
    }
  }, [toastError])

  useEffect(() => {
    load()
  }, [load])

  const stats = useMemo(() => {
    const active = vouchers.filter((v) => v.usedCount < v.uses).length
    const redeemed = vouchers.filter((v) => v.usedCount > 0).length
    return { total: vouchers.length, active, redeemed }
  }, [vouchers])

  const createVouchers = async () => {
    setCreating(true)
    try {
      const res = await fetch('/api/admin/vouchers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          plan,
          months: Number(months),
          uses: Number(uses),
          quantity: Number(quantity),
          customCode: customCode.trim() || undefined,
          expiresAt: expiresAt || undefined,
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        toastError('Create failed', json.error || `HTTP ${res.status}`)
        return
      }

      const created = json.vouchers || []
      setLastCreated(created)
      toastSuccess('Vouchers created', json.message)
      setCustomCode('')
      await load()
    } catch {
      toastError('Create failed', 'Could not create vouchers')
    } finally {
      setCreating(false)
    }
  }

  const deleteVoucher = async (voucher: VoucherRow) => {
    if (!confirm(`Delete voucher ${voucher.code}? This cannot be undone.`)) return

    try {
      const res = await fetch('/api/admin/vouchers', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: voucher.id }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        toastError('Delete failed', json.error || `HTTP ${res.status}`)
        return
      }
      toastSuccess('Voucher deleted', voucher.code)
      await load()
    } catch {
      toastError('Delete failed', 'Could not delete voucher')
    }
  }

  const copyText = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      toastSuccess('Copied', text)
    } catch {
      toastError('Copy failed', 'Could not copy to clipboard')
    }
  }

  const copyAllCreated = async () => {
    if (lastCreated.length === 0) return
    await copyText(lastCreated.map((v) => v.code).join('\n'))
  }

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-white/5 pb-6">
        <h3 className="text-xl font-black uppercase tracking-widest text-white flex items-center space-x-3">
          <Gift className="h-6 w-6 text-amber-400" />
          <span>Voucher Workshop</span>
        </h3>
        <button
          onClick={load}
          disabled={loading}
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-white/5 border border-white/10 text-sm font-bold uppercase tracking-wider text-muted-foreground hover:text-white transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {[
          { label: 'Total vouchers', value: stats.total },
          { label: 'Still redeemable', value: stats.active },
          { label: 'Partially / fully used', value: stats.redeemed },
        ].map((item) => (
          <div key={item.label} className="bg-white/5 border border-white/10 rounded-2xl p-5">
            <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">{item.label}</p>
            <p className="text-3xl font-black text-white mt-2">{item.value}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[380px_1fr] gap-8">
        <div className="bg-white/5 border border-white/10 rounded-[2rem] p-6 space-y-5 h-fit">
          <div>
            <h4 className="text-xs font-black uppercase tracking-widest text-amber-300 mb-1">Generate vouchers</h4>
            <p className="text-xs text-muted-foreground">
              Plan upgrade codes users redeem on the dashboard or pricing page.
            </p>
          </div>

          <label className="block space-y-2">
            <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Plan</span>
            <select
              value={plan}
              onChange={(e) => setPlan(e.target.value as Plan)}
              className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-sm text-white"
            >
              {PLAN_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <div className="grid grid-cols-2 gap-4">
            <label className="block space-y-2">
              <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Months</span>
              <input
                type="number"
                min={1}
                max={36}
                value={months}
                onChange={(e) => setMonths(e.target.value)}
                className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-sm text-white"
              />
            </label>
            <label className="block space-y-2">
              <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Uses each</span>
              <input
                type="number"
                min={1}
                max={100}
                value={uses}
                onChange={(e) => setUses(e.target.value)}
                className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-sm text-white"
              />
            </label>
          </div>

          <label className="block space-y-2">
            <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Quantity</span>
            <input
              type="number"
              min={1}
              max={50}
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-sm text-white"
            />
          </label>

          <label className="block space-y-2">
            <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
              Custom code (optional, single only)
            </span>
            <input
              type="text"
              value={customCode}
              onChange={(e) => setCustomCode(e.target.value.toUpperCase())}
              placeholder="AUTO-GENERATED"
              disabled={Number(quantity) > 1}
              className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-sm text-white font-mono disabled:opacity-50"
            />
          </label>

          <label className="block space-y-2">
            <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
              Expires at (optional)
            </span>
            <input
              type="datetime-local"
              value={expiresAt}
              onChange={(e) => setExpiresAt(e.target.value)}
              min={toDatetimeLocalValue(new Date())}
              className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-sm text-white"
            />
          </label>

          <button
            onClick={createVouchers}
            disabled={creating}
            className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-gradient-to-r from-amber-600 to-amber-500 hover:from-amber-500 hover:to-amber-400 text-white text-sm font-black uppercase tracking-widest transition-all disabled:opacity-50"
          >
            <Plus className="h-4 w-4" />
            {creating ? 'Generating…' : 'Generate'}
          </button>

          {lastCreated.length > 0 && (
            <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 p-4 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[10px] font-black uppercase tracking-widest text-amber-200">
                  Last batch ({lastCreated.length})
                </p>
                <button
                  onClick={copyAllCreated}
                  className="text-[10px] font-black uppercase tracking-widest text-amber-300 hover:text-white"
                >
                  Copy all
                </button>
              </div>
              <div className="space-y-2 max-h-40 overflow-y-auto">
                {lastCreated.map((voucher) => (
                  <div
                    key={voucher.id}
                    className="flex items-center justify-between gap-2 font-mono text-xs text-white bg-black/30 rounded-lg px-3 py-2"
                  >
                    <span>{voucher.code}</span>
                    <button onClick={() => copyText(voucher.code)} className="text-amber-300 hover:text-white">
                      <Copy className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="bg-white/5 border border-white/10 rounded-[2rem] overflow-hidden">
          <div className="px-6 py-4 border-b border-white/10">
            <h4 className="text-xs font-black uppercase tracking-widest text-white">Issued vouchers</h4>
          </div>

          {loading ? (
            <div className="py-24 text-center text-muted-foreground text-sm">Loading vouchers…</div>
          ) : vouchers.length === 0 ? (
            <div className="py-24 text-center text-muted-foreground text-sm">No vouchers yet. Generate your first batch.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-[10px] font-black uppercase tracking-widest text-muted-foreground bg-black/20">
                  <tr>
                    <th className="p-4">Code</th>
                    <th className="p-4">Reward</th>
                    <th className="p-4">Uses</th>
                    <th className="p-4">Expires</th>
                    <th className="p-4">Redeemed by</th>
                    <th className="p-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {vouchers.map((voucher) => {
                    const exhausted = voucher.usedCount >= voucher.uses
                    const expired = voucher.expiresAt && new Date(voucher.expiresAt) < new Date()
                    return (
                      <tr key={voucher.id} className="border-t border-white/5 hover:bg-white/[0.02]">
                        <td className="p-4 font-mono text-xs text-amber-200">{voucher.code}</td>
                        <td className="p-4 text-white/80">{formatVoucherValue(voucher.value)}</td>
                        <td className="p-4">
                          <span
                            className={`text-xs font-bold ${
                              exhausted ? 'text-muted-foreground' : 'text-emerald-400'
                            }`}
                          >
                            {voucher.usedCount}/{voucher.uses}
                          </span>
                        </td>
                        <td className="p-4 text-xs text-muted-foreground">
                          {voucher.expiresAt
                            ? new Date(voucher.expiresAt).toLocaleString()
                            : '—'}
                          {expired && !exhausted ? (
                            <span className="block text-red-400 font-bold uppercase tracking-wider text-[10px] mt-1">
                              Expired
                            </span>
                          ) : null}
                        </td>
                        <td className="p-4 text-xs text-muted-foreground">
                          {voucher.usedBy?.username || '—'}
                        </td>
                        <td className="p-4">
                          <div className="flex items-center justify-end gap-2">
                            <button
                              onClick={() => copyText(voucher.code)}
                              className="p-2 rounded-lg hover:bg-white/10 text-muted-foreground hover:text-white"
                              title="Copy code"
                            >
                              <Copy className="h-4 w-4" />
                            </button>
                            <button
                              onClick={() => deleteVoucher(voucher)}
                              className="p-2 rounded-lg hover:bg-red-500/10 text-muted-foreground hover:text-red-400"
                              title="Delete voucher"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
