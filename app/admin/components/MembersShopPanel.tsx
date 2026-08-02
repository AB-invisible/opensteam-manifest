'use client'

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ExternalLink,
  RefreshCw,
  ShoppingCart,
  Users,
  Wallet,
  Play,
  RotateCcw,
  Link2,
  KeyRound,
} from 'lucide-react'
import { formatCents, resolveSellerMarketId } from '@/app/lib/vaultcord-shared'

type MarketSeller = {
  id?: number
  marketId?: number
  serverName?: string
  title?: string
  cost?: number
  numOrders?: number
  category?: string
  minAmount?: number
  memberCount?: number
}

type MarketOrder = {
  id: string
  vaultOrderId: string
  reference?: string | null
  marketId: number
  amount: number
  costCents?: number | null
  inviteCode: string
  guildId?: string | null
  status: string
  sellerTitle?: string | null
  sellerServer?: string | null
  inviteUrl?: string | null
  orderUrl?: string | null
  newBalanceCents?: number | null
  pulledAt?: string | null
  refundedAt?: string | null
  createdAt: string
  createdBy?: { username: string; discordId: string }
}

type Filter = 'price-low' | 'price-high' | 'newest' | 'most-members'

const FILTERS: { value: Filter; label: string }[] = [
  { value: 'price-low', label: 'Price: Low → High' },
  { value: 'price-high', label: 'Price: High → Low' },
  { value: 'newest', label: 'Newest' },
  { value: 'most-members', label: 'Most Members' },
]

