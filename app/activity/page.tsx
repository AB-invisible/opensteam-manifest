'use client'

import React, { useEffect, useState } from 'react'
import { DiscordSDK } from '@discord/embedded-app-sdk'

interface DiscordUser {
  id: string
  username: string
  global_name?: string
  avatar?: string
  discriminator?: string
}

interface RelationshipItem {
  id: string
  type: number // 1 = Friend, 2 = Blocked, 3 = Pending Incoming, 4 = Pending Outgoing
  user?: {
    id: string
    username: string
    global_name?: string
    avatar?: string
  }
}

export default function DiscordActivityPage() {
  const [sdkReady, setSdkReady] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [user, setUser] = useState<DiscordUser | null>(null)
  const [relationships, setRelationships] = useState<RelationshipItem[] | null>(null)

  useEffect(() => {
    let isMounted = true

    async function initDiscordActivity() {
      try {
        const clientId = process.env.NEXT_PUBLIC_DISCORD_CLIENT_ID || '123456789012345678'
        const discordSdk = new DiscordSDK(clientId)

        await discordSdk.ready()
        if (!isMounted) return
        setSdkReady(true)

        // Authenticate with relationships.read scope
        const { code } = await discordSdk.commands.authorize({
          client_id: clientId,
          response_type: 'code',
          state: '',
          prompt: 'none',
          scope: ['identify', 'guilds', 'relationships.read'],
        })

        // Exchange code with backend API
        const response = await fetch('/api/activity/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code }),
        })

        const data = await response.json()

        if (!response.ok) {
          throw new Error(data.error || 'Failed to exchange authorization token')
        }

        if (isMounted) {
          setUser(data.user)
          setRelationships(data.relationships)
          setLoading(false)
        }
      } catch (err: any) {
        console.error('[Activity Init Error]:', err)
        if (isMounted) {
          setError(err.message || 'Failed to initialize Discord Activity frame')
          setLoading(false)
        }
      }
    }

    initDiscordActivity()

    return () => {
      isMounted = false
    }
  }, [])

  const friendsList = relationships?.filter((r) => r.type === 1) || []

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col items-center justify-center p-6 select-none font-sans">
      <div className="max-w-md w-full bg-slate-900/80 backdrop-blur-xl border border-slate-800 rounded-3xl p-6 shadow-2xl shadow-indigo-950/40 transition-all duration-300">
        
        {/* Header Badge */}
        <div className="flex items-center justify-between border-b border-slate-800/80 pb-4 mb-6">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-indigo-500 to-purple-600 flex items-center justify-center shadow-lg shadow-indigo-500/20">
              <svg className="w-6 h-6 text-white" fill="currentColor" viewBox="0 0 24 24">
                <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994.021-.041.001-.09-.041-.106a13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.061 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.028z" />
              </svg>
            </div>
            <div>
              <h1 className="text-lg font-bold text-slate-100 tracking-tight">OpenSteam Activity</h1>
              <p className="text-xs text-indigo-400 font-medium">Discord Embedded App</p>
            </div>
          </div>
          <span className="px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-emerald-400 bg-emerald-950/60 border border-emerald-500/30 rounded-full">
            Active
          </span>
        </div>

        {/* State Views */}
        {loading ? (
          <div className="py-12 flex flex-col items-center justify-center space-y-4">
            <div className="w-10 h-10 border-4 border-indigo-500/20 border-t-indigo-500 rounded-full animate-spin"></div>
            <p className="text-sm text-slate-400 font-medium animate-pulse">
              Connecting to Discord SDK...
            </p>
          </div>
        ) : error ? (
          <div className="py-6 px-4 bg-rose-950/40 border border-rose-800/50 rounded-2xl text-center space-y-2">
            <div className="w-8 h-8 rounded-full bg-rose-500/20 text-rose-400 flex items-center justify-center mx-auto">
              !
            </div>
            <h3 className="text-sm font-semibold text-rose-300">Activity Initialization Warning</h3>
            <p className="text-xs text-slate-400 leading-relaxed">{error}</p>
            <p className="text-[11px] text-slate-500 mt-2">
              Note: This page must be launched inside a Discord Activity frame.
            </p>
          </div>
        ) : (
          <div className="space-y-6">
            {/* User Profile Card */}
            {user && (
              <div className="flex items-center space-x-4 bg-slate-950/60 p-4 rounded-2xl border border-slate-800/60">
                {user.avatar ? (
                  <img
                    src={`https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png`}
                    alt={user.username}
                    className="w-14 h-14 rounded-full border-2 border-indigo-500/40"
                  />
                ) : (
                  <div className="w-14 h-14 rounded-full bg-indigo-600 flex items-center justify-center text-xl font-bold text-white">
                    {user.username.slice(0, 1).toUpperCase()}
                  </div>
                )}
                <div>
                  <h2 className="text-base font-bold text-slate-100">
                    {user.global_name || user.username}
                  </h2>
                  <p className="text-xs text-slate-400">@{user.username}</p>
                </div>
              </div>
            )}

            {/* Social Graph Stats */}
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-slate-950/40 p-3.5 rounded-xl border border-slate-800/40 text-center">
                <span className="block text-2xl font-black text-indigo-400">
                  {friendsList.length}
                </span>
                <span className="text-[11px] text-slate-400 font-medium">Discord Friends</span>
              </div>
              <div className="bg-slate-950/40 p-3.5 rounded-xl border border-slate-800/40 text-center">
                <span className="block text-2xl font-black text-purple-400">
                  {relationships?.length || 0}
                </span>
                <span className="text-[11px] text-slate-400 font-medium">Total Graph Nodes</span>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="space-y-2 pt-2">
              <a
                href="/dashboard"
                target="_blank"
                rel="noreferrer"
                className="w-full py-3 px-4 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold rounded-xl transition duration-200 text-center block shadow-lg shadow-indigo-600/30"
              >
                Open OpenSteam Dashboard
              </a>
              <a
                href="http://127.0.0.1:3000/discord"
                target="_blank"
                rel="noreferrer"
                className="w-full py-2.5 px-4 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium rounded-xl transition duration-200 text-center block"
              >
                Join Support Server
              </a>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
