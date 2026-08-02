'use client'

import { useState, useEffect } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { getDiscordCdnAvatarUrl } from '@/app/lib/discord-avatar'
import {
  Star,
  Gamepad2,
  Activity,
  ChevronRight,
  TrendingUp,
  Sparkles,
  Heart,
  KeyRound,
  ShieldCheck,
  Zap,
  CheckCircle,
  PlusCircle,
  Clock,
  ChevronDown,
  Search
} from 'lucide-react'
import { useToast } from '../components/Toast'

export default function DonatePage() {
  const { data: session, status } = useSession()
  const router = useRouter()
  const { success: toastSuccess, error: toastError } = useToast()

  const [donations, setDonations] = useState<any[]>([])
  const [userDonations, setUserDonations] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [userLoading, setUserLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  
  // Game Search States
  const [gameList, setGameList] = useState<{name: string, appId: number}[]>([])
  const [searchTerm, setSearchTerm] = useState('')
  const [selectedGame, setSelectedGame] = useState<{name: string, appId: number} | null>(null)
  const [steamKey, setSteamKey] = useState('')
  const [filteredGames, setFilteredGames] = useState<{name: string, appId: number}[]>([])
  const [showDropdown, setShowDropdown] = useState(false)

  const loadPublicDonations = async () => {
    try {
      const res = await fetch('/api/donations')
      if (res.ok) {
        const d = await res.json()
        setDonations(d.donations || [])
      }
    } finally {
      setLoading(false)
    }
  }

  const loadUserDonations = async () => {
    if (status !== 'authenticated') return
    setUserLoading(true)
    try {
      const res = await fetch('/api/user/donations')
      if (res.ok) {
        const d = await res.json()
        setUserDonations(d.donations || [])
      }
    } finally {
      setUserLoading(false)
    }
  }

  const loadGameList = async () => {
    try {
      const resp = await fetch('/api/bots/discord/admin?action=get_games')
      if (resp.ok) {
        const data = await resp.json()
        setGameList(data.games || [])
      }
    } catch (e) { console.error('Failed to load list') }
  }

  useEffect(() => {
    loadPublicDonations()
  }, [])

  useEffect(() => {
    if (status === 'authenticated') {
      loadUserDonations()
      loadGameList()
    }
  }, [status])

  useEffect(() => {
    if (searchTerm.length > 1) {
      const filtered = gameList
        .filter(g => g.name.toLowerCase().includes(searchTerm.toLowerCase()))
        .slice(0, 10)
      setFilteredGames(filtered)
    } else {
      setFilteredGames([])
    }
  }, [searchTerm, gameList])

  const submitDonation = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedGame || !steamKey) return

    if (status !== 'authenticated') {
      toastError('Login Required', 'You must be logged in to donate games.')
      router.push('/dashboard')
      return
    }

    setSubmitting(true)
    try {
      const res = await fetch('/api/user/donations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gameName: selectedGame.name, steamKey })
      })

      if (res.ok) {
        toastSuccess('Sent to Staff', `Successfully submitted for ${selectedGame.name}. PENDING approval.`)
        setSelectedGame(null)
        setSearchTerm('')
        setSteamKey('')
        loadPublicDonations()
        loadUserDonations()
      } else {
        toastError('Submission Error', 'Verify your key format and ensure you have selected a valid game.')
      }
    } finally {
      setSubmitting(false)
    }
  }

  // Handle outside click to close dropdown
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement
      if (!target.closest('.game-select-container')) {
        setShowDropdown(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  return (
    <div className="min-h-screen bg-[#060608] text-white selection:bg-indigo-500/30 overflow-x-hidden relative font-sans">
      {/* Dynamic Backgrounds */}
      <div className="fixed top-[-20%] left-[-10%] w-[60%] h-[60%] rounded-full bg-indigo-500/10 blur-[150px] pointer-events-none" />
      <div className="fixed bottom-[-10%] right-[-5%] w-[40%] h-[40%] rounded-full bg-purple-500/8 blur-[120px] pointer-events-none" />

      {/* Navbar Overlay */}
      <nav className="sticky top-0 z-[100] glass border-b border-white/5 w-full bg-black/40 backdrop-blur-xl">
        <div className="container mx-auto px-6 py-4 flex justify-between items-center">
          <div className="flex items-center space-x-3 cursor-pointer group" onClick={() => router.push('/')}>
            <div className="p-1.5 bg-indigo-500/10 rounded-xl border border-indigo-500/20 group-hover:bg-indigo-500/20 transition-all">
              <img src="/favicon.ico" alt="" className="h-6 w-6 group-hover:scale-110 transition-transform" />
            </div>
            <span className="text-xl font-black uppercase tracking-tighter">OpenSteam <span className="text-indigo-500">Donations</span></span>
          </div>
          
          <div className="flex items-center space-x-4">
            {status === 'authenticated' ? (
              <button onClick={() => router.push('/dashboard')} className="px-5 py-2 text-[10px] font-black uppercase tracking-widest text-white/50 hover:text-white transition-all">Dashboard</button>
            ) : (
              <button 
                onClick={() => router.push('/dashboard')}
                className="px-6 py-2 bg-white text-black text-[10px] font-black uppercase tracking-widest rounded-full hover:bg-indigo-50 transition-all"
              >
                Login to Donate
              </button>
            )}
          </div>
        </div>
      </nav>

      {/* Hero Body */}
      <div className="container mx-auto px-6 pt-20 pb-32 relative z-10">
        <div className="max-w-4xl mx-auto space-y-16">
          
          {/* Header Section */}
          <div className="text-center space-y-6">
            <div className="inline-flex items-center space-x-3 px-4 py-1.5 bg-indigo-500/10 border border-indigo-500/20 rounded-full animate-in fade-in slide-in-from-bottom-2 duration-700">
               <Zap className="h-4 w-4 text-indigo-400 fill-indigo-400" />
               <span className="text-[10px] font-black uppercase tracking-[0.3em] text-indigo-300">Community Support System</span>
            </div>
            <h1 className="text-5xl md:text-7xl font-black text-white tracking-tight leading-[0.9] italic">
              DONATE <span className="text-indigo-500">STEAM KEYS</span>
            </h1>
            <p className="text-lg text-muted-foreground/80 max-w-2xl mx-auto leading-relaxed font-medium">
              Submit your spare, unused Steam keys to help fasten the denuvo activations. As a reward you will get a donator role.
            </p>
          </div>

          {/* Core Submission Portal */}
          <div className="glass !bg-[#0C0C0E]/60 border border-white/5 rounded-[3rem] p-8 md:p-12 shadow-2xl relative overflow-hidden animate-in zoom-in-95 duration-500">
            <div className="absolute top-0 right-0 w-64 h-64 bg-indigo-500/5 blur-[100px] pointer-events-none" />
            
            <div className="relative z-10 space-y-10">
              <div className="flex items-center space-x-6 pb-8 border-b border-white/5">
                 <div className="p-4 bg-indigo-500/10 rounded-3xl border border-indigo-500/20">
                    <ShieldCheck className="h-8 w-8 text-indigo-400" />
                 </div>
                 <div>
                    <h2 className="text-2xl font-black text-white tracking-widest uppercase">Submission Portal</h2>
                    <p className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground">Verification & Staff Audit Required</p>
                 </div>
              </div>

              <form onSubmit={submitDonation} className="space-y-8">
                {/* Step 1: Selection */}
                <div className="space-y-4">
                  <div className="flex items-center space-x-3">
                     <span className="w-6 h-6 rounded-full bg-indigo-500 text-black flex items-center justify-center text-[10px] font-black">01</span>
                     <span className="text-[10px] font-black uppercase tracking-[0.2em] text-indigo-300">Select Game Title</span>
                  </div>
                  <div className="relative group game-select-container">
                    <div className="absolute inset-y-0 left-0 pl-6 flex items-center pointer-events-none">
                      {selectedGame ? (
                        <CheckCircle className="h-6 w-6 text-emerald-400 animate-in zoom-in" />
                      ) : (
                        <Search className="h-6 w-6 text-white/20 group-hover:text-indigo-400 transition-colors" />
                      )}
                    </div>
                    <input
                      type="text"
                      autoComplete="off"
                      value={selectedGame ? selectedGame.name : searchTerm}
                      onChange={(e) => { 
                        setSearchTerm(e.target.value)
                        setShowDropdown(true)
                        if (selectedGame) setSelectedGame(null)
                      }}
                      onFocus={() => setShowDropdown(true)}
                      placeholder="Start typing to find a game..."
                      className={`w-full bg-black/60 border-2 rounded-3xl py-6 pl-16 pr-16 text-sm font-bold transition-all shadow-inner outline-none ${
                        selectedGame 
                          ? 'border-emerald-500/30 text-emerald-100' 
                          : 'border-white/5 text-white placeholder-white/10 focus:border-indigo-500/50'
                      }`}
                    />
                    <div className="absolute inset-y-0 right-0 pr-6 flex items-center pointer-events-none">
                      <ChevronDown className={`h-6 w-6 text-white/20 transition-transform duration-300 ${showDropdown ? 'rotate-180 text-indigo-400' : ''}`} />
                    </div>
                    
                    {showDropdown && (
                      <div className="absolute top-full left-0 right-0 mt-3 bg-[#0D0D0F] border border-white/10 rounded-3xl shadow-[0_30px_60px_rgba(0,0,0,0.8)] z-50 overflow-hidden animate-in slide-in-from-top-2">
                        {filteredGames.length > 0 ? (
                          filteredGames.map(g => (
                            <button
                              key={g.appId}
                              type="button"
                              onClick={() => { setSelectedGame(g); setShowDropdown(false); setSearchTerm(''); }}
                              className="w-full text-left px-7 py-4 text-xs font-bold text-white/50 hover:bg-indigo-500 hover:text-white transition-all flex items-center justify-between group/item border-b border-white/5 last:border-0"
                            >
                              <span className="truncate">{g.name}</span>
                              <span className="text-[10px] font-mono text-white/20 group-hover/item:text-white/50">{g.appId}</span>
                            </button>
                          ))
                        ) : (
                          <div className="px-7 py-8 text-center">
                            <p className="text-[10px] font-black uppercase tracking-widest text-white/20">
                              {searchTerm.length < 2 ? 'Type at least 2 characters...' : 'No matching games found'}
                            </p>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {/* Step 2: Key Input */}
                <div className="space-y-4">
                  <div className="flex items-center space-x-3">
                     <span className="w-6 h-6 rounded-full bg-indigo-500 text-black flex items-center justify-center text-[10px] font-black">02</span>
                     <span className="text-[10px] font-black uppercase tracking-[0.2em] text-indigo-300">Input Steam Key</span>
                  </div>
                  <div className="relative group">
                    <div className="absolute inset-y-0 left-0 pl-6 flex items-center pointer-events-none">
                      <KeyRound className="h-6 w-6 text-white/20 group-hover:text-indigo-400 transition-colors" />
                    </div>
                    <input
                      type="text"
                      value={steamKey}
                      onChange={(e) => setSteamKey(e.target.value.toUpperCase())}
                      placeholder="XXXXX-XXXXX-XXXXX"
                      className="w-full bg-black/60 border-2 border-white/5 rounded-3xl py-6 pl-16 pr-8 text-sm font-mono tracking-[0.2em] text-indigo-300 placeholder-white/10 focus:border-indigo-500/50 outline-none transition-all shadow-inner"
                    />
                  </div>
                </div>

                {/* Step 3: Submission */}
                <div className="pt-6">
                  <button
                    type="submit"
                    disabled={submitting || !selectedGame || !steamKey}
                    className="w-full py-7 bg-white hover:bg-indigo-50 text-black font-black uppercase tracking-[0.3em] rounded-[1.5rem] transition-all shadow-[0_20px_40px_rgba(255,255,255,0.05)] hover:shadow-white/10 disabled:opacity-30 disabled:grayscale hover:scale-[1.01] active:scale-[0.99] flex items-center justify-center space-x-3"
                  >
                    {submitting ? <Activity className="h-6 w-6 animate-spin" /> : <PlusCircle className="h-6 w-6" />}
                    <span>Submit to Staff for Audit</span>
                  </button>
                  <p className="mt-6 text-[10px] text-center text-muted-foreground font-bold uppercase tracking-widest opacity-40">
                    By submitting, you agree that providing invalid keys may result in a platform ban.
                  </p>
                </div>
              </form>
            </div>
          </div>

          {/* User Personal History Section */}
          {status === 'authenticated' && (
            <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
              <div className="flex items-center justify-between border-b border-white/5 pb-6">
                <div className="flex items-center space-x-4">
                  <div className="p-3 bg-indigo-500/10 rounded-2xl border border-indigo-500/20">
                     <Clock className="h-6 w-6 text-indigo-400" />
                  </div>
                  <div>
                    <h2 className="text-xl font-black text-white uppercase tracking-widest italic">Your Submissions</h2>
                    <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Historical Audit of your contributions</p>
                  </div>
                </div>
                <div className="px-4 py-2 bg-white/5 rounded-xl border border-white/10 flex items-center space-x-2">
                  <Activity className="h-4 w-4 text-indigo-500" />
                  <span className="text-[10px] font-black uppercase text-white tracking-widest">{userDonations.length} Contributed</span>
                </div>
              </div>

              {userLoading ? (
                <div className="py-12 text-center text-muted-foreground"><Activity className="h-5 w-5 animate-spin mx-auto mb-2" />fetching records...</div>
              ) : userDonations.length === 0 ? (
                <div className="py-12 glass border border-dashed border-white/5 rounded-3xl text-center">
                  <p className="text-xs font-bold text-white/30 uppercase tracking-[0.2em] italic">No personal records found in the vault.</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-4">
                  {userDonations.map((d) => (
                    <div key={d.id} className="glass !bg-white/[0.01] border border-white/5 rounded-2xl p-5 flex flex-col md:flex-row md:items-center justify-between gap-4 group hover:bg-white/[0.03] transition-all">
                      <div className="flex items-center space-x-4">
                         <div className="w-12 h-12 bg-black/40 rounded-xl flex items-center justify-center border border-white/5 group-hover:border-indigo-500/30 transition-all">
                            <Gamepad2 className="h-6 w-6 text-indigo-400/50" />
                         </div>
                         <div>
                            <p className="text-sm font-black text-white uppercase tracking-wider">{d.gameName}</p>
                            <div className="flex items-center space-x-3 mt-1">
                               <code className="text-[10px] text-white/30 font-mono tracking-widest">{d.steamKey.substring(0, 5)}-XXXXX-XXXXX</code>
                               <span className="text-white/10">•</span>
                               <span className="text-[9px] font-black uppercase text-muted-foreground tracking-widest">{new Date(d.createdAt).toLocaleDateString()}</span>
                            </div>
                         </div>
                      </div>
                      <div className="flex items-center space-x-4">
                         <div className={`px-4 py-1.5 rounded-full text-[9px] font-black uppercase tracking-widest border ${
                           d.status === 'APPROVED' ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/20 shadow-[0_0_15px_rgba(16,185,129,0.1)]' :
                           d.status === 'REJECTED' ? 'bg-red-500/20 text-red-400 border-red-500/20' :
                           'bg-amber-500/20 text-amber-400 border-amber-500/20 animate-pulse'
                         }`}>
                           {d.status}
                         </div>
                         <div className="hidden md:block">
                           <ChevronRight className="h-4 w-4 text-white/10 group-hover:text-indigo-400 transition-colors" />
                         </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Wall of Fame - Integrated below */}
          <div className="space-y-12 pt-20">
            <div className="text-center space-y-3">
               <h2 className="text-3xl font-black text-white italic tracking-tight">LEGENDARY <span className="text-indigo-500 underline decoration-indigo-500/30">DONORS</span></h2>
               <p className="text-xs font-black uppercase tracking-[0.3em] text-muted-foreground">Most Recent Approved Contributions</p>
            </div>

            {loading ? (
              <div className="py-20 text-center">
                 <Activity className="h-6 w-6 text-indigo-500 animate-spin mx-auto" />
              </div>
            ) : donations.length === 0 ? (
              <div className="p-16 border-2 border-dashed border-white/5 rounded-[3rem] text-center">
                 <p className="text-sm font-bold text-white/30 uppercase tracking-widest">No contributions recorded yet. Be the first hero!</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {donations.map((d, i) => {
                  const donorAv = getDiscordCdnAvatarUrl(d.user?.discordId, d.user?.avatar, 96)
                  return (
                  <div key={d.id} className="glass !bg-white/[0.02] border border-white/5 rounded-3xl p-6 group hover:border-indigo-500/30 transition-all duration-500 shadow-lg">
                    <div className="flex items-center space-x-4 mb-5">
                      {donorAv ? (
                        <img src={donorAv} alt="" className="w-12 h-12 rounded-2xl border border-white/10 group-hover:scale-110 transition-transform" />
                      ) : (
                        <div className="w-12 h-12 bg-indigo-500/10 rounded-2xl border border-indigo-500/20 flex items-center justify-center">
                          <Heart className="h-5 w-5 text-indigo-400 fill-indigo-400" />
                        </div>
                      )}
                      <div>
                        <p className="font-black text-white tracking-tight">{d.user?.username || 'Redacted'}</p>
                        <div className="flex items-center space-x-1 opacity-40">
                           <Clock className="h-3 w-3" />
                           <span className="text-[9px] font-black uppercase tracking-widest">{new Date(d.createdAt).toLocaleDateString()}</span>
                        </div>
                      </div>
                    </div>
                    <div className="p-4 bg-black/40 rounded-2xl border border-white/5 flex items-center space-x-3 group-hover:bg-indigo-500/5 transition-all">
                       <Gamepad2 className="h-5 w-5 text-indigo-500/40 group-hover:text-indigo-400 transition-colors" />
                       <span className="text-xs font-bold text-white/90 truncate">{d.gameName}</span>
                    </div>
                  </div>
                )
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      <footer className="w-full py-16 border-t border-white/5 mt-12 bg-black/40">
        <div className="container mx-auto px-6 text-center space-y-6">
           <div className="flex justify-center flex-wrap gap-8 text-[10px] font-black uppercase tracking-[0.3em] text-muted-foreground">
             <a href="/tos" className="hover:text-white transition-colors">Service Terms</a>
             <a href="/privacy" className="hover:text-white transition-colors">Safety & Privacy</a>
             <a href="/dashboard" className="hover:text-white transition-colors">User Portal</a>
             <a href="https://discord.gg/yKyKhSNGKz" target="_blank" className="text-indigo-400 hover:text-indigo-300 transition-colors">Join Discord</a>
           </div>
           <p className="text-[9px] font-medium tracking-[0.4em] opacity-20 uppercase">Property of OpenSteam Internal Infrastructure • 2026</p>
        </div>
      </footer>
    </div>
  )
}