export default function MembersShopPanel({
  toastSuccess,
  toastError,
  variant = 'member',
}: {
  toastSuccess: (title: string, message?: string) => void
  toastError: (title: string, message?: string) => void
  variant?: 'member' | 'owner'
}) {
  const isOwner = variant === 'owner'
  const apiBase = isOwner ? '/api/admin/members-shop' : '/api/members-shop'

  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState(false)
  const [shopAvailable, setShopAvailable] = useState(false)
  const [sellers, setSellers] = useState<MarketSeller[]>([])
  const [orders, setOrders] = useState<MarketOrder[]>([])
  const [filter, setFilter] = useState<Filter>('price-low')
  const [apiKey, setApiKey] = useState('')
  const [inviteLink, setInviteLink] = useState('')
  const [budgetCents, setBudgetCents] = useState('')
  const [selectedSellerId, setSelectedSellerId] = useState<number | null>(null)
  const [amount, setAmount] = useState('100')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`${apiBase}?filter=${encodeURIComponent(filter)}`)
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        toastError('Load failed', json.error || `HTTP ${res.status}`)
        return
      }
      setShopAvailable(!!(json.configured ?? json.available))
      setSellers(json.sellers || [])
      setOrders(isOwner ? json.orders || [] : [])
    } catch {
      toastError('Load failed', 'Could not load members shop data')
    } finally {
      setLoading(false)
    }
  }, [apiBase, filter, isOwner, toastError])

  useEffect(() => {
    load()
  }, [load])

  const selectedSeller = useMemo(
    () => sellers.find((seller) => resolveSellerMarketId(seller) === selectedSellerId) || null,
    [sellers, selectedSellerId]
  )

  const estimatedCost = useMemo(() => {
    if (!selectedSeller?.cost) return null
    const qty = Number(amount)
    if (!Number.isFinite(qty) || qty <= 0) return null
    return Math.ceil((selectedSeller.cost * qty) / 100)
  }, [selectedSeller, amount])

  const postAction = async (body: Record<string, unknown>) => {
    setActionLoading(true)
    try {
      const res = await fetch(apiBase, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        toastError('Action failed', json.error || `HTTP ${res.status}`)
        return null
      }
      if (json.message) toastSuccess('Success', json.message)
      await load()
      return json
    } catch {
      toastError('Action failed', 'Network error')
      return null
    } finally {
      setActionLoading(false)
    }
  }

  const saveApiKey = async () => {
    if (!apiKey.trim()) {
      toastError('API key required', 'Paste your VaultCord API key first')
      return
    }
    const result = await postAction({ action: 'save-api-key', apiKey: apiKey.trim() })
    if (result) {
      setApiKey('')
      toastSuccess('API key saved', 'VaultCord API key stored securely')
    }
  }

  const placeOrder = async () => {
    if (!selectedSellerId) {
      toastError('Select a seller', 'Choose a marketplace listing first')
      return
    }
    if (!inviteLink.trim()) {
      toastError('Invite required', 'Enter the Discord invite link for delivery')
      return
    }
    const qty = Number(amount)
    if (!Number.isFinite(qty) || qty <= 0) {
      toastError('Invalid amount', 'Enter how many members to buy')
      return
    }
    if (selectedSeller?.minAmount && qty < selectedSeller.minAmount) {
      toastError('Below minimum', `This seller requires at least ${selectedSeller.minAmount} members`)
      return
    }

    await postAction({
      action: 'buy',
      marketId: selectedSellerId,
      inviteLink: inviteLink.trim(),
      amount: qty,
      budget: budgetCents ? Number(budgetCents) : undefined,
      sellerTitle: selectedSeller?.title,
      sellerServer: selectedSeller?.serverName,
    })
  }

  if (loading) {
    return (
      <div className="py-20 text-center text-muted-foreground">
        <RefreshCw className="h-8 w-8 animate-spin mx-auto mb-4 text-indigo-400" />
        Loading members marketplace…
      </div>
    )
  }

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-white/5 pb-6">
        <h3 className="text-xl font-black uppercase tracking-widest text-white flex items-center space-x-3">
          <ShoppingCart className="h-6 w-6 text-emerald-400" />
          <span>Members Shop</span>
        </h3>
        <button
          onClick={load}
          disabled={actionLoading}
          className="px-4 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-sm font-bold flex items-center gap-2"
        >
          <RefreshCw className={`h-4 w-4 ${actionLoading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {!isOwner && (
        <p className="text-sm text-muted-foreground">
          Browse marketplace listings and place orders for your Discord server. Order management is handled by staff.
        </p>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-8">
        <div className="xl:col-span-1 space-y-6">
          {isOwner ? (
            <div className="bg-white/5 border border-white/10 rounded-[2rem] p-6 space-y-4">
              <div className="flex items-center gap-3 text-emerald-300">
                <KeyRound className="h-5 w-5" />
                <h4 className="text-xs font-black uppercase tracking-widest">VaultCord API</h4>
              </div>
              <p className="text-sm text-muted-foreground">
                Uses the VaultCord marketplace API. Top up balance at{' '}
                <a
                  href="https://dash.vaultcord.com"
                  target="_blank"
                  rel="noreferrer"
                  className="text-indigo-300 hover:underline inline-flex items-center gap-1"
                >
                  dash.vaultcord.com <ExternalLink className="h-3 w-3" />
                </a>
              </p>
              <div className={`text-xs font-bold uppercase tracking-wider ${shopAvailable ? 'text-emerald-400' : 'text-amber-400'}`}>
                {shopAvailable ? 'API key configured' : 'API key missing'}
              </div>
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="Bearer API key"
                className="w-full bg-black/30 border border-white/10 rounded-xl px-4 py-3 text-sm"
              />
              <button
                onClick={saveApiKey}
                disabled={actionLoading}
                className="w-full py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm"
              >
                Save API Key
              </button>
            </div>
          ) : null}

          <div className="bg-white/5 border border-white/10 rounded-[2rem] p-6 space-y-4">
            <div className="flex items-center gap-3 text-indigo-300">
              <Users className="h-5 w-5" />
              <h4 className="text-xs font-black uppercase tracking-widest">Place Order</h4>
            </div>

            <label className="block space-y-2">
              <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Discord Invite</span>
              <input
                value={inviteLink}
                onChange={(e) => setInviteLink(e.target.value)}
                placeholder="discord.gg/yourcode or invite code"
                className="w-full bg-black/30 border border-white/10 rounded-xl px-4 py-3 text-sm"
              />
            </label>

            <label className="block space-y-2">
              <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Member Amount</span>
              <input
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                type="number"
                min={1}
                className="w-full bg-black/30 border border-white/10 rounded-xl px-4 py-3 text-sm"
              />
            </label>

            <label className="block space-y-2">
              <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Budget Cap (cents, optional)</span>
              <input
                value={budgetCents}
                onChange={(e) => setBudgetCents(e.target.value)}
                type="number"
                min={0}
                placeholder="e.g. 2000 = $20.00 max"
                className="w-full bg-black/30 border border-white/10 rounded-xl px-4 py-3 text-sm"
              />
            </label>

            {selectedSeller && (
              <div className="rounded-xl bg-black/20 border border-white/5 p-4 text-sm space-y-1">
                <div className="font-bold text-white">{selectedSeller.title || 'Selected listing'}</div>
                <div className="text-muted-foreground">{selectedSeller.serverName}</div>
                <div>{formatCents(selectedSeller.cost)} per 100 members</div>
                {selectedSeller.minAmount ? (
                  <div className="text-amber-300">Minimum order: {selectedSeller.minAmount}</div>
                ) : null}
                {estimatedCost != null ? (
                  <div className="text-emerald-300 font-bold">Estimated: {formatCents(estimatedCost)}</div>
                ) : null}
              </div>
            )}

            <button
              onClick={placeOrder}
              disabled={actionLoading || !shopAvailable || !selectedSellerId}
              className="w-full py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-bold text-sm flex items-center justify-center gap-2"
            >
              <Wallet className="h-4 w-4" />
              Buy Members
            </button>
          </div>
        </div>

        <div className={`space-y-6 ${isOwner ? 'xl:col-span-2' : 'xl:col-span-2'}`}>
          <div className="bg-white/5 border border-white/10 rounded-[2rem] p-6 space-y-4">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
              <h4 className="text-xs font-black uppercase tracking-widest text-white">Marketplace Sellers</h4>
              <select
                value={filter}
                onChange={(e) => setFilter(e.target.value as Filter)}
                className="bg-black/30 border border-white/10 rounded-xl px-3 py-2 text-sm"
              >
                {FILTERS.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
            </div>

            {!shopAvailable ? (
              <p className="text-sm text-amber-300">
                {isOwner
                  ? 'Configure your VaultCord API key to load sellers.'
                  : 'The members shop is temporarily unavailable. Please check back later.'}
              </p>
            ) : sellers.length === 0 ? (
              <p className="text-sm text-muted-foreground">No sellers returned. Marketplace data is cached ~2 hours on VaultCord.</p>
            ) : (
              <div className="space-y-3 max-h-[28rem] overflow-y-auto pr-1">
                {sellers.map((seller) => {
                  const marketId = resolveSellerMarketId(seller)
                  const selected = marketId === selectedSellerId
                  return (
                    <button
                      key={`${marketId ?? seller.title}-${seller.serverName}`}
                      onClick={() => marketId && setSelectedSellerId(marketId)}
                      disabled={!marketId}
                      className={`w-full text-left rounded-2xl border p-4 transition-all ${
                        selected
                          ? 'border-emerald-500/50 bg-emerald-500/10'
                          : 'border-white/10 bg-black/20 hover:border-white/20'
                      } ${!marketId ? 'opacity-50 cursor-not-allowed' : ''}`}
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <div className="font-bold text-white">{seller.title || 'Untitled listing'}</div>
                          <div className="text-sm text-muted-foreground">{seller.serverName}</div>
                          <div className="text-xs text-indigo-300 mt-1 uppercase tracking-wider">
                            {seller.category || 'general'}
                            {seller.memberCount ? ` · ${seller.memberCount.toLocaleString()} members` : ''}
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <div className="font-black text-emerald-300">{formatCents(seller.cost)}</div>
                          <div className="text-[10px] text-muted-foreground uppercase tracking-widest">per 100</div>
                          {marketId ? (
                            <div className="text-[10px] text-white/40 mt-1">ID {marketId}</div>
                          ) : (
                            <div className="text-[10px] text-amber-400 mt-1">Missing ID</div>
                          )}
                        </div>
                      </div>
                    </button>
                  )
                })}
              </div>
            )}
          </div>

          {isOwner ? (
            <div className="bg-white/5 border border-white/10 rounded-[2rem] p-6 space-y-4">
              <h4 className="text-xs font-black uppercase tracking-widest text-white">Recent Orders</h4>
              {orders.length === 0 ? (
                <p className="text-sm text-muted-foreground">No orders yet.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr className="text-[10px] uppercase tracking-widest text-muted-foreground border-b border-white/10">
                        <th className="py-3 pr-4">Order</th>
                        <th className="py-3 pr-4">Buyer</th>
                        <th className="py-3 pr-4">Seller</th>
                        <th className="py-3 pr-4">Qty</th>
                        <th className="py-3 pr-4">Cost</th>
                        <th className="py-3 pr-4">Status</th>
                        <th className="py-3">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {orders.map((order) => (
                        <tr key={order.id} className="border-b border-white/5 align-top">
                          <td className="py-4 pr-4">
                            <div className="font-mono text-xs text-white/80">{order.vaultOrderId}</div>
                            <div className="text-[10px] text-muted-foreground mt-1">
                              {new Date(order.createdAt).toLocaleString()}
                            </div>
                            {order.orderUrl ? (
                              <a
                                href={order.orderUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="text-[10px] text-indigo-300 hover:underline inline-flex items-center gap-1 mt-1"
                              >
                                View in VaultCord <ExternalLink className="h-3 w-3" />
                              </a>
                            ) : null}
                          </td>
                          <td className="py-4 pr-4">
                            <div>{order.createdBy?.username || 'Unknown'}</div>
                            <div className="text-[10px] text-muted-foreground font-mono">
                              {order.createdBy?.discordId || '—'}
                            </div>
                          </td>
                          <td className="py-4 pr-4">
                            <div>{order.sellerTitle || `Market #${order.marketId}`}</div>
                            <div className="text-xs text-muted-foreground">{order.sellerServer}</div>
                            <div className="text-[10px] text-white/40 mt-1">Invite: {order.inviteCode}</div>
                          </td>
                          <td className="py-4 pr-4">{order.amount.toLocaleString()}</td>
                          <td className="py-4 pr-4">
                            <div>{formatCents(order.costCents)}</div>
                            {order.newBalanceCents != null ? (
                              <div className="text-[10px] text-muted-foreground">
                                Balance: {formatCents(order.newBalanceCents)}
                              </div>
                            ) : null}
                          </td>
                          <td className="py-4 pr-4">
                            <span className="px-2 py-1 rounded-lg bg-white/10 text-[10px] font-bold uppercase tracking-wider">
                              {order.status}
                            </span>
                          </td>
                          <td className="py-4">
                            <div className="flex flex-wrap gap-2">
                              {order.status === 'paid' ? (
                                <button
                                  onClick={() => postAction({ action: 'pull', orderId: order.vaultOrderId })}
                                  disabled={actionLoading}
                                  className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-xs font-bold flex items-center gap-1"
                                >
                                  <Play className="h-3 w-3" /> Pull
                                </button>
                              ) : null}
                              {order.reference && order.status === 'paid' ? (
                                <button
                                  onClick={() => {
                                    const invite = window.prompt('New invite code (without discord.gg):', order.inviteCode)
                                    if (!invite) return
                                    postAction({ action: 'update-invite', ref: order.reference, invite })
                                  }}
                                  disabled={actionLoading}
                                  className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-xs font-bold flex items-center gap-1"
                                >
                                  <Link2 className="h-3 w-3" /> Invite
                                </button>
                              ) : null}
                              {order.status === 'pulled' ? (
                                <button
                                  onClick={() => {
                                    if (!window.confirm('Request refund for failed members on this order?')) return
                                    postAction({ action: 'refund', orderId: order.vaultOrderId })
                                  }}
                                  disabled={actionLoading}
                                  className="px-3 py-1.5 rounded-lg bg-amber-600/80 hover:bg-amber-500 text-xs font-bold flex items-center gap-1"
                                >
                                  <RotateCcw className="h-3 w-3" /> Refund
                                </button>
                              ) : null}
                              {order.inviteUrl ? (
                                <a
                                  href={order.inviteUrl}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="px-3 py-1.5 rounded-lg bg-indigo-600/80 hover:bg-indigo-500 text-xs font-bold inline-flex items-center gap-1"
                                >
                                  <ExternalLink className="h-3 w-3" /> Bot
                                </a>
                              ) : null}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}
