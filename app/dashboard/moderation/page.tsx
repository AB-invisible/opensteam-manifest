'use client'

import { useState, useEffect, useRef } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import {
  Send, Bot, Terminal, ShieldAlert, Sparkles, Activity, ArrowLeft,
  RefreshCw, Shield, AlertTriangle, Key, Search, Gavel, Server,
  TrendingUp, Trash2, CheckCircle, Clock
} from 'lucide-react'
import { useToast } from '@/app/components/Toast'

interface Message {
  role: 'user' | 'assistant'
  content: string
  executedTools?: { name: string; args: any }[]
}

interface StatsData {
  activeJailsCount: number
  bannedUsersCount: number
  totalUsersCount: number
  auditLogsCount: number
}

export default function ModerationBotPage() {
  const { data: session, status } = useSession()
  const router = useRouter()
  const { success: toastSuccess, error: toastError } = useToast()

  const [messages, setMessages] = useState<Message[]>([
    {
      role: 'assistant',
      content: "Greetings, Administrator. I am the OpenSteam Moderation Engine — your full-control administrative interface.\n\nI can: **manage users** (ban, role, plan), **query audit logs**, **handle Discord** (DMs, channel posts, guild bans), **send emails**, **manage support tickets**, **trigger maintenance tasks**, **restart the Discord bot**, and provide **real-time system status**.\n\nHow may I assist you today?"
    }
  ])
  const [inputValue, setInputValue] = useState('')
  const [loading, setLoading] = useState(false)
  const [stats, setStats] = useState<StatsData>({
    activeJailsCount: 0,
    bannedUsersCount: 0,
    totalUsersCount: 0,
    auditLogsCount: 0,
  })
  const [statsLoading, setStatsLoading] = useState(true)

  const chatEndRef = useRef<HTMLDivElement>(null)

  // Verify access level (Strictly ADMIN and OWNER)
  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/')
    } else if (status === 'authenticated' && session?.user) {
      const user = session.user as { role?: string }
      if (user.role !== 'ADMIN' && user.role !== 'OWNER') {
        router.push('/dashboard')
      }
    }
  }, [status, session, router])

  // Fetch real-time DB stats on load
  const fetchStats = async () => {
    setStatsLoading(true)
    try {
      const res = await fetch('/api/admin/moderation-bot')
      if (res.ok) {
        const d = await res.json()
        setStats(d)
      }
    } catch (e) {
      console.error('Failed to load stats', e)
    } finally {
      setStatsLoading(false)
    }
  }

  useEffect(() => {
    if (status === 'authenticated') {
      fetchStats()
    }
  }, [status])

  // Scroll to bottom helper
  const scrollToBottom = () => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  useEffect(() => {
    scrollToBottom()
  }, [messages, loading])

  const handleSendMessage = async (text: string) => {
    if (!text.trim() || loading) return

    const userMessage: Message = { role: 'user', content: text }
    setMessages(prev => [...prev, userMessage])
    setInputValue('')
    setLoading(true)

    // Prepare full history for the chatbot
    const formattedHistory = [...messages, userMessage].map(m => ({
      role: m.role,
      content: m.content
    }))

    try {
      const response = await fetch('/api/admin/moderation-bot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: formattedHistory })
      })

      const data = await response.json()

      if (response.ok) {
        setMessages(prev => [...prev, {
          role: 'assistant',
          content: data.reply,
          executedTools: data.executedTools
        }])
        // Reload stats in case moderation actions modified counts
        void fetchStats()
      } else {
        toastError('Engine Error', data.error || 'Failed to process prompt.')
        setMessages(prev => [...prev, {
          role: 'assistant',
          content: `⚠️ Error: ${data.error || 'Failed to process request. Please make sure the Groq API key is correctly configured.'}`
        }])
      }
    } catch (e) {
      toastError('Connection Error', 'Failed to communicate with moderation service.')
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: '⚠️ Error: Network failure or request timeout. Please check your connection and try again.'
      }])
    } finally {
      setLoading(false)
    }
  }

  const handleSuggestionClick = (prompt: string) => {
    void handleSendMessage(prompt)
  }

  // Predefined prompt helper buttons
  const suggestions = [
    "Show me the current system status",
    "List all open support tickets",
    "Are there any active IP jails?",
    "Run cleanup maintenance tasks",
    "Show audit log for today",
    "Ban user from Discord guild",
  ]

  if (status === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Activity className="h-8 w-8 text-indigo-500 animate-spin" />
      </div>
    )
  }

  const user = session?.user as { role?: string, name?: string }
  if (!user || (user.role !== 'ADMIN' && user.role !== 'OWNER')) {
    return null
  }

  return (
    <div className="min-h-screen bg-background relative selection:bg-indigo-500/30">
      <div className="fixed top-[-20%] left-[-10%] w-[50%] h-[50%] rounded-full bg-indigo-500/10 blur-[120px] pointer-events-none" />
      <div className="fixed bottom-[-10%] right-[-5%] w-[30%] h-[30%] rounded-full bg-purple-500/8 blur-[100px] pointer-events-none" />

      {/* Navbar */}
      <nav className="sticky top-0 z-50 glass border-b-white/5 border-t-0 border-x-0 rounded-none w-full">
        <div className="container mx-auto px-6 py-4 flex justify-between items-center">
          <div className="flex items-center space-x-3 cursor-pointer" onClick={() => router.push('/')}>
            <div className="hover:scale-110 transition-transform">
              <img src="/opensteam.png?v=20260810" alt="OpenSteam" className="h-7 w-7" />
            </div>
            <span className="text-xl font-bold text-white hidden sm:block">OpenSteam</span>
          </div>
          <div className="flex items-center space-x-3">
            <button
              onClick={() => router.push('/dashboard')}
              className="flex items-center space-x-2 text-sm font-medium text-white/70 hover:text-white transition-colors"
            >
              <ArrowLeft className="h-4 w-4" />
              <span>Back to Dashboard</span>
            </button>
          </div>
        </div>
      </nav>

      <main className="container mx-auto px-4 md:px-6 py-8 relative z-10 space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 animate-in fade-in slide-in-from-bottom-4">
          <div>
            <h1 className="text-3xl font-extrabold text-white tracking-tight flex items-center space-x-3">
              <Bot className="h-8 w-8 text-indigo-400" />
              <span>Moderation AI Assistant</span>
            </h1>
            <p className="text-muted-foreground text-sm mt-1">
              Natural language administration interface. Execute commands, analyze audit trails, and manage security rates.
            </p>
          </div>
          <div className="flex items-center space-x-2 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 px-3 py-1.5 rounded-full text-xs font-bold uppercase tracking-wider self-start sm:self-center">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
            </span>
            <span>Security Engine: Active</span>
          </div>
        </div>

        {/* Real-time Stats cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 animate-in fade-in slide-in-from-bottom-4 duration-300">
          <StatCard
            icon={<AlertTriangle className="h-5 w-5" />}
            label="Active IP Jails"
            value={statsLoading ? '...' : String(stats.activeJailsCount)}
            color="red"
          />
          <StatCard
            icon={<Gavel className="h-5 w-5" />}
            label="Globally Banned"
            value={statsLoading ? '...' : String(stats.bannedUsersCount)}
            color="purple"
          />
          <StatCard
            icon={<Server className="h-5 w-5" />}
            label="Audit Logs Count"
            value={statsLoading ? '...' : String(stats.auditLogsCount)}
            color="indigo"
          />
          <StatCard
            icon={<Activity className="h-5 w-5" />}
            label="Platform Base"
            value={statsLoading ? '...' : `${stats.totalUsersCount} Users`}
            color="emerald"
          />
        </div>

        {/* Chat Terminal Console */}
        <div className="glass rounded-3xl overflow-hidden border-white/5 flex flex-col h-[650px] shadow-2xl animate-in fade-in slide-in-from-bottom-8 duration-500">
          {/* Console Header */}
          <div className="bg-white/[0.02] px-6 py-4 border-b border-white/5 flex items-center justify-between shrink-0">
            <div className="flex items-center space-x-2.5">
              <Terminal className="h-4.5 w-4.5 text-indigo-400" />
              <span className="text-xs font-bold uppercase tracking-widest text-white/90 font-mono">moderator@opensteam-core-cli</span>
            </div>
            <div className="flex items-center space-x-2">
              <button
                onClick={fetchStats}
                className="p-1.5 text-muted-foreground hover:text-white rounded-lg hover:bg-white/5 transition-all"
                title="Refresh stats"
              >
                <RefreshCw className="h-3.5 w-3.5" />
              </button>
              <div className="flex space-x-1.5">
                <span className="w-3 h-3 rounded-full bg-red-500/40 border border-red-500/20" />
                <span className="w-3 h-3 rounded-full bg-yellow-500/40 border border-yellow-500/20" />
                <span className="w-3 h-3 rounded-full bg-green-500/40 border border-green-500/20" />
              </div>
            </div>
          </div>

          {/* Messages Area */}
          <div className="flex-1 overflow-y-auto px-6 py-6 space-y-5 scrollbar-thin">
            {messages.map((msg, index) => {
              const isAssistant = msg.role === 'assistant'
              return (
                <div key={index} className={`flex ${isAssistant ? 'justify-start' : 'justify-end'} animate-in fade-in duration-200`}>
                  <div className={`flex gap-3 max-w-[85%] ${isAssistant ? 'flex-row' : 'flex-row-reverse'}`}>
                    {/* Avatar */}
                    <div className={`w-8 h-8 rounded-full shrink-0 flex items-center justify-center border ${
                      isAssistant 
                        ? 'bg-indigo-500/10 border-indigo-500/20 text-indigo-400' 
                        : 'bg-white/5 border-white/10 text-white'
                    }`}>
                      {isAssistant ? <Bot className="h-4.5 w-4.5" /> : <Terminal className="h-4 w-4" />}
                    </div>

                    {/* Balloon content */}
                    <div className="space-y-2">
                      <div className={`rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                        isAssistant
                          ? 'bg-white/[0.03] border border-white/5 text-white/90'
                          : 'bg-indigo-600 border border-indigo-500/30 text-white font-medium shadow-md shadow-indigo-950/20'
                      }`}>
                        <div className="whitespace-pre-line font-sans">{msg.content}</div>

                        {/* Tool Executions display */}
                        {isAssistant && msg.executedTools && msg.executedTools.length > 0 && (
                          <div className="mt-3 pt-3 border-t border-white/5 space-y-1.5">
                            <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest flex items-center space-x-1">
                              <Sparkles className="h-3 w-3 text-indigo-400" />
                              <span>Automated Audited Operations:</span>
                            </p>
                            <div className="flex flex-wrap gap-1.5">
                              {msg.executedTools.map((t, idx) => (
                                <span
                                  key={idx}
                                  className="inline-flex items-center space-x-1 text-[10px] font-bold font-mono px-2 py-0.5 rounded-md bg-purple-500/10 text-purple-300 border border-purple-500/20"
                                >
                                  <span>🔧 {t.name}</span>
                                  {t.args && Object.keys(t.args).length > 0 && (
                                    <span className="text-white/40 font-normal">
                                      ({Object.entries(t.args).map(([k, v]) => `${k}:${JSON.stringify(v)}`).join(', ')})
                                    </span>
                                  )}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}

            {loading && (
              <div className="flex justify-start animate-pulse">
                <div className="flex gap-3 max-w-[80%]">
                  <div className="w-8 h-8 rounded-full shrink-0 flex items-center justify-center border bg-indigo-500/10 border-indigo-500/20 text-indigo-400">
                    <Bot className="h-4.5 w-4.5" />
                  </div>
                  <div className="bg-white/[0.03] border border-white/5 rounded-2xl px-5 py-3.5 text-sm text-muted-foreground flex items-center space-x-2">
                    <Activity className="h-4 w-4 text-indigo-400 animate-spin" />
                    <span className="font-mono text-xs">Accessing datastore & executing engine...</span>
                  </div>
                </div>
              </div>
            )}
            <div ref={chatEndRef} />
          </div>

          {/* Quick suggestions shortcuts */}
          {messages.length === 1 && (
            <div className="px-6 py-2 shrink-0 animate-in fade-in duration-500">
              <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-2 font-mono">Suggested commands:</p>
              <div className="flex flex-wrap gap-2">
                {suggestions.map((s, i) => (
                  <button
                    key={i}
                    onClick={() => handleSuggestionClick(s)}
                    className="text-xs font-semibold px-3 py-1.5 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 hover:border-white/20 text-white/80 transition-all font-mono"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Input Panel */}
          <div className="p-4 bg-white/[0.01] border-t border-white/5 shrink-0">
            <form
              onSubmit={(e) => {
                e.preventDefault()
                handleSendMessage(inputValue)
              }}
              className="flex items-center gap-2.5"
            >
              <input
                type="text"
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                disabled={loading}
                placeholder="Ask moderation engine or execute administrative actions (e.g. 'Ban user Bob for abusing API')..."
                className="flex-1 px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-sm text-white placeholder-white/30 outline-none focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/30 transition-all disabled:opacity-50"
              />
              <button
                type="submit"
                disabled={loading || !inputValue.trim()}
                className="p-3 bg-indigo-600 hover:bg-indigo-500 disabled:bg-white/5 disabled:text-white/20 text-white rounded-xl transition-all shadow-lg shadow-indigo-600/10 shrink-0"
              >
                <Send className="h-4.5 w-4.5" />
              </button>
            </form>
          </div>
        </div>
      </main>

      <footer className="w-full py-8 border-t border-white/5 mt-12 flex flex-col items-center space-y-4">
        <div className="flex items-center space-x-6 text-[10px] font-black uppercase tracking-widest text-muted-foreground">
          <a href="/tos" className="hover:text-indigo-400 transition-colors">Terms of Service</a>
          <a href="/privacy" className="hover:text-indigo-400 transition-colors">Privacy Policy</a>
          <a href="https://discord.gg/4RdMhcYws" target="_blank" rel="noopener noreferrer" className="hover:text-[#5865F2] transition-colors">Community Support</a>
        </div>
        <div className="flex items-center space-x-2 text-white/20 text-[10px] font-medium uppercase tracking-[0.2em]">
          <span>© 2026 OpenSteam Internal • Powered by OpenSteam Moderation Engine</span>
        </div>
      </footer>
    </div>
  )
}

// Stats Card helper component
function StatCard({
  icon, label, value, color
}: {
  icon: React.ReactNode; label: string; value: string; color: string
}) {
  const colorMap: Record<string, string> = {
    indigo: 'from-indigo-500/20 to-indigo-500/5 border-indigo-500/20 text-indigo-400',
    purple: 'from-purple-500/20 to-purple-500/5 border-purple-500/20 text-purple-400',
    emerald: 'from-emerald-500/20 to-emerald-500/5 border-emerald-500/20 text-emerald-400',
    red: 'from-red-500/20 to-red-500/5 border-red-500/20 text-red-400',
  }
  const cls = colorMap[color] || colorMap.indigo

  return (
    <div className={`p-5 rounded-2xl border bg-gradient-to-br ${cls} relative overflow-hidden group`}>
      <div className="absolute top-2.5 right-2.5 opacity-10 group-hover:opacity-20 transition-opacity">
        {icon}
      </div>
      <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1">{label}</p>
      <p className="text-2xl font-extrabold text-white tracking-tight">{value}</p>
    </div>
  )
}
