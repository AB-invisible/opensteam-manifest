'use client'

import { 
  ShieldAlert, Users, Layers, Activity, Search, Save, CheckCircle, Smartphone, Gamepad, Key, FileText, Ban, Power, XCircle, Trash2, Eye, ArrowLeft, Gamepad2, Zap,
  Plus, EyeOff, Wifi, KeyRound, ShieldCheck, UserX, UserCheck, Trash, Globe2, LayoutGrid, Database, Bell, MessageSquare, Send, ClipboardList, ExternalLink, ArrowRightLeft, RefreshCw, Gavel, Upload, Monitor, RotateCcw, Gift, Bot, ShoppingCart, Server, Package, Cpu
} from 'lucide-react'
import { useState, useEffect, useRef } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { useToast } from '@/app/components/Toast'
import { APPLICATION_MAX_SCORE, APPLICATION_PASS_SCORE, PLAN_CONFIG } from '@/app/lib/config'
import { getDiscordCdnAvatarUrl } from '@/app/lib/discord-avatar'
import HostedBotAdminPanel from '@/app/admin/components/HostedBotAdminPanel'
import MembersShopPanel from '@/app/admin/components/MembersShopPanel'
import VouchersPanel from '@/app/admin/components/VouchersPanel'
import PlanUpgradePanel from '@/app/admin/components/PlanUpgradePanel'
import ExecutiveReportsPanel from '@/app/admin/components/ExecutiveReportsPanel'
import GenerationsPanel from '@/app/admin/components/GenerationsPanel'
import { TelegramPromosPanel } from '@/app/admin/components/TelegramPromosPanel'
import { VerifySessionsPanel } from '@/app/admin/components/VerifySessionsPanel'
import ModAttemptsTable from '@/app/components/admin/ModAttemptsTable'
import PromoTenureControls from '@/app/components/admin/PromoTenureControls'
import TrialModControls from '@/app/components/admin/TrialModControls'
import {
  VerifyFunnelChart,
  ManifestHealthDonut,
  PlatformHealthDiagram,
  AdminBarChart,
  TrafficHeatmap,
  GenerationAnalyticsChart,
  StorageUsageBar,
} from '@/app/admin/components/AdminCharts'
import { AdminOverviewPanel } from '@/app/admin/components/AdminOverviewPanel'
import { AIDiagnosticsPanel } from '@/app/admin/components/AIDiagnosticsPanel'

function toDatetimeLocalValue(d: Date) {
  const pad = (n: number) => n.toString().padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export default function AdminDashboard() {
  const { data: session, status } = useSession()
  const router = useRouter()
  const { success: toastSuccess, error: toastError } = useToast()

  const [loading, setLoading] = useState(true)
  const [statsRefreshing, setStatsRefreshing] = useState(false)
  const [stats, setStats] = useState<any>(null)
  const [users, setUsers] = useState<any[]>([])
  const [requests, setRequests] = useState<any[]>([])
  const [requestProbeAppId, setRequestProbeAppId] = useState('')
  const [requestProbe, setRequestProbe] = useState<any | null>(null)
  const [requestProbeLoading, setRequestProbeLoading] = useState(false)
  const [requestProbeImporting, setRequestProbeImporting] = useState<'ryuu' | 'morrenus' | null>(null)
  const [requestProbeAvailability, setRequestProbeAvailability] = useState<
    'any' | 'ryuu' | 'morrenus' | 'both' | 'ryuu_only' | 'morrenus_only' | 'either'
  >('either')
  const [jails, setJails] = useState<any[]>([])
  const [blacklist, setBlacklist] = useState<any[]>([])
  const [saving, setSaving] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<'overview' | 'diagnostics' | 'users' | 'requests' | 'keys' | 'logs' | 'firewall' | 'manifests' | 'settings' | 'organizations' | 'notifications' | 'donations' | 'chat' | 'applications' | 'punishments' | 'exe' | 'appeals' | 'tickets' | 'hosted-bots' | 'members-shop' | 'vouchers' | 'plan-upgrade' | 'verify' | 'staff-exams' | 'generations' | 'telegram-promos'>('overview')
  const [tickets, setTickets] = useState<any[]>([])
  const [ticketsLoading, setTicketsLoading] = useState(false)
  const [replyText, setReplyText] = useState('')
  const [selectedTicket, setSelectedTicket] = useState<any | null>(null)
  const [appeals, setAppeals] = useState<any[]>([])
  const [punishments, setPunishments] = useState<any[]>([])
  const [punishmentsLoading, setPunishmentsLoading] = useState(false)
  const [editingPunishment, setEditingPunishment] = useState<any | null>(null)
  const [punishmentForm, setPunishmentForm] = useState<any>({ reason: '', duration: '', proofUrl: '', type: 'WARN', username: '', discordId: '' })
  const [punishmentSearch, setPunishmentSearch] = useState('')
  const [selectedProofUrl, setSelectedProofUrl] = useState<string | null>(null)
  // Manifest sub-tab state
  const [manifests, setManifests] = useState<any[]>([])
  const [manifestPlaceholderCount, setManifestPlaceholderCount] = useState(0)
  const [manifestTotalCount, setManifestTotalCount] = useState(0)
  const [backfillLoading, setBackfillLoading] = useState(false)
  const [organizations, setOrganizations] = useState<any[]>([])
  const [organizationsLoading, setOrganizationsLoading] = useState(false)
  const [manifestPage, setManifestPage] = useState(1)
  const [manifestTotalPages, setManifestTotalPages] = useState(1)
  const [manifestSearch, setManifestSearch] = useState('')
  const [keysCreationEnabled, setKeysCreationEnabled] = useState(true)
  const [generationEnabled, setGenerationEnabled] = useState(true)
  const [registrationEnabled, setRegistrationEnabled] = useState(true)
  const [keys, setKeys] = useState<any[]>([])
  const [logs, setLogs] = useState<any[]>([])
  const [logPage, setLogPage] = useState(1)
  const [logTotalPages, setLogTotalPages] = useState(1)
  const [logFilterKey, setLogFilterKey] = useState<string | null>(null)
  
  // Notification state
  const [notifHistory, setNotifHistory] = useState<any[]>([])
  const [notifLoading, setNotifLoading] = useState(false)
  const [verifyAudits, setVerifyAudits] = useState<any[]>([])
  const [verifySessions, setVerifySessions] = useState<any[]>([])
  const [verifyFunnel, setVerifyFunnel] = useState<any | null>(null)
  const [verifyAuditsLoading, setVerifyAuditsLoading] = useState(false)
  const [verifyBlacklistFriends, setVerifyBlacklistFriends] = useState<any[]>([])
  const [verifyBlacklistGuilds, setVerifyBlacklistGuilds] = useState<any[]>([])
  const [verifyBlacklistFriendId, setVerifyBlacklistFriendId] = useState('')
  const [verifyBlacklistFriendLabel, setVerifyBlacklistFriendLabel] = useState('')
  const [verifyBlacklistFriendReason, setVerifyBlacklistFriendReason] = useState('')
  const [verifyBlacklistGuildId, setVerifyBlacklistGuildId] = useState('')
  const [verifyBlacklistGuildName, setVerifyBlacklistGuildName] = useState('')
  const [verifyBlacklistGuildReason, setVerifyBlacklistGuildReason] = useState('')

  const [auditLogs, setAuditLogs] = useState<any[]>([])
  const [auditPage, setAuditPage] = useState(1)
  const [auditTotalPages, setAuditTotalPages] = useState(1)
  const [logSubTab, setLogSubTab] = useState<'api' | 'audit'>('api')
  
  // Donation state
  const [donations, setDonations] = useState<any[]>([])
  const [donationsLoading, setDonationsLoading] = useState(false)
  
  // Shared Chat State to allow background streaming
  const [chatMessages, setChatMessages] = useState<any[]>([])
  const [chatLoading, setChatLoading] = useState(false)
  const chatEndRef = useRef<HTMLDivElement>(null)

  // Bulk actions & search refs
  const [selectedUsers, setSelectedUsers] = useState<string[]>([])
  const [userSearch, setUserSearch] = useState('')
  const [fingerprintFilter, setFingerprintFilter] = useState('')

  // Custom Modal System
  const [confirmDialog, setConfirmDialog] = useState<{
    open: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
    type?: 'danger' | 'warning' | 'info';
  }>({
    open: false,
    title: '',
    message: '',
    onConfirm: () => {},
  })

  // State to track current user role for Role Isolation
  const [currentUserRole, setCurrentUserRole] = useState<string>('USER')
  const [executiveReportsUser, setExecutiveReportsUser] = useState<{ id: string; username: string } | null>(null)

  // Custom Plan Modal
  const [editingCustomUser, setEditingCustomUser] = useState<any | null>(null)
  const [customForm, setCustomForm] = useState({
    daily: 0,
    minute: 0,
    morrenus: false,
    ryuu: false,
    indefinite: true,
    months: 1,
    expiryDate: '' as string,
  })
  
  // Config state
  const [configs, setConfigs] = useState<any[]>([])
  const [configsLoading, setConfigsLoading] = useState(false)
  const [testEmailLoading, setTestEmailLoading] = useState(false)
  const [botLoading, setBotLoading] = useState(false)
  const [botStatus, setBotStatus] = useState<'IDLE' | 'RUNNING' | 'ERROR'>('IDLE')
  const [failoverStatus, setFailoverStatus] = useState<{
    mode: string
    quarantined: boolean
    activeSource: string
    guildSource?: string
    hasPrimaryToken: boolean
    hasBackupToken: boolean
    backupInviteUrl: string | null
  } | null>(null)
  const [failoverLoading, setFailoverLoading] = useState(false)
  const [adminChecked, setAdminChecked] = useState(false)
  const [showDropModal, setShowDropModal] = useState(false)
  const [dropAmount, setDropAmount] = useState(5)
  const [dropPlatform, setDropPlatform] = useState('steam')
  const [minGamesFilter, setMinGamesFilter] = useState(0)
  const [dropLoading, setDropLoading] = useState(false)
  
  // Applications State
  const [formResponses, setFormResponses] = useState<any[]>([])
  const [formItems, setFormItems] = useState<any[]>([])
  const [formsLoading, setFormsLoading] = useState(false)
  const [gradingModal, setGradingModal] = useState<{ open: boolean, response: any | null }>({ open: false, response: null })
  const [formId, setFormId] = useState('17zWGbRUjIVxZTtha80EfDlDQFqyHZj46xDBBxDTaoGk')
  const [aiGradeLoading, setAiGradeLoading] = useState(false)
  const [aiGradeMeta, setAiGradeMeta] = useState<{ modelLabel?: string } | null>(null)
  const [aiGrades, setAiGrades] = useState<Record<string, { score: number; rationale?: string }>>({})
  const [editingAiScoreId, setEditingAiScoreId] = useState<string | null>(null)

  // Trello State
  const [trelloCards, setTrelloCards] = useState<any[]>([])
  const [trelloLists, setTrelloLists] = useState<any[]>([])
  const [trelloStats, setTrelloStats] = useState<any>(null)
  const [trelloLoading, setTrelloLoading] = useState(false)
  const [trelloError, setTrelloError] = useState<string | null>(null)
  const [broadcastMessage, setBroadcastMessage] = useState('')
  const [broadcastLoading, setBroadcastLoading] = useState(false)
  const [broadcastProgress, setBroadcastProgress] = useState<any>(null)
  const [pullbackUserId, setPullbackUserId] = useState('')
  const [pullbackLoading, setPullbackLoading] = useState(false)

  const [incidentModal, setIncidentModal] = useState<{
    open: boolean;
    title: string;
    message: string;
    description: string;
    type: 'warning' | 'error';
  }>({
    open: false,
    title: '',
    message: '',
    description: '',
    type: 'warning'
  })

  // Exe Sessions State
  const [exeSessions, setExeSessions] = useState<any[]>([])
  const [exeOverview, setExeOverview] = useState<any>(null)
  const [exeLoading, setExeLoading] = useState(false)
  const [exeSearch, setExeSearch] = useState('')
  const [exeOnlineFilter, setExeOnlineFilter] = useState(false)
  const [selectedSession, setSelectedSession] = useState<any | null>(null)
  const [sessionDetailLoading, setSessionDetailLoading] = useState(false)

  useEffect(() => {
    if (status === 'loading') return
    if (!session?.user) {
      router.push('/')
      return
    }

    // Verify access
    fetch('/api/auth/me')
      .then(res => res.json())
      .then(data => {
        const role = data?.user?.role
        if (role !== 'ADMIN' && role !== 'SENIOR_MODERATOR' && role !== 'MODERATOR' && role !== 'TRIAL_MODERATOR' && role !== 'OWNER') {
          alert('Access Denied. You do not have permission.')
          router.push('/')
        } else {
          setCurrentUserRole(role)
          if (role !== 'OWNER') {
            setActiveTab('requests')
          }
          setAdminChecked(true)
          loadInitialData(role)
        }
      })
      .catch(() => router.push('/'))
  }, [session, status, router])

  useEffect(() => {
    if (adminChecked) {
      // 1. Initial load
      const load = async () => {
        setChatLoading(true)
        try {
          const res = await fetch('/api/admin/chat')
          if (res.ok) {
            const d = await res.json()
            setChatMessages(d.messages || [])
          }
        } finally {
          setChatLoading(false)
        }
      }
      load()

      // 2. Real-time stream (Persistent in background once admin is verified)
      let mounted = true
      const setupStream = async () => {
        try {
          const response = await fetch('/api/admin/chat/stream')
          if (!response.ok || !response.body) return

          const reader = response.body.getReader()
          const decoder = new TextDecoder()

          while (mounted) {
            const { value, done } = await reader.read()
            if (done) break
            
            const chunk = decoder.decode(value)
            const lines = chunk.split('\n')
            
            for (const line of lines) {
              if (line.startsWith('data: ')) {
                try {
                  const message = JSON.parse(line.slice(6))
                  setChatMessages(prev => {
                    if (prev.find(m => m.id === message.id)) return prev
                    const existingOptimisticIndex = prev.findIndex(m => m.optimistic && m.userId === message.userId && m.content === message.content)
                    if (existingOptimisticIndex !== -1) {
                      const next = [...prev]
                      next.splice(existingOptimisticIndex, 1, message)
                      return next
                    }
                    return [...prev, message]
                  })
                } catch (e) {}
              }
            }
          }
        } catch (e) {
          if (mounted) setTimeout(setupStream, 500) // Reduced retry delay for "No delays"
        }
      }

      setupStream()
      return () => { mounted = false }
    }
  }, [adminChecked])

  useEffect(() => {
    if (activeTab === 'chat' && chatMessages.length > 0) {
      chatEndRef.current?.scrollIntoView({ behavior: 'auto' }) 
    }
  }, [chatMessages, activeTab])

  useEffect(() => {
    if (activeTab === 'settings') {
      loadConfigs()
    }
  }, [activeTab])

  useEffect(() => {
    let interval: any;
    const checkProgress = async () => {
      try {
        const res = await fetch('/api/admin/bot/broadcast')
        if (res.ok) {
          const d = await res.json()
          setBroadcastProgress(d)
          if (d.status === 'COMPLETED' || d.status === 'IDLE') {
            setBroadcastLoading(false)
            if (interval) clearInterval(interval)
          }
        }
      } catch (e) {}
    }

    if (broadcastLoading || (broadcastProgress && (broadcastProgress.status === 'RUNNING' || broadcastProgress.status === 'WAITING_RATE_LIMIT'))) {
      interval = setInterval(checkProgress, 3000)
    } else {
      // Check once on mount to see if a broadcast is already running
      checkProgress()
    }
    return () => clearInterval(interval)
  }, [broadcastLoading, broadcastProgress?.status])

  const loadInitialData = async (targetRole?: string, silent: boolean = false) => {
    if (!silent && !stats && (!users || users.length === 0)) {
      setLoading(true)
    }
    const role = targetRole || currentUserRole
    const isOwner = role === 'OWNER'
    
    try {
      if (isOwner) {
        const [statsRes, usersRes, reqRes, keysRes, jailRes] = await Promise.all([
          fetch('/api/admin/stats'),
          fetch('/api/admin/users'),
          fetch('/api/admin/requests'),
          fetch('/api/admin/keys'),
          fetch('/api/admin/firewall')
        ])

        if (statsRes.ok) {
          const s = await statsRes.json()
          setStats(s)
          setGenerationEnabled(s.generationEnabled ?? true)
          setRegistrationEnabled(s.registrationEnabled ?? true)
        }
        if (usersRes.ok) setUsers((await usersRes.json()).users || [])
        if (reqRes.ok) setRequests((await reqRes.json()).requests || [])
        if (keysRes.ok) {
          const kd = await keysRes.json()
          setKeys(kd.keys || [])
          setKeysCreationEnabled(kd.creationEnabled ?? true)
        }
        if (jailRes.ok) {
          const d = await jailRes.json()
          setJails(d.jails || [])
          setBlacklist(d.blacklist || [])
        }
      } else {
        const [reqRes] = await Promise.all([
          fetch('/api/admin/requests')
        ])
        if (reqRes.ok) setRequests((await reqRes.json()).requests || [])
      }
      
      if (isOwner || role === 'ADMIN' || role === 'SENIOR_MODERATOR' || role === 'MODERATOR') {
        if (activeTab === 'logs') {
          await loadLogs(1, null)
        }
      }
    } finally {
      setLoading(false)
    }
  }

  const probeRequestCandidate = async (mode: 'appId' | 'random') => {
    const appId = requestProbeAppId.trim()
    if (mode === 'appId' && !appId) {
      toastError('App ID Required', 'Enter a Steam App ID to check.')
      return
    }

    setRequestProbeLoading(true)
    try {
      const query = mode === 'random'
        ? `random=1&availability=${encodeURIComponent(requestProbeAvailability)}`
        : `appId=${encodeURIComponent(appId)}`
      const res = await fetch(`/api/admin/requests/probe?${query}`)
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toastError('Probe Failed', data.error || 'Could not check this App ID.')
        return
      }
      setRequestProbe(data)
      if (data.appId) setRequestProbeAppId(data.appId)
    } finally {
      setRequestProbeLoading(false)
    }
  }

  const importProbeFromProvider = async (source: 'ryuu' | 'morrenus') => {
    if (!requestProbe?.appId) {
      toastError('No App ID', 'Run a probe check first.')
      return
    }
    if (requestProbe.inDatabase) {
      toastError('Already in DB', 'This game is already in the manifest database.')
      return
    }
    if (requestProbe.providers?.[source]?.available !== true) {
      toastError('Not available', `No manifest available from ${source === 'ryuu' ? 'Ryuu' : 'Morrenus'} for this App ID.`)
      return
    }

    setRequestProbeImporting(source)
    try {
      const res = await fetch('/api/admin/requests/probe/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          appId: requestProbe.appId,
          name: requestProbe.name,
          source,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toastError('Import failed', data.error || `Could not import from ${source}.`)
        return
      }
      toastSuccess(
        'Added to database',
        `${data.name || requestProbe.name} (${data.appId}) imported via ${source === 'ryuu' ? 'Ryuu' : 'Morrenus'}.`,
      )
      setRequestProbe((prev: typeof requestProbe) =>
        prev
          ? {
              ...prev,
              inDatabase: true,
              name: data.name || prev.name,
              pendingRequest: data.fulfilledRequestCount > 0 ? null : prev.pendingRequest,
            }
          : prev,
      )
    } finally {
      setRequestProbeImporting(null)
    }
  }

  const loadNotifs = async () => {
    setNotifLoading(true)
    try {
      const res = await fetch('/api/admin/notifications')
      if (res.ok) {
        const d = await res.json()
        setNotifHistory(d.history || [])
      }
    } finally {
      setNotifLoading(false)
    }
  }

  const refreshStats = async () => {
    setStatsRefreshing(true)
    try {
      const res = await fetch('/api/admin/stats')
      if (res.ok) setStats(await res.json())
    } finally {
      setStatsRefreshing(false)
    }
  }

  const navigateFromChart = (
    tab: any,
  ) => {
    setActiveTab(tab)
    if (tab === 'manifests') void reloadTab('manifests')
    if (tab === 'settings' || tab === 'verify') void loadConfigs()
    if (tab === 'hosted-bots') void reloadTab('hosted-bots')
    if (tab === 'logs') void reloadTab('logs')
  }

  const reloadTab = async (tab: string) => {
    if (tab === 'overview') {
      const res = await fetch('/api/admin/stats')
      if (res.ok) setStats(await res.json())
    } else if (tab === 'firewall') {
      const res = await fetch('/api/admin/firewall')
      if (res.ok) {
         const d = await res.json()
         setJails(d.jails || [])
         setBlacklist(d.blacklist || [])
      }
    } else if (tab === 'manifests') {
      const res = await fetch(`/api/admin/manifests?page=${manifestPage}&query=${manifestSearch}`)
      if (res.ok) {
        const d = await res.json()
        setManifests(d.manifests || [])
        setManifestPlaceholderCount(d.placeholderCount ?? 0)
        setManifestTotalCount(d.totalCount ?? 0)
        setManifestTotalPages(d.totalPages || 1)
      }
    } else if (tab === 'requests') {
      const res = await fetch('/api/admin/requests')
      if (res.ok) setRequests((await res.json()).requests || [])
    } else if (tab === 'logs') {
      if (logSubTab === 'api') loadLogs(logPage, logFilterKey)
      else loadAuditLogs(auditPage)
    } else if (tab === 'verify') {
      loadConfigs()
    } else if (tab === 'organizations') {
      loadOrganizations()
    } else if (tab === 'notifications') {
      loadNotifs()
    } else if (tab === 'donations') {
      loadDonations()
    } else if (tab === 'applications') {
      loadApplications()
    } else if (tab === 'exe') {
      loadExeSessions()
    } else if (tab === 'appeals') {
      loadAppeals()
    } else if (tab === 'tickets') {
      loadTickets()
    } else if (tab === 'punishments') {
      loadPunishments()
    } else {
      loadInitialData()
    }
  }

  const loadAppeals = async () => {
    try {
      const res = await fetch('/api/admin/appeals')
      if (res.ok) {
        const data = await res.json()
        setAppeals(data.appeals || [])
      }
    } catch (e) {
      console.error(e)
    }
  }

  const loadPunishments = async () => {
    setPunishmentsLoading(true)
    try {
      const res = await fetch('/api/admin/punishments')
      if (res.ok) {
        const data = await res.json()
        setPunishments(data.punishments || [])
      }
    } catch (e) {
      console.error(e)
    } finally {
      setPunishmentsLoading(false)
    }
  }

  const handleOpenEdit = (p: any) => {
    setEditingPunishment(p)
    setPunishmentForm({
      reason: p.reason || '',
      duration: p.duration || '',
      proofUrl: p.proofUrl || '',
      type: p.type || 'WARN',
      username: p.username || '',
      discordId: p.discordId || ''
    })
  }

  const handleOpenCreate = () => {
    setEditingPunishment('new')
    setPunishmentForm({
      reason: '',
      duration: '',
      proofUrl: '',
      type: 'WARN',
      username: '',
      discordId: ''
    })
  }

  const handleSavePunishment = async () => {
    if (!punishmentForm.reason || !punishmentForm.type) {
      toastError('Missing Fields', 'Reason and Type are required.')
      return
    }

    const isNew = editingPunishment === 'new'
    const url = '/api/admin/punishments'
    const method = isNew ? 'POST' : 'PUT'

    const body = isNew ? {
      username: punishmentForm.username,
      discordId: punishmentForm.discordId,
      type: punishmentForm.type,
      proofUrl: punishmentForm.proofUrl,
      reason: punishmentForm.reason,
      duration: punishmentForm.duration
    } : {
      punishmentId: editingPunishment.id,
      username: punishmentForm.username,
      discordId: punishmentForm.discordId,
      type: punishmentForm.type,
      proofUrl: punishmentForm.proofUrl,
      reason: punishmentForm.reason,
      duration: punishmentForm.duration
    }

    try {
      setSaving('save-punishment')
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      })
      const data = await res.json()
      if (res.ok) {
        toastSuccess('Success', isNew ? 'Punishment logged successfully.' : 'Punishment edited successfully.')
        setEditingPunishment(null)
        loadPunishments()
      } else {
        toastError('Error', data.error || 'Failed to save punishment.')
      }
    } catch (e: any) {
      toastError('Error', e.message || 'An unexpected error occurred.')
    } finally {
      setSaving(null)
    }
  }

  const deletePunishment = (punishmentId: string) => {
    setConfirmDialog({
      open: true,
      title: 'Delete Punishment',
      message: 'Are you sure you want to permanently delete this punishment record? This action will remove it from the on-site list.',
      type: 'danger',
      onConfirm: async () => {
        try {
          const res = await fetch('/api/admin/punishments', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ punishmentId })
          })
          if (res.ok) {
            toastSuccess('Deleted', 'The punishment record has been deleted successfully.')
            loadPunishments()
          } else {
            const data = await res.json()
            toastError('Delete Failed', data.error || 'Failed to delete punishment record.')
          }
        } catch (e: any) {
          toastError('Error', e.message || 'An unexpected error occurred.')
        } finally {
          setConfirmDialog(p => ({ ...p, open: false }))
        }
      }
    })
  }

  const loadExeSessions = async () => {
    setExeLoading(true)
    try {
      const queryParams = new URLSearchParams()
      if (exeSearch) queryParams.set('q', exeSearch)
      if (exeOnlineFilter) queryParams.set('online', 'true')

      const [sessionsRes, overviewRes] = await Promise.all([
        fetch(`/api/admin/sessions?${queryParams.toString()}`),
        fetch('/api/admin/overview')
      ])
      if (sessionsRes.ok) {
        const d = await sessionsRes.json()
        setExeSessions(d.sessions || [])
      }
      if (overviewRes.ok) {
        setExeOverview(await overviewRes.json())
      }
    } finally {
      setExeLoading(false)
    }
  }

  const loadSessionDetails = async (sessionId: string) => {
    setSessionDetailLoading(true)
    try {
      const res = await fetch(`/api/admin/sessions/${sessionId}`)
      if (res.ok) {
        setSelectedSession(await res.json())
      }
    } finally {
      setSessionDetailLoading(false)
    }
  }

  const loadOrganizations = async () => {
    setOrganizationsLoading(true)
    try {
      const res = await fetch('/api/admin/orgs')
      if (res.ok) {
        const d = await res.json()
        setOrganizations(d.organizations || [])
      }
    } finally {
      setOrganizationsLoading(false)
    }
  }

  const updateOrgPlan = async (orgId: string, plan: string) => {
    setSaving(orgId)
    try {
      const res = await fetch('/api/admin/orgs', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orgId, plan })
      })
      if (res.ok) {
        toastSuccess('Plan Updated', 'Organization tier successfully modified.')
        loadOrganizations()
      }
    } finally {
      setSaving(null)
    }
  }

  const loadVerifyBlacklist = async () => {
    const res = await fetch('/api/admin/verify/blacklist')
    if (!res.ok) return
    const data = await res.json()
    setVerifyBlacklistFriends(data.friends || [])
    setVerifyBlacklistGuilds(data.guilds || [])
  }

  const loadConfigs = async () => {
    setConfigsLoading(true)
    try {
      const [res, failoverRes, verifyRes] = await Promise.all([
        fetch('/api/admin/config'),
        fetch('/api/admin/bot/failover'),
        fetch('/api/admin/verify'),
        loadVerifyBlacklist(),
      ])
      if (res.ok) {
        const d = await res.json()
        setConfigs(d.configs || [])
      }
      if (failoverRes.ok) {
        setFailoverStatus(await failoverRes.json())
      }
      if (verifyRes.ok) {
        const vd = await verifyRes.json()
        setVerifySessions(vd.sessions || [])
      }
    } finally {
      setConfigsLoading(false)
    }
  }

  const handleFailoverAction = async (action: string, extra?: Record<string, unknown>) => {
    setFailoverLoading(true)
    try {
      const res = await fetch('/api/admin/bot/failover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...extra }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok) {
        toastSuccess('Failover updated', `Active bot: ${data.activeSource || failoverStatus?.activeSource || 'unknown'}`)
        await loadConfigs()
      } else {
        toastError('Failover error', data.error || 'Request failed')
      }
    } finally {
      setFailoverLoading(false)
    }
  }

  const saveConfig = async (key: string, value: string, isSecret: boolean) => {
    setSaving(key)
    try {
      const res = await fetch('/api/admin/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, value, isSecret })
      })
      if (res.ok) {
        toastSuccess('Config Saved', `Successfully updated ${key}`)
        loadConfigs()
      } else {
        toastError('Config Error', 'Failed to update setting')
      }
    } finally {
      setSaving(null)
    }
  }

  const handleBotAction = async (action: string, status?: string) => {
    setBotLoading(true)
    try {
      const res = await fetch('/api/admin/bot/commands', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, status })
      })
      const data = await res.json()
      if (res.ok) {
        toastSuccess('Bot Action', data.message || `Bot ${status || 'updated'} successfully.`)
        if (status) setBotStatus(status as any)
      } else {
        toastError('Bot Error', data.error || 'Failed to perform action')
      }
    } finally {
      setBotLoading(false)
    }
  }

  const handleBroadcast = async () => {
    if (!broadcastMessage.trim()) return;
    if (!confirm('Are you sure you want to broadcast this message to all registered users and guild members? This cannot be undone.')) return;

    setBroadcastLoading(true)
    try {
      const res = await fetch('/api/admin/bot/broadcast', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: broadcastMessage })
      })
      
      const d = await res.json()
      if (res.ok) {
        toastSuccess('Broadcast Started', d.message)
        setBroadcastMessage('')
      } else {
        toastError('Broadcast Error', d.error || 'Failed to start broadcast.')
      }
    } catch (err: any) {
      toastError('Broadcast Error', err.message || 'Network error.')
    } finally {
      setBroadcastLoading(false)
    }
  }

  const handleClearBroadcast = async () => {
    if (!confirm('Clear the stuck broadcast state? This does not undo messages already sent, but lets you start a new broadcast.')) return

    try {
      const res = await fetch('/api/admin/bot/broadcast?clear=1', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clear: true }),
      })
      const d = await res.json()
      if (res.ok) {
        setBroadcastProgress({ status: 'IDLE', total: 0, current: 0, success: 0, fail: 0 })
        setBroadcastLoading(false)
        toastSuccess('Broadcast Cleared', d.message || 'You can start a new broadcast.')
      } else {
        toastError('Clear Failed', d.error || 'Could not clear broadcast state.')
      }
    } catch (err: any) {
      toastError('Clear Failed', err.message || 'Network error.')
    }
  }

  const handlePullback = async () => {
    const target = pullbackUserId.trim()
    const scopeLabel = target ? `user ${target}` : 'all users with OAuth tokens'
    if (!confirm(`Pull ${scopeLabel} back into the configured Discord server?`)) return

    setPullbackLoading(true)
    try {
      const res = await fetch('/api/admin/bot/pullback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(target ? { userId: target } : {}),
      })
      const data = await res.json()
      if (res.ok) {
        toastSuccess('Pullback Complete', data.message || 'Pullback finished.')
      } else {
        toastError('Pullback Failed', data.error || 'Could not run pullback.')
      }
    } catch (err: any) {
      toastError('Pullback Error', err.message || 'Network error.')
    } finally {
      setPullbackLoading(false)
    }
  }

  const startShadow = async (targetUserId: string) => {
    try {
      const res = await fetch('/api/admin/shadow/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetUserId })
      })
      
      if (res.ok) {
        toastSuccess('Shadow Mode Enabled', 'Assuming user context... Redirecting to dashboard.')
        setTimeout(() => {
          window.location.href = '/dashboard'
        }, 1500)
      } else {
        const d = await res.json()
        toastError('Shadow Mode Failed', d.error || 'Could not initiate shadow session')
      }
    } catch (e) {
      toastError('Error', 'An unexpected network error occurred while starting shadow mode')
    }
  }

  const runBulkAction = async (action: string, value?: string) => {
    if (!selectedUsers.length) return
    if (!confirm(`Perform bulk ${action} on ${selectedUsers.length} users?`)) return

    try {
      const res = await fetch('/api/admin/users/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userIds: selectedUsers, action, value })
      })
      
      if (res.ok) {
        toastSuccess('Bulk Action', `Successfully updated ${selectedUsers.length} users.`)
        setSelectedUsers([])
        router.refresh()
      } else {
        const d = await res.json()
        toastError('Action Failed', d.error || 'Batch update failed')
      }
    } catch (e) {
      toastError('Error', 'An unexpected error occurred')
    }
  }

  const clearJail = async (ip: string) => {
    await fetch('/api/admin/firewall', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ip })
    })
    reloadTab('firewall')
  }

  const loadLogs = async (page: number, keyId: string | null) => {
    let url = `/api/admin/logs?page=${page}&limit=50`
    if (keyId) url += `&keyId=${keyId}`
    const logsRes = await fetch(url)
    if (logsRes.ok) {
      const data = await logsRes.json()
      setLogs(data.logs || [])
      setLogPage(data.page)
      setLogTotalPages(data.totalPages)
    }
  }

  const loadTickets = async () => {
    setTicketsLoading(true)
    try {
      const res = await fetch('/api/admin/support')
      if (res.ok) {
        const d = await res.json()
        setTickets(d.tickets || [])
      }
    } finally {
      setTicketsLoading(false)
    }
  }

  const handleReplyTicket = async (close: boolean = false) => {
    if (!selectedTicket || !replyText.trim()) return
    
    setSaving(selectedTicket.id)
    try {
      const res = await fetch('/api/admin/support', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ticketId: selectedTicket.id,
          reply: replyText,
          close
        })
      })
      
      if (res.ok) {
        toastSuccess('Reply Sent', 'Your response has been delivered to the user.')
        setReplyText('')
        
        // Refetch tickets and update both tickets list and selected ticket to stay in the view
        const refetchRes = await fetch('/api/admin/support')
        if (refetchRes.ok) {
          const d = await refetchRes.json()
          const updatedTickets = d.tickets || []
          setTickets(updatedTickets)
          const updatedSel = updatedTickets.find((t: any) => t.id === selectedTicket.id)
          if (updatedSel) {
            setSelectedTicket(updatedSel)
          } else {
            setSelectedTicket(null)
          }
        } else {
          loadTickets()
          setSelectedTicket(null)
        }
      } else {
        toastError('Reply Failed', 'Could not deliver response.')
      }
    } finally {
      setSaving(null)
    }
  }

  const refreshTicketStatus = async (ticketId: string) => {
    try {
      const res = await fetch(`/api/admin/support?id=${ticketId}&refresh=true`)
      if (res.ok) {
        const d = await res.json()
        if (d.resendStatus) {
          toastSuccess('Status Updated', `Latest delivery status: ${d.resendStatus.toUpperCase()}`)
          // Update local state if needed
          setTickets(prev => prev.map(t => t.id === ticketId ? { ...t, resendStatus: d.resendStatus } : t))
          if (selectedTicket?.id === ticketId) {
            setSelectedTicket({ ...selectedTicket, resendStatus: d.resendStatus })
          }
        }
      }
    } catch (e) {
      toastError('Refresh Failed', 'Could not fetch status from Resend.')
    }
  }

  const loadAuditLogs = async (page: number) => {
    const logsRes = await fetch(`/api/admin/audit?page=${page}&limit=50`)
    if (logsRes.ok) {
      const data = await logsRes.json()
      setAuditLogs(data.logs || [])
      setAuditPage(data.page)
      setAuditTotalPages(data.totalPages)
    }
  }


  const toggleKeyEnabled = async (keyId: string, currentState: boolean) => {
    setSaving(keyId)
    await fetch('/api/admin/keys', { 
      method: 'PUT', 
      headers: { 'Content-Type': 'application/json' }, 
      body: JSON.stringify({ keyId, enabled: !currentState }) 
    })
    loadInitialData()
    setSaving(null)
  }

  const deleteKey = async (keyId: string) => {
    setConfirmDialog({
      open: true,
      title: 'Revoke API Key',
      message: 'Are you REALLY sure you want to permanently delete this API Key? This action is irreversible and all services using this key will immediately lose access.',
      type: 'danger',
      onConfirm: async () => {
        setSaving(keyId)
        await fetch('/api/admin/keys', { 
          method: 'DELETE', 
          headers: { 'Content-Type': 'application/json' }, 
          body: JSON.stringify({ keyId }) 
        })
        loadInitialData()
        setSaving(null)
        setConfirmDialog(p => ({ ...p, open: false }))
      }
    })
  }

  const getMethodColor = (m: string) => {
    if (m === 'GET') return 'text-emerald-400 bg-emerald-400/10'
    if (m === 'POST') return 'text-blue-400 bg-blue-400/10'
    if (m === 'PUT') return 'text-amber-400 bg-amber-400/10'
    if (m === 'DELETE') return 'text-red-400 bg-red-400/10'
    return 'text-gray-400 bg-gray-400/10'
  }
  
  const getStatusColor = (s: number) => {
    if (s >= 200 && s < 300) return 'text-emerald-400 bg-emerald-400/10 border-emerald-400/20'
    if (s >= 300 && s < 400) return 'text-blue-400 bg-blue-400/10 border-blue-400/20'
    if (s >= 400 && s < 500) return 'text-amber-400 bg-amber-400/10 border-amber-400/20'
    return 'text-red-400 bg-red-400/10 border-red-400/20'
  }

  const updateUser = async (userId: string, data: any) => {
    setSaving(userId)
    try {
      await fetch('/api/admin/users', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, ...data })
      })
      loadInitialData() // refresh list
    } finally {
      setTimeout(() => setSaving(null), 1000)
    }
  }

  const submitIncident = async () => {
    setSaving('push-incident')
    try {
      const res = await fetch('/api/admin/notifications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          title: incidentModal.title, 
          message: incidentModal.message, 
          description: incidentModal.description, 
          type: incidentModal.type, 
          broadcast: false, 
          active:true 
        })
      })
      if (res.ok) {
        toastSuccess('Incident Pushed', 'The incident is now live on the public status page.')
        setIncidentModal(p => ({ ...p, open: false }))
        if (activeTab === 'notifications') loadNotifs()
      }
    } finally {
      setSaving(null)
    }
  }

  const blacklistIp = async (ip: string, reason: string) => {
    await fetch('/api/admin/firewall', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ip, reason })
    })
    reloadTab('firewall')
  }

  const removeBlacklist = async (ip: string) => {
    await fetch('/api/admin/firewall?permanent=true', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ip })
    })
    reloadTab('firewall')
  }

  const bulkBan = async () => {
    setConfirmDialog({
      open: true,
      title: 'Bulk Action Required',
      message: `Are you sure you want to ban ${selectedUsers.length} users? This will block their access immediately across all systems.`,
      type: 'danger',
      onConfirm: async () => {
        setSaving('bulk')
        try {
          for (const uid of selectedUsers) {
            await fetch('/api/admin/users', {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ userId: uid, isBanned: true })
            })
          }
          setSelectedUsers([])
          loadInitialData()
        } finally {
          setSaving(null)
          setConfirmDialog(p => ({ ...p, open: false }))
        }
      }
    })
  }

  const loadDonations = async () => {
    setDonationsLoading(true)
    try {
      const res = await fetch('/api/admin/donations')
      if (res.ok) {
        const d = await res.json()
        setDonations(d.donations || [])
      }
    } finally {
      setDonationsLoading(false)
    }
  }

  const updateDonationStatus = async (id: string, status: string) => {
    setSaving(id)
    try {
      const res = await fetch('/api/admin/donations', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, status })
      })
      if (res.ok) {
        toastSuccess('Donation Updated', `Status changed to ${status}`)
        loadDonations()
      }
    } finally {
      setSaving(null)
    }
  }

  const deleteDonation = async (id: string) => {
    if (!confirm('Are you sure you want to delete this donation record?')) return
    setSaving(id)
    try {
      const res = await fetch(`/api/admin/donations?id=${id}`, {
        method: 'DELETE'
      })
      if (res.ok) {
        toastSuccess('Donation Deleted', 'Record removed successfully.')
        loadDonations()
      }
    } finally {
      setSaving(null)
    }
  }

  const loadApplications = async () => {
    setFormsLoading(true)
    try {
      const res = await fetch(`/api/admin/forms/responses?formId=${formId}`)
      if (res.ok) {
        const d = await res.json()
        setFormResponses(d.responses || [])
        setFormItems(d.items || [])
      } else {
        const d = await res.json()
        toastError('Forms Error', d.error || 'Failed to fetch responses.')
      }
    } finally {
      setFormsLoading(false)
    }
  }

  const loadTrelloData = async () => {
    setTrelloLoading(true)
    setTrelloError(null)
    try {
      const res = await fetch(`/api/admin/trello?_t=${Date.now()}`)
      if (res.ok) {
        const d = await res.json()
        setTrelloCards(d.cards || [])
        setTrelloLists(d.lists || [])
        setTrelloStats(d.stats || null)
      } else {
        const d = await res.json()
        setTrelloError(d.error || 'Failed to sync with Trello.')
      }
    } catch (err: any) {
      setTrelloError(err.message || 'Network error connecting to Trello.')
    } finally {
      setTrelloLoading(false)
    }
  }

  const trelloMoveCard = async (cardId: string, listId: string, cardName: string) => {
    setSaving('trello-move')
    try {
      const res = await fetch('/api/admin/trello', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'moveCard', cardId, listId, cardName })
      })
      if (res.ok) {
        toastSuccess('Card Moved', `"${cardName}" has been relocated on Trello.`)
        loadTrelloData()
      } else {
        const d = await res.json()
        toastError('Trello Error', d.error || 'Failed to move card.')
      }
    } finally {
      setSaving(null)
    }
  }

  const syncFormsToTrello = async () => {
    setTrelloLoading(true)
    setTrelloError(null)
    try {
      const res = await fetch('/api/admin/trello', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'syncForms' })
      })
      if (res.ok) {
        const d = await res.json()
        toastSuccess('Trello Pushed', `Successfully pushed ${d.count} applications to Trello.`)
        loadTrelloData()
      } else {
        const d = await res.json()
        setTrelloError(d.error || 'Failed to push forms to Trello.')
        toastError('Trello Error', d.error || 'Failed to push forms to Trello.')
      }
    } catch (err: any) {
      setTrelloError(err.message || 'Network error.')
    } finally {
      setTrelloLoading(false)
    }
  }

  const submitGrade = async (gradeData: { responseId: string, discordUserId: string, score: string, feedback: string, username: string }) => {
    setSaving('grading')
    try {
      const res = await fetch('/api/admin/forms/grade', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(gradeData)
      })
      if (res.ok) {
        const d = await res.json()
        const trelloOk = d.trelloSynced !== false
        toastSuccess(
          'Grading Released',
          trelloOk
            ? 'Results sent to Discord and the application list was updated.'
            : `Discord message sent, but Trello did not update: ${d.trelloError || 'check API credentials and list names (Approved / Rejected).'}`,
        )
        setGradingModal({ open: false, response: null })
        setAiGrades({})
        setAiGradeMeta(null)
        setEditingAiScoreId(null)
        await loadApplications()
      } else {
        const d = await res.json()
        toastError('Grading Error', d.error || 'Failed to release results.')
      }
    } finally {
      setSaving(null)
    }
  }

  const runAiPregrade = async () => {
    if (!gradingModal.response) return
    setAiGradeLoading(true)
    try {
      const answersOrdered = Array.isArray(gradingModal.response.answersOrdered)
        ? gradingModal.response.answersOrdered
        : Object.entries(gradingModal.response.answers || {}).map(([title, value]: [any, any]) => ({
            questionId: String(title),
            title,
            value,
          }))

      const res = await fetch('/api/admin/forms/ai-grade', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answersOrdered }),
      })

      const d = await res.json()
      if (!res.ok) {
        toastError('AI Grading Error', d.error || 'Failed to run AI pre-grade.')
        return
      }

      const next: Record<string, { score: number; rationale?: string }> = {}
      for (const g of (d.grades || []) as any[]) {
        if (!g?.questionId) continue
        next[String(g.questionId)] = { score: Number(g.score) || 0, rationale: g.rationale || '' }
      }
      setAiGrades(next)
      setAiGradeMeta({ modelLabel: d.modelLabel })
      toastSuccess('AI Pre-grade Ready', 'Per-question scores were generated (double-click to edit).')
    } catch (e: any) {
      toastError('AI Grading Error', e?.message || 'Failed to run AI pre-grade.')
    } finally {
      setAiGradeLoading(false)
    }
  }

  const handleAppealAction = async (logId: string, actionType: 'ACCEPT' | 'DECLINE') => {
    setSaving(logId)
    try {
      const res = await fetch('/api/admin/appeals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ logId, actionType })
      })
      if (res.ok) {
        toastSuccess(`Appeal ${actionType === 'ACCEPT' ? 'Accepted' : 'Declined'}`, `The user has been notified of the outcome.`);
        loadAppeals()
      } else {
        const d = await res.json()
        toastError('Operation Failed', d.error || 'Failed to process appeal.')
      }
    } finally {
      setSaving(null)
    }
  }

  const handleTestEmail = async () => {
    setTestEmailLoading(true)
    try {
      const res = await fetch('/api/admin/config/test-email', { method: 'POST' })
      const d = await res.json()
      if (res.ok) {
        toastSuccess('Test Email Sent', d.message)
      } else {
        toastError('Test Failed', d.error || 'Failed to trigger test email.')
      }
    } catch (err: any) {
      toastError('Error', err.message || 'Network error')
    } finally {
      setTestEmailLoading(false)
    }
  }

  const filteredPunishments = punishments.filter(p => {
    const s = punishmentSearch.toLowerCase()
    return (
      (p.username && p.username.toLowerCase().includes(s)) ||
      (p.discordId && p.discordId.includes(s)) ||
      (p.reason && p.reason.toLowerCase().includes(s)) ||
      (p.moderatorName && p.moderatorName.toLowerCase().includes(s))
    )
  })

  const filteredUsers = users.filter(u => {
    if (!u?.username) return false
    const s = userSearch.toLowerCase()
    const matchesSearch = u.username.toLowerCase().includes(s) || u.discordId.includes(s) || (u.country && u.country.toLowerCase().includes(s))
    const matchesFingerprint = !fingerprintFilter || u.fingerprint?.includes(fingerprintFilter)
    return matchesSearch && matchesFingerprint
  })

  if (!adminChecked) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background text-white flex-col space-y-4">
        <ShieldAlert className="h-12 w-12 text-indigo-500 animate-pulse" />
        <p className="text-xl font-medium tracking-tight">Verifying credentials...</p>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background relative selection:bg-indigo-500/30">
      <div className="fixed top-[-20%] right-[-10%] w-[50%] h-[50%] rounded-full bg-red-500/5 blur-[120px] pointer-events-none" />

      {/* Navbar */}
      <nav className="sticky top-0 z-50 glass border-b-white/5 border-t-0 border-x-0 rounded-none w-full">
        <div className="container mx-auto px-6 py-4 flex justify-between items-center">
          <div className="flex items-center space-x-3 cursor-pointer" onClick={() => router.push('/')}>
            <div className="hover:scale-110 transition-transform">
              <img src="/opensteam.png" alt="OpenSteam" className="h-8 w-8 rounded-full object-contain ring-1 ring-cyan-400/30" />
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

      <main className="w-full max-w-[100vw] px-4 md:px-6 py-12 relative z-10 flex flex-col items-center overflow-x-hidden">

        <div className="w-full max-w-6xl flex items-center space-x-4 mb-10 overflow-hidden">
          <div className="p-3 bg-red-500/10 rounded-xl text-red-500 border border-red-500/20">
            <ShieldAlert className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-white">Security Command Center</h1>
            <p className="text-muted-foreground">Manage user plans, rate limits, and system roles.</p>
          </div>
        </div>

        <div className="w-full max-w-6xl glass rounded-3xl p-4 sm:p-10 shadow-2xl relative overflow-hidden">

          <div className="flex items-center justify-between mb-8 border-b border-white/5 pb-6">
            <div className="flex items-center space-x-2 text-white font-semibold text-lg overflow-x-auto pb-2 w-full">
              {currentUserRole === 'OWNER' && (
                <button
                  onClick={() => setActiveTab('overview')}
                  className={`px-4 py-2 rounded-xl transition-all flex items-center space-x-2 ${activeTab === 'overview' ? 'bg-indigo-500 text-white' : 'hover:bg-white/10 text-muted-foreground hover:text-white'}`}
                >
                  <Activity className="h-5 w-5" />
                  <span>Overview</span>
                </button>
              )}
              {currentUserRole === 'OWNER' && (
                <button
                  onClick={() => setActiveTab('diagnostics')}
                  className={`px-4 py-2 rounded-xl transition-all flex items-center space-x-2 ${activeTab === 'diagnostics' ? 'bg-indigo-500 text-white' : 'hover:bg-white/10 text-muted-foreground hover:text-white'}`}
                >
                  <Cpu className="h-5 w-5" />
                  <span>AI Diagnostics</span>
                </button>
              )}
              {currentUserRole === 'OWNER' && (
                <button
                  onClick={() => setActiveTab('users')}
                  className={`px-4 py-2 rounded-xl transition-all flex items-center space-x-2 ${activeTab === 'users' ? 'bg-indigo-500 text-white' : 'hover:bg-white/10 text-muted-foreground hover:text-white'}`}
                >
                  <Users className="h-5 w-5" />
                  <span>Accounts</span>
                  <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-white/20 text-white ml-2">
                    {users.length}
                  </span>
                </button>
              )}
              {currentUserRole === 'OWNER' && (
                <button
                  onClick={() => { setActiveTab('organizations'); loadOrganizations(); }}
                  className={`px-4 py-2 rounded-xl transition-all flex items-center space-x-2 ${activeTab === 'organizations' ? 'bg-indigo-500 text-white' : 'hover:bg-white/10 text-muted-foreground hover:text-white'}`}
                >
                  <Users className="h-5 w-5" />
                  <span>Teams</span>
                </button>
              )}
              {currentUserRole === 'OWNER' && (
                <button
                  onClick={() => { setActiveTab('firewall'); reloadTab('firewall'); }}
                  className={`px-4 py-2 rounded-xl transition-all flex items-center space-x-2 ${activeTab === 'firewall' ? 'bg-indigo-500 text-white' : 'hover:bg-white/10 text-muted-foreground hover:text-white'}`}
                >
                  <ShieldAlert className="h-5 w-5" />
                  <span>Firewall</span>
                  {jails.length > 0 && (
                    <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-red-500 text-white ml-2">
                      {jails.length}
                    </span>
                  )}
                </button>
              )}
              {currentUserRole === 'OWNER' && (
                <button
                  onClick={() => setActiveTab('keys')}
                  className={`px-4 py-2 rounded-xl transition-all flex items-center space-x-2 ${activeTab === 'keys' ? 'bg-indigo-500 text-white' : 'hover:bg-white/10 text-muted-foreground hover:text-white'}`}
                >
                  <Key className="h-5 w-5" />
                  <span>Global Keys</span>
                  <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-white/20 text-white ml-2">
                    {keys.length}
                  </span>
                </button>
              )}
              {(currentUserRole === 'OWNER' || currentUserRole === 'ADMIN' || currentUserRole === 'SENIOR_MODERATOR' || currentUserRole === 'MODERATOR') && (
                <button
                  onClick={() => { setActiveTab('logs'); reloadTab('logs'); }}
                  className={`px-4 py-2 rounded-xl transition-all flex items-center space-x-2 ${activeTab === 'logs' ? 'bg-indigo-500 text-white' : 'hover:bg-white/10 text-muted-foreground hover:text-white'}`}
                >
                  <FileText className="h-5 w-5" />
                  <span>Live Logs</span>
                </button>
              )}
              {currentUserRole === 'OWNER' && (
                <>
                <button
                  onClick={() => setActiveTab('generations')}
                  className={`px-4 py-2 rounded-xl transition-all flex items-center space-x-2 ${activeTab === 'generations' ? 'bg-indigo-500 text-white' : 'hover:bg-white/10 text-muted-foreground hover:text-white'}`}
                >
                  <Activity className="h-5 w-5" />
                  <span>Generations</span>
                </button>

                <button
                  onClick={() => setActiveTab('telegram-promos')}
                  className={`px-4 py-2 rounded-xl transition-all flex items-center space-x-2 ${activeTab === 'telegram-promos' ? 'bg-indigo-500 text-white' : 'hover:bg-white/10 text-muted-foreground hover:text-white'}`}
                >
                  <MessageSquare className="h-5 w-5" />
                  <span>TG Promos</span>
                </button>

                <button
                  onClick={() => { setActiveTab('manifests'); reloadTab('manifests'); }}
                  className={`px-4 py-2 rounded-xl transition-all flex items-center space-x-2 ${activeTab === 'manifests' ? 'bg-indigo-500 text-white' : 'hover:bg-white/10 text-muted-foreground hover:text-white'}`}
                >
                  <Database className="h-5 w-5" />
                  <span>Database</span>
                </button>
                </>
              )}
                <button
                  onClick={() => setActiveTab('requests')}
                  className={`px-4 py-2 rounded-xl transition-all flex items-center space-x-2 ${activeTab === 'requests' ? 'bg-indigo-500 text-white' : 'hover:bg-white/10 text-muted-foreground hover:text-white'}`}
                >
                  <img src="/favicon.ico" alt="" className="h-4 w-4 grayscale brightness-200" />
                  <span>Game Requests</span>
                  {requests.filter(r => r.status === 'PENDING').length > 0 && (
                    <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-amber-500 text-white ml-2">
                      {requests.filter(r => r.status === 'PENDING').length}
                    </span>
                  )}
                </button>
                <button
                  onClick={() => { setActiveTab('tickets'); loadTickets(); }}
                  className={`px-4 py-2 rounded-xl transition-all flex items-center space-x-2 ${activeTab === 'tickets' ? 'bg-indigo-500 text-white' : 'hover:bg-white/10 text-muted-foreground hover:text-white'}`}
                >
                  <MessageSquare className="h-5 w-5" />
                  <span>Tickets</span>
                  {tickets.filter(t => t.status === 'OPEN').length > 0 && (
                    <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-indigo-400 text-white ml-2">
                      {tickets.filter(t => t.status === 'OPEN').length}
                    </span>
                  )}
                </button>
              {(currentUserRole === 'OWNER' || currentUserRole === 'ADMIN') && (
                <button
                  onClick={() => { setActiveTab('notifications'); loadNotifs(); }}
                  className={`px-4 py-2 rounded-xl transition-all flex items-center space-x-2 ${activeTab === 'notifications' ? 'bg-indigo-500 text-white' : 'hover:bg-white/10 text-muted-foreground hover:text-white'}`}
                >
                  <Bell className="h-5 w-5" />
                  <span>Alerts</span>
                </button>
              )}
              <button
                onClick={() => { setActiveTab('donations'); loadDonations(); }}
                className={`px-4 py-2 rounded-xl transition-all flex items-center space-x-2 ${activeTab === 'donations' ? 'bg-indigo-500 text-white' : 'hover:bg-white/10 text-muted-foreground hover:text-white'}`}
              >
                <Gamepad2 className="h-5 w-5" />
                <span>Donations</span>
                {donations.filter(d => d.status === 'PENDING').length > 0 && (
                  <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-amber-500 text-white ml-2">
                    {donations.filter(d => d.status === 'PENDING').length}
                  </span>
                )}
              </button>
              <button
                onClick={() => { setActiveTab('applications'); loadApplications(); }}
                className={`px-4 py-2 rounded-xl transition-all flex items-center space-x-2 ${activeTab === 'applications' ? 'bg-indigo-500 text-white' : 'hover:bg-white/10 text-muted-foreground hover:text-white'}`}
              >
                <ClipboardList className="h-5 w-5" />
                <span>Applications</span>
              </button>
              <button
                onClick={() => { setActiveTab('staff-exams'); }}
                className={`px-4 py-2 rounded-xl transition-all flex items-center space-x-2 ${activeTab === 'staff-exams' ? 'bg-indigo-500 text-white' : 'hover:bg-white/10 text-muted-foreground hover:text-white'}`}
              >
                <ShieldCheck className="h-5 w-5" />
                <span>Staff Exams</span>
              </button>
              <button
                onClick={() => { setActiveTab('appeals'); loadAppeals(); }}
                className={`px-4 py-2 rounded-xl transition-all flex items-center space-x-2 ${activeTab === 'appeals' ? 'bg-indigo-500 text-white' : 'hover:bg-white/10 text-muted-foreground hover:text-white'}`}
              >
                <Gavel className="h-5 w-5" />
                <span>Appeals</span>
                {appeals.filter(a => a.action === 'APPEAL_SUBMITTED').length > 0 && (
                  <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-amber-500 text-white ml-2">
                    {appeals.filter(a => a.action === 'APPEAL_SUBMITTED').length}
                  </span>
                )}
              </button>
              <button
                onClick={() => { setActiveTab('punishments'); loadPunishments(); }}
                className={`px-4 py-2 rounded-xl transition-all flex items-center space-x-2 ${activeTab === 'punishments' ? 'bg-indigo-500 text-white' : 'hover:bg-white/10 text-muted-foreground hover:text-white'}`}
              >
                <ShieldAlert className="h-5 w-5" />
                <span>Punishments</span>
              </button>
              {currentUserRole === 'OWNER' && (
                <button
                  onClick={() => setActiveTab('hosted-bots')}
                  className={`px-4 py-2 rounded-xl transition-all flex items-center space-x-2 ${activeTab === 'hosted-bots' ? 'bg-emerald-600 text-white' : 'hover:bg-white/10 text-muted-foreground hover:text-white'}`}
                >
                  <Bot className="h-5 w-5" />
                  <span>Hosted Bots</span>
                </button>
              )}
              {currentUserRole === 'OWNER' && (
                <button
                  onClick={() => setActiveTab('members-shop')}
                  className={`px-4 py-2 rounded-xl transition-all flex items-center space-x-2 ${activeTab === 'members-shop' ? 'bg-emerald-600 text-white' : 'hover:bg-white/10 text-muted-foreground hover:text-white'}`}
                >
                  <ShoppingCart className="h-5 w-5" />
                  <span>Members Shop</span>
                </button>
              )}
              {currentUserRole === 'OWNER' && (
                <button
                  onClick={() => setActiveTab('vouchers')}
                  className={`px-4 py-2 rounded-xl transition-all flex items-center space-x-2 ${activeTab === 'vouchers' ? 'bg-amber-600 text-white' : 'hover:bg-white/10 text-muted-foreground hover:text-white'}`}
                >
                  <Gift className="h-5 w-5" />
                  <span>Vouchers</span>
                </button>
              )}
              {currentUserRole === 'OWNER' && (
                <button
                  onClick={() => setActiveTab('plan-upgrade')}
                  className={`px-4 py-2 rounded-xl transition-all flex items-center space-x-2 ${activeTab === 'plan-upgrade' ? 'bg-emerald-600 text-white' : 'hover:bg-white/10 text-muted-foreground hover:text-white'}`}
                >
                  <ArrowRightLeft className="h-5 w-5" />
                  <span>Plan Upgrade</span>
                </button>
              )}
              {currentUserRole === 'OWNER' && (
                <>
                  <button
                    onClick={() => { setActiveTab('verify'); loadConfigs(); }}
                    className={`px-4 py-2 rounded-xl transition-all flex items-center space-x-2 ${activeTab === 'verify' ? 'bg-indigo-500 text-white' : 'hover:bg-white/10 text-muted-foreground hover:text-white'}`}
                  >
                    <UserCheck className="h-5 w-5" />
                    <span>Verification</span>
                  </button>
                  <button
                    onClick={() => { setActiveTab('settings'); loadConfigs(); }}
                    className={`px-4 py-2 rounded-xl transition-all flex items-center space-x-2 ${activeTab === 'settings' ? 'bg-indigo-500 text-white' : 'hover:bg-white/10 text-muted-foreground hover:text-white'}`}
                  >
                    <LayoutGrid className="h-5 w-5" />
                    <span>Settings</span>
                  </button>
                </>
              )}
              <button
                onClick={() => { setActiveTab('chat'); }}
                className={`px-4 py-2 rounded-xl transition-all flex items-center space-x-2 ${activeTab === 'chat' ? 'bg-indigo-500 text-white' : 'hover:bg-white/10 text-muted-foreground hover:text-white'}`}
              >
                <MessageSquare className="h-4 w-4" />
                <span className="text-xs font-bold uppercase tracking-wider">Staff Chat</span>
              </button>

              <button 
                onClick={() => { setActiveTab('exe'); loadExeSessions(); }}
                className={`px-4 py-2 rounded-xl transition-all flex items-center space-x-2 ${activeTab === 'exe' ? 'bg-indigo-500 text-white' : 'hover:bg-white/10 text-muted-foreground hover:text-white'}`}
              >
                <Monitor className="h-4 w-4" />
                <span className="text-xs font-bold uppercase tracking-wider">Exe Sessions</span>
              </button>
            </div>
          </div>

          <div className="overflow-x-auto w-full relative">
            {loading && (
              <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-indigo-500 via-purple-500 to-emerald-500 animate-pulse rounded-full z-30" />
            )}
              {activeTab === 'overview' ? (
                <AdminOverviewPanel
                  stats={stats}
                  users={users}
                  jails={jails}
                  blacklist={blacklist}
                  refreshStats={refreshStats}
                  statsRefreshing={statsRefreshing}
                  navigateFromChart={navigateFromChart}
                  reloadTab={reloadTab}
                />
              ) : activeTab === 'diagnostics' ? (
                <AIDiagnosticsPanel onNavigateTab={(t: any) => setActiveTab(t)} />
              ) : activeTab === 'users' ? (
                <div className="space-y-6">
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div className="relative flex-1 group">
                      <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground group-focus-within:text-indigo-400 transition-colors" />
                      <input 
                        type="text" 
                        placeholder="Search users by name, ID or fingerprint..." 
                        value={userSearch}
                        onChange={(e) => setUserSearch(e.target.value)}
                        className="w-full bg-white/5 border border-white/10 rounded-2xl py-3 pl-12 pr-4 text-sm text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/50 transition-all"
                      />
                    </div>
                    
                    {selectedUsers.length > 0 && (
                      <div className="flex items-center space-x-3 animate-in slide-in-from-right-4">
                        <span className="text-xs font-bold text-indigo-300 bg-indigo-500/10 px-3 py-2 rounded-xl border border-indigo-500/20">
                          {selectedUsers.length} Selected
                        </span>
                        
                        <button 
                          onClick={bulkBan}
                          className="px-4 py-2 bg-red-500 hover:bg-red-600 text-white text-xs font-black uppercase tracking-widest rounded-xl transition-all shadow-lg shadow-red-500/20 active:scale-95 flex items-center space-x-2"
                        >
                          <Ban className="h-4 w-4" />
                          <span>Ban All</span>
                        </button>
                        
                        <button 
                          onClick={() => {
                            const plan = prompt('Enter Plan (FREE, REGULAR, PREMIUM, BUSINESS, RESELLER, CUSTOM):')
                            if (plan) runBulkAction('PLAN', plan.toUpperCase())
                          }}
                          className="px-4 py-2 bg-indigo-500 hover:bg-indigo-600 text-white text-xs font-black uppercase tracking-widest rounded-xl transition-all shadow-lg shadow-indigo-500/20 active:scale-95 flex items-center space-x-2"
                        >
                          <Layers className="h-4 w-4" />
                          <span>Set Plan</span>
                        </button>

                        <button 
                          onClick={() => runBulkAction('CLEAR_RISK')}
                          className="px-4 py-2 bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-black uppercase tracking-widest rounded-xl transition-all shadow-lg shadow-emerald-500/20 active:scale-95 flex items-center space-x-2"
                        >
                          <ShieldCheck className="h-4 w-4" />
                          <span>Clear Risk</span>
                        </button>
                      </div>
                    )}
                  </div>

                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-white/10 text-[10px] uppercase tracking-widest text-muted-foreground font-black">
                        <th className="pb-4 px-4 w-10">
                          <input 
                            type="checkbox" 
                            onChange={(e) => {
                              if (e.target.checked) setSelectedUsers(filteredUsers.map(u => u.id))
                              else setSelectedUsers([])
                            }}
                            className="rounded border-white/10 bg-white/5 text-indigo-500 focus:ring-indigo-500/50"
                          />
                        </th>
                        <th className="pb-4 px-4">User</th>
                        <th className="pb-4 px-4">Security</th>
                        <th className="pb-4 px-4">Role</th>
                        <th className="pb-4 px-4">Plan (Limits)</th>
                        <th className="pb-4 px-4">API Keys</th>
                        <th className="pb-4 px-4 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5">
                      {filteredUsers.map(u => {
                        const userAv = getDiscordCdnAvatarUrl(u.discordId, u.avatar, 80)
                        return (
                        <tr key={u.id} className={`hover:bg-white/[0.02] transition-colors ${selectedUsers.includes(u.id) ? 'bg-indigo-500/5' : ''}`}>
                          <td className="py-4 px-4 align-middle">
                            <input 
                              type="checkbox" 
                              checked={selectedUsers.includes(u.id)}
                              onChange={(e) => {
                                if (e.target.checked) setSelectedUsers([...selectedUsers, u.id])
                                else setSelectedUsers(selectedUsers.filter(id => id !== u.id))
                              }}
                              className="rounded border-white/10 bg-white/5 text-indigo-500 focus:ring-indigo-500/50"
                            />
                          </td>
                          <td className="py-4 px-4 align-middle">
                            <div className="flex items-center space-x-3 min-w-48">
                              {userAv ? (
                                <img src={userAv} alt="" className="w-10 h-10 rounded-full border border-white/10" />
                              ) : (
                                <div className="w-10 h-10 rounded-full bg-white/5 flex items-center justify-center">
                                  <span className="text-white font-bold">{u.username.charAt(0)}</span>
                                </div>
                              )}
                              <div>
                                <div className="text-white font-medium flex items-center space-x-2">
                                  <span>{u.username}</span>
                                  {u.isBanned && <span className="text-[10px] bg-red-500 text-white px-1.5 py-0.5 rounded font-black uppercase tracking-tighter">Banned</span>}
                                  {(u.jailUntil && new Date() < new Date(u.jailUntil)) && <span className="text-[10px] bg-amber-500 text-white px-1.5 py-0.5 rounded font-black uppercase tracking-tighter">Jailed</span>}
                                  {(u.riskScore > 0) && (
                                    <span className={`text-[10px] px-1.5 py-0.5 rounded font-black uppercase tracking-tighter ${u.riskScore > 70 ? 'bg-red-500/20 text-red-400 border border-red-500/30' : 'bg-indigo-500/20 text-indigo-400 border border-indigo-500/30'}`}>
                                      Risk: {u.riskScore}
                                    </span>
                                  )}
                                  {u.role === 'OWNER' && <span className="text-[10px] bg-red-600 text-white px-1.5 py-0.5 rounded font-black uppercase tracking-tighter">Owner</span>}
                                  {u.role === 'ADMIN' && <span className="text-[10px] bg-indigo-600 text-white px-1.5 py-0.5 rounded font-black uppercase tracking-tighter">Admin</span>}
                                  {u.role === 'SENIOR_MODERATOR' && <span className="text-[10px] bg-indigo-500/50 text-white px-1.5 py-0.5 rounded font-black uppercase tracking-tighter">Sr. Mod</span>}
                                  {u.role === 'MODERATOR' && <span className="text-[10px] bg-indigo-500/50 text-white px-1.5 py-0.5 rounded font-black uppercase tracking-tighter">Mod</span>}
                                  {u.planExpiry ? (
                                    <span className={`text-[10px] border px-1.5 py-0.5 rounded font-black uppercase tracking-tighter ${new Date(u.planExpiry) < new Date() ? 'bg-red-500/20 text-red-400 border-red-500/30' : 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30'}`}>
                                      {new Date(u.planExpiry) < new Date() ? 'Expired' : `${Math.ceil((new Date(u.planExpiry).getTime() - Date.now()) / (30 * 24 * 60 * 60 * 1000))} Mo`}
                                    </span>
                                  ) : (
                                    u.plan !== 'FREE' && <span className="text-[10px] bg-indigo-500/20 text-indigo-400 border border-indigo-500/30 px-1.5 py-0.5 rounded font-black uppercase tracking-tighter">Permanent</span>
                                  )}
                                  {u.securityBypass && (
                                    <span className="text-[10px] bg-sky-500/20 text-sky-400 border border-sky-500/30 px-1.5 py-0.5 rounded font-black uppercase tracking-tighter flex items-center space-x-1">
                                      <Zap className="h-2.5 w-2.5" />
                                      <span>Bypass</span>
                                    </span>
                                  )}
                                </div>
                                <div className="text-[10px] text-muted-foreground font-mono mt-0.5 opacity-50">{u.discordId}</div>
                              </div>
                            </div>
                          </td>
                          <td className="py-4 px-4 align-middle">
                            <div className="flex flex-col space-y-1">
                              <span className="text-[10px] text-indigo-300 font-mono flex items-center space-x-1.5" title="Last IP / Country">
                                <ShieldAlert className="h-3 w-3" />
                                <span className="flex items-center space-x-1">
                                  <span>{u.lastIp || '—'}</span>
                                  {u.country && <span className="text-[9px] bg-white/10 px-1 rounded text-white/50">{u.country}</span>}
                                </span>
                              </span>
                              <span 
                                className="text-[9px] text-white/30 font-mono truncate w-24 cursor-help hover:text-indigo-300 transition-colors" 
                                title={`Fingerprint: ${u.fingerprint || 'N/A'}`}
                                onClick={() => u.fingerprint && setFingerprintFilter(u.fingerprint)}
                              >
                                FP: {u.fingerprint ? u.fingerprint.substring(0, 8) : '—'}
                              </span>
                            </div>
                          </td>
                          <td className="py-4 px-4 align-middle">
                            <select
                              value={u.role}
                              onChange={(e) => updateUser(u.id, { role: e.target.value })}
                              className="bg-black/50 border border-white/10 text-white text-sm rounded-lg focus:ring-indigo-500 focus:border-indigo-500 px-3 py-1.5 outline-none appearance-none"
                            >
                              <option value="USER">Member</option>
                              <option value="TRIAL_MODERATOR">Trial Moderator</option>
                              <option value="MODERATOR">Moderator</option>
                              <option value="SENIOR_MODERATOR">Senior Moderator</option>
                              <option value="HEAD_MODERATOR">Head Moderator</option>
                              <option value="EXECUTIVE_OFFICER">Executive Officer</option>
                              <option value="ADMIN">Administrator</option>
                              <option value="OWNER">System Owner</option>
                            </select>
                          </td>
                          <td className="py-4 px-4 align-middle">
                            <div className="flex flex-col space-y-2">
                              <select
                                value={u.plan}
                                onChange={(e) => updateUser(u.id, { plan: e.target.value })}
                                className={`border text-sm rounded-lg focus:ring-indigo-500 focus:border-indigo-500 px-3 py-1.5 outline-none font-medium ${u.plan === 'FREE' ? 'bg-zinc-500/10 border-zinc-500/20 text-zinc-300' :
                                    u.plan === 'PREMIUM' ? 'bg-amber-500/10 border-amber-500/20 text-amber-400' :
                                      u.plan === 'RESELLER' || u.plan === 'BUSINESS' || u.plan === 'CUSTOM' ? 'bg-indigo-500/10 border-indigo-500/20 text-indigo-400' :
                                        'bg-emerald-500/10 border-emerald-500/20 text-emerald-400' // REGULAR
                                  }`}
                              >
                                <option value="FREE" className="bg-black text-white">Free (API: 15 daily)</option>
                                <option value="REGULAR" className="bg-black text-white">Regular (API: 500 daily)</option>
                                <option value="PREMIUM" className="bg-black text-white">Premium (API: 1,500 daily)</option>
                                <option value="RESELLER" className="bg-black text-white">Reseller (API: 30,000 daily)</option>
                                <option value="BUSINESS" className="bg-black text-white">Business (API: 100,000 daily)</option>
                                <option value="CUSTOM" className="bg-black text-white">Custom (Unlimited)</option>
                              </select>

                              <button
                                type="button"
                                onClick={() => {
                                  const limits =
                                    PLAN_CONFIG[(u.plan as keyof typeof PLAN_CONFIG) ?? 'FREE'] ?? PLAN_CONFIG.FREE
                                  setEditingCustomUser(u)
                                  setCustomForm({
                                    daily: u.customDailyLimit ?? limits.apiDaily,
                                    minute: u.customMinuteLimit ?? limits.apiBurst,
                                    morrenus: u.customAllowMorrenus ?? limits.allowMorrenusFallback,
                                    ryuu: u.customAllowRyuu ?? limits.allowRyuu,
                                    indefinite: !u.planExpiry,
                                    months: 1,
                                    expiryDate: u.planExpiry ? toDatetimeLocalValue(new Date(u.planExpiry)) : '',
                                  })
                                }}
                                className="text-[10px] bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 rounded py-1 font-bold uppercase hover:bg-indigo-500/20 transition-all"
                              >
                                Plan overrides
                              </button>
                            </div>
                          </td>
                          <td className="py-4 px-4 align-middle">
                            <span className="text-sm text-indigo-300 font-mono bg-white/5 px-2 py-1 rounded-md">
                              {u._count?.apiKeys || 0}
                            </span>
                          </td>
                          <td className="py-4 px-4 align-middle text-right min-w-32">
                            <div className="flex flex-col items-end space-y-2">
                              {saving === u.id ? (
                                <span className="text-emerald-400 text-sm flex items-center justify-end space-x-2 animate-pulse">
                                  <Activity className="h-4 w-4 animate-spin" />
                                  <span>Saving...</span>
                                </span>
                              ) : (
                                <>
                                  <button 
                                    onClick={() => startShadow(u.id)}
                                    className="w-full px-3 py-1.5 bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-400 text-xs font-bold uppercase rounded-lg border border-indigo-500/20 transition-all flex items-center justify-center space-x-2"
                                    title="Shadow this user"
                                  >
                                    <Eye className="h-3.5 w-3.5" />
                                    <span>Shadow</span>
                                  </button>

                                  {currentUserRole === 'OWNER' && (
                                    <button
                                      type="button"
                                      onClick={() => setExecutiveReportsUser({ id: u.id, username: u.username })}
                                      className="w-full px-3 py-1.5 bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 text-xs font-bold uppercase rounded-lg border border-amber-500/20 transition-all"
                                      title="Owner-only Executive Officer category PDFs"
                                    >
                                      EO Reports
                                    </button>
                                  )}

                                  <button
                                    onClick={() => {
                                      if (!u.isBanned) {
                                        const reason = window.prompt(`Please enter a reason for banning ${u.username}:`);
                                        if (reason === null) return; // Cancelled
                                        
                                        setConfirmDialog({
                                          open: true,
                                          title: 'Confirm Suspension',
                                          message: `Are you sure you want to BAN ${u.username} for reason: "${reason || 'Banned by Admin'}"? This action will be recorded in the audit logs.`,
                                          type: 'danger',
                                          onConfirm: async () => {
                                            await updateUser(u.id, { isBanned: true, banReason: reason || 'Banned by Admin' })
                                            setConfirmDialog(p => ({ ...p, open: false }))
                                          }
                                        })
                                      } else {
                                        setConfirmDialog({
                                          open: true,
                                          title: 'Lift Suspension',
                                          message: `Are you sure you want to UNBAN ${u.username}? This action will be recorded in the audit logs.`,
                                          type: 'info',
                                          onConfirm: async () => {
                                            await updateUser(u.id, { isBanned: false })
                                            setConfirmDialog(p => ({ ...p, open: false }))
                                          }
                                        })
                                      }
                                    }}
                                    className={`text-[10px] font-bold uppercase px-3 py-1 rounded-lg transition-all border ${u.isBanned 
                                      ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20 hover:bg-emerald-500/20' 
                                      : 'bg-red-500/10 text-red-400 border-red-500/20 hover:bg-red-500/20'}`}
                                  >
                                    {u.isBanned ? 'Unban User' : 'Ban User'}
                                  </button>

                                  <button
                                    onClick={() => updateUser(u.id, { securityBypass: !u.securityBypass })}
                                    className={`text-[10px] font-bold uppercase px-3 py-1 rounded-lg transition-all border ${u.securityBypass 
                                      ? 'bg-sky-500 text-white border-sky-500' 
                                      : 'bg-sky-500/10 text-sky-400 border-sky-500/20 hover:bg-sky-500/20'}`}
                                    title={u.securityBypass ? "Disable security bypass" : "Enable security bypass (Strict rate limits)"}
                                  >
                                    {u.securityBypass ? 'Bypass Active' : 'Enable Bypass'}
                                  </button>

                                  {u.jailUntil && new Date(u.jailUntil) > new Date() && (
                                    <button
                                      onClick={async () => {
                                        await updateUser(u.id, { jailLevel: 0, jailUntil: null })
                                      }}
                                      className="text-[10px] font-bold uppercase px-3 py-1 rounded-lg transition-all border bg-amber-500/10 text-amber-500 border-amber-500/20 hover:bg-amber-500/20"
                                    >
                                      Clear Jail
                                    </button>
                                  )}
                                  {u.role === 'TRIAL_MODERATOR' && (
                                    <div className="mt-2 w-full pt-2 border-t border-white/5">
                                      <TrialModControls 
                                        userId={u.id} 
                                        discordId={u.discordId}
                                        trialModEndsAtIso={u.trialModEndsAt}
                                        modTestReadyAtIso={u.modTestReadyAt}
                                        onApplied={() => {
                                          fetch('/api/admin/users').then(r => r.json()).then(d => setUsers(d.users || []))
                                        }}
                                      />
                                    </div>
                                  )}
                                  <span className="text-[10px] text-muted-foreground opacity-50">Up to date</span>
                                </>
                              )}
                            </div>
                          </td>
                        </tr>
                      )})}
                    </tbody>
                  </table>
                </div>
              ) : activeTab === 'requests' ? (
                <div className="space-y-4">
                  <div className="p-5 bg-white/5 border border-white/10 rounded-2xl space-y-4">
                    <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4">
                      <div className="space-y-1">
                        <h3 className="text-sm font-black uppercase tracking-widest text-white flex items-center space-x-2">
                          <Gamepad2 className="h-4 w-4 text-indigo-400" />
                          <span>Steam Missing Probe</span>
                        </h3>
                        <p className="text-xs text-muted-foreground">Provider availability snapshot</p>
                      </div>
                      <div className="flex flex-col sm:flex-row gap-2 w-full lg:w-auto">
                        <select
                          value={requestProbeAvailability}
                          onChange={(e) => setRequestProbeAvailability(e.target.value as typeof requestProbeAvailability)}
                          className="w-full sm:w-52 bg-black/50 border border-white/10 rounded-xl px-3 py-2.5 text-[11px] font-bold uppercase tracking-wider text-white outline-none focus:border-indigo-500 transition-all"
                          title="Filter random missing games by upstream provider availability"
                        >
                          <option value="any">Any availability</option>
                          <option value="either">Either provider</option>
                          <option value="both">Both providers</option>
                          <option value="ryuu">Ryuu available</option>
                          <option value="morrenus">Morrenus available</option>
                          <option value="ryuu_only">Ryuu only</option>
                          <option value="morrenus_only">Morrenus only</option>
                        </select>
                        <input
                          value={requestProbeAppId}
                          onChange={(e) => setRequestProbeAppId(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') void probeRequestCandidate('appId')
                          }}
                          inputMode="numeric"
                          pattern="[0-9]*"
                          placeholder="Steam App ID"
                          className="w-full sm:w-44 bg-black/50 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white outline-none focus:border-indigo-500 transition-all font-medium"
                        />
                        <button
                          onClick={() => void probeRequestCandidate('appId')}
                          disabled={requestProbeLoading || !requestProbeAppId.trim()}
                          className="px-4 py-2.5 bg-indigo-500/10 hover:bg-indigo-500/20 border border-indigo-500/20 text-indigo-300 rounded-xl text-xs font-black uppercase tracking-wider transition-all disabled:opacity-50 flex items-center justify-center space-x-2"
                        >
                          {requestProbeLoading ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                          <span>Check</span>
                        </button>
                        <button
                          onClick={() => void probeRequestCandidate('random')}
                          disabled={requestProbeLoading}
                          className="px-4 py-2.5 bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/20 text-emerald-300 rounded-xl text-xs font-black uppercase tracking-wider transition-all disabled:opacity-50 flex items-center justify-center space-x-2"
                        >
                          <RefreshCw className={`h-4 w-4 ${requestProbeLoading ? 'animate-spin' : ''}`} />
                          <span>Random Missing</span>
                        </button>
                      </div>
                    </div>

                    {requestProbe && (
                      <div className="grid grid-cols-1 xl:grid-cols-[1.2fr_2fr] gap-4 pt-2">
                        <div className="bg-black/30 border border-white/10 rounded-xl p-4 min-w-0">
                          <p className="text-sm font-bold text-white truncate">{requestProbe.name}</p>
                          <p className="text-xs text-indigo-300 font-mono mt-1">{requestProbe.appId}</p>
                          <p className="text-[10px] text-muted-foreground uppercase tracking-widest mt-2">
                            {requestProbe.random
                              ? `Random candidate · ${String(requestProbe.availability || 'any').replace(/_/g, ' ')}`
                              : 'Manual check'}
                          </p>
                        </div>
                        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
                          <span className={`px-3 py-2 rounded-xl border text-[10px] font-black uppercase tracking-wider text-center ${requestProbe.inDatabase ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-300' : 'bg-amber-500/10 border-amber-500/20 text-amber-300'}`}>
                            DB: {requestProbe.inDatabase ? 'Present' : 'Missing'}
                          </span>
                          <span className={`px-3 py-2 rounded-xl border text-[10px] font-black uppercase tracking-wider text-center ${requestProbe.pendingRequest ? 'bg-blue-500/10 border-blue-500/20 text-blue-300' : 'bg-zinc-500/10 border-zinc-500/20 text-zinc-300'}`}>
                            Pending: {requestProbe.pendingRequest ? 'Yes' : 'No'}
                          </span>
                          <div className="flex flex-col gap-1.5">
                            <span
                              title={requestProbe.providers?.morrenus?.message || ''}
                              className={`px-3 py-2 rounded-xl border text-[10px] font-black uppercase tracking-wider text-center ${
                                requestProbe.providers?.morrenus?.available === true
                                  ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-300'
                                  : requestProbe.providers?.morrenus?.available === false
                                    ? 'bg-red-500/10 border-red-500/20 text-red-300'
                                    : 'bg-zinc-500/10 border-zinc-500/20 text-zinc-300'
                              }`}
                            >
                              Morrenus: {requestProbe.providers?.morrenus?.available === true ? 'Available' : requestProbe.providers?.morrenus?.available === false ? 'Missing' : 'Unknown'}
                            </span>
                            {requestProbe.providers?.morrenus?.available === true && !requestProbe.inDatabase ? (
                              <button
                                type="button"
                                onClick={() => void importProbeFromProvider('morrenus')}
                                disabled={!!requestProbeImporting}
                                className="rounded-lg border border-emerald-500/30 bg-emerald-500/15 px-2 py-1.5 text-[9px] font-black uppercase tracking-wider text-emerald-200 hover:bg-emerald-500/25 disabled:opacity-50 flex items-center justify-center gap-1"
                              >
                                {requestProbeImporting === 'morrenus' ? <RefreshCw className="h-3 w-3 animate-spin" /> : <Upload className="h-3 w-3" />}
                                Add to DB
                              </button>
                            ) : null}
                          </div>
                          <div className="flex flex-col gap-1.5">
                            <span
                              title={requestProbe.providers?.ryuu?.message || ''}
                              className={`px-3 py-2 rounded-xl border text-[10px] font-black uppercase tracking-wider text-center ${
                                requestProbe.providers?.ryuu?.available === true
                                  ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-300'
                                  : requestProbe.providers?.ryuu?.available === false
                                    ? 'bg-red-500/10 border-red-500/20 text-red-300'
                                    : 'bg-zinc-500/10 border-zinc-500/20 text-zinc-300'
                              }`}
                            >
                              Ryuu: {requestProbe.providers?.ryuu?.available === true ? 'Available' : requestProbe.providers?.ryuu?.available === false ? 'Missing' : 'Unknown'}
                            </span>
                            {requestProbe.providers?.ryuu?.available === true && !requestProbe.inDatabase ? (
                              <button
                                type="button"
                                onClick={() => void importProbeFromProvider('ryuu')}
                                disabled={!!requestProbeImporting}
                                className="rounded-lg border border-emerald-500/30 bg-emerald-500/15 px-2 py-1.5 text-[9px] font-black uppercase tracking-wider text-emerald-200 hover:bg-emerald-500/25 disabled:opacity-50 flex items-center justify-center gap-1"
                              >
                                {requestProbeImporting === 'ryuu' ? <RefreshCw className="h-3 w-3 animate-spin" /> : <Upload className="h-3 w-3" />}
                                Add to DB
                              </button>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>

                  {requests.length === 0 ? (
                    <div className="py-12 text-center text-muted-foreground">No game requests found!</div>
                  ) : (
                    requests.map(r => {
                      const requestUserAv = getDiscordCdnAvatarUrl(r.user?.discordId, r.user?.avatar, 32)
                      return (
                      <div key={r.id} className="p-5 bg-white/5 border border-white/10 rounded-2xl flex flex-col md:flex-row md:items-center justify-between gap-4 group hover:bg-white/10 transition-colors">
                        <div className="flex-1 space-y-2">
                          <div className="flex items-center space-x-3">
                            <span className="text-lg font-bold text-white tracking-tight">{r.name}</span>
                            <span className="text-xs text-indigo-300 font-mono bg-indigo-500/10 px-2 py-0.5 rounded border border-indigo-500/20">{r.appId || 'N/A URL'}</span>
                            <span className={`text-[10px] font-bold uppercase px-2 py-1 rounded tracking-widest ${r.status === 'PENDING' ? 'bg-amber-500/20 text-amber-400' :
                                r.status === 'DONE' ? 'bg-emerald-500/20 text-emerald-400' :
                                  'bg-red-500/20 text-red-400'
                              }`}>{r.status}</span>
                          </div>
                          <p className="text-sm text-muted-foreground bg-black/40 p-3 rounded-xl italic">"{r.reason || 'No specific reason provided.'}"</p>
                          <div className="flex items-center space-x-2 text-xs text-muted-foreground pt-1">
                            <div className="flex flex-col">
                              <span className="text-white font-bold">{r.name}</span>
                              <span className="text-[10px] text-indigo-300 font-mono mt-0.5">{r.appId}</span>
                              <span className="text-[10px] text-muted-foreground mt-1.5 flex items-center space-x-1">
                                {requestUserAv && <img src={requestUserAv} alt="" className="w-3 h-3 rounded-full" />}
                                <span>Requested by <strong className="text-white">{r.user?.username || 'Former Member'}</strong></span>
                              </span>
                            </div>
                            <span>• {new Date(r.createdAt).toLocaleString()}</span>
                          </div>
                        </div>
                        <div className="flex md:flex-col items-center gap-2">
                          {saving === r.id ? <Activity className="h-5 w-5 text-indigo-500 animate-spin" /> : (
                            <>
                              {!r.appId && (
                                <button
                                  onClick={async () => {
                                    setSaving(r.id)
                                    try {
                                      const res = await fetch('/api/admin/requests/resolve', {
                                        method: 'POST',
                                        headers: { 'Content-Type': 'application/json' },
                                        body: JSON.stringify({ requestId: r.id })
                                      })
                                      const data = await res.json()
                                      if (!res.ok) alert(data.error || 'Failed to resolve')
                                      else {
                                        loadInitialData()
                                      }
                                    } finally {
                                      setSaving(null)
                                    }
                                  }}
                                  className="px-4 py-2 w-full text-center bg-blue-500/10 hover:bg-blue-500/20 border border-blue-500/20 hover:border-blue-500/40 text-blue-400 rounded-lg text-xs font-bold uppercase tracking-wide transition-all"
                                >
                                  Find AppID
                                </button>
                              )}
                              {r.status !== 'DONE' && (
                                <button
                                  onClick={async () => {
                                    setSaving(r.id)
                                    await fetch('/api/admin/requests', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ requestId: r.id, status: 'DONE' }) })
                                    loadInitialData()
                                    setTimeout(() => setSaving(null), 500)
                                  }}
                                  className="px-4 py-2 w-full text-center bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/20 hover:border-emerald-500/40 text-emerald-400 rounded-lg text-xs font-bold uppercase tracking-wide transition-all"
                                >
                                  Mark Done
                                </button>
                              )}
                              {r.status !== 'REJECTED' && (
                                <button
                                  onClick={async () => {
                                    setSaving(r.id)
                                    await fetch('/api/admin/requests', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ requestId: r.id, status: 'REJECTED' }) })
                                    loadInitialData()
                                    setTimeout(() => setSaving(null), 500)
                                  }}
                                  className="px-4 py-2 w-full text-center bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 hover:border-red-500/40 text-red-400 rounded-lg text-xs font-bold uppercase tracking-wide transition-all"
                                >
                                  Reject
                                </button>
                              )}
                            </>
                          )}
                        </div>
                      </div>
                    )
                  }
                  )
                  )}
                </div>
              ) : activeTab === 'tickets' ? (
                <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4">
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-white/5 pb-6">
                    <h3 className="text-xl font-black uppercase tracking-widest text-white flex items-center space-x-3">
                      <MessageSquare className="h-6 w-6 text-indigo-400" />
                      <span>Support Ticket Inbox</span>
                    </h3>
                  </div>

                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 items-start">
                    {/* Ticket List */}
                    <div className="lg:col-span-1 space-y-4 max-h-[700px] overflow-y-auto pr-2 custom-scrollbar">
                      {ticketsLoading ? (
                        <div className="py-20 text-center text-muted-foreground"><Activity className="h-6 w-6 animate-spin mx-auto mb-2 text-indigo-500" />fetching tickets...</div>
                      ) : tickets.length === 0 ? (
                        <div className="py-20 text-center text-muted-foreground italic">No tickets found.</div>
                      ) : tickets.map(t => (
                        <div 
                          key={t.id} 
                          onClick={() => setSelectedTicket(t)}
                          className={`p-5 rounded-2xl border transition-all cursor-pointer group ${
                            selectedTicket?.id === t.id 
                              ? 'bg-indigo-500/10 border-indigo-500/30' 
                              : 'bg-white/5 border-white/10 hover:border-white/20'
                          }`}
                        >
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-[10px] font-mono font-bold text-indigo-400">{t.ticketNumber}</span>
                            <span className={`text-[8px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full ${
                              t.status === 'OPEN' ? 'bg-indigo-500/20 text-indigo-400' : 'bg-green-500/20 text-green-400'
                            }`}>
                              {t.status}
                            </span>
                          </div>
                          <h4 className="text-sm font-bold text-white mb-1 truncate">{t.subject}</h4>
                          <p className="text-[10px] text-muted-foreground line-clamp-1">{t.fromName || t.fromEmail}</p>
                          <div className="mt-3 flex items-center justify-between pt-3 border-t border-white/5">
                            <span className="text-[9px] text-muted-foreground">{new Date(t.createdAt).toLocaleDateString()}</span>
                            <ArrowRightLeft className="h-3 w-3 text-white/10 group-hover:text-indigo-400 transition-colors" />
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* Ticket Detail / Reply */}
                    <div className="lg:col-span-2">
                      {selectedTicket ? (
                        <div className="glass rounded-[2.5rem] p-8 border border-white/10 space-y-8 animate-in fade-in slide-in-from-right-4">
                          <div className="flex items-center justify-between border-b border-white/5 pb-6">
                            <div className="space-y-1">
                              <h3 className="text-2xl font-black text-white tracking-tight">{selectedTicket.subject}</h3>
                              <div className="flex items-center space-x-3">
                                <p className="text-xs text-muted-foreground">From: <b className="text-indigo-400">{selectedTicket.fromName}</b> ({selectedTicket.fromEmail})</p>
                                {selectedTicket.resendId && (
                                  <div className="flex items-center space-x-2">
                                    <span className="w-1 h-1 rounded-full bg-white/20" />
                                    <span className="text-[10px] font-black uppercase tracking-widest text-indigo-300">
                                      Status: {selectedTicket.resendStatus || 'SENT'}
                                    </span>
                                    <button 
                                      onClick={() => refreshTicketStatus(selectedTicket.id)}
                                      className="p-1 hover:bg-white/5 rounded text-white/40 hover:text-indigo-400 transition-colors"
                                      title="Refresh delivery status from Resend"
                                    >
                                      <RotateCcw className="h-3 w-3" />
                                    </button>
                                  </div>
                                )}
                              </div>
                            </div>
                            <button 
                              onClick={() => setSelectedTicket(null)}
                              className="p-2 hover:bg-white/10 rounded-full transition-colors"
                            >
                              <XCircle className="h-6 w-6 text-muted-foreground" />
                            </button>
                          </div>

                          <div className="space-y-6">
                            <div className="p-6 bg-white/[0.02] border border-white/5 rounded-3xl relative">
                              <div className="absolute -top-3 left-6 px-3 py-1 bg-zinc-900 border border-white/10 rounded-full">
                                <span className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Original Inquiry</span>
                              </div>
                              <p className="text-sm text-zinc-300 leading-relaxed whitespace-pre-wrap">
                                {selectedTicket.message || <span className="italic text-zinc-500">No message content provided.</span>}
                              </p>
                              <p className="mt-4 text-[10px] text-zinc-600 font-bold">{new Date(selectedTicket.createdAt).toLocaleString()}</p>
                            </div>

                            {selectedTicket.aiReply && (
                              <div className="p-6 bg-indigo-500/5 border border-indigo-500/10 rounded-3xl relative mt-6">
                                <div className="absolute -top-3 left-6 px-3 py-1 bg-indigo-900 border border-indigo-500/30 rounded-full flex items-center space-x-1">
                                  <Zap className="h-3 w-3 text-indigo-400" />
                                  <span className="text-[10px] font-black uppercase tracking-widest text-indigo-300">AI Support Agent</span>
                                </div>
                                <p className="text-sm text-indigo-200 leading-relaxed whitespace-pre-wrap">{selectedTicket.aiReply}</p>
                                <p className="mt-4 text-[10px] text-indigo-500/50 font-bold">{selectedTicket.aiRepliedAt ? new Date(selectedTicket.aiRepliedAt).toLocaleString() : 'Automated Response'}</p>
                             </div>
                            )}

                            {/* Previous Conversation History / Chat Replies */}
                            {selectedTicket.replies && selectedTicket.replies.length > 0 && (
                              <div className="space-y-4 pt-4 border-t border-white/5">
                                <div className="flex items-center space-x-2 text-zinc-400">
                                  <MessageSquare className="h-4 w-4" />
                                  <span className="text-[10px] font-black uppercase tracking-widest">Conversation History</span>
                                </div>
                                <div className="space-y-4 max-h-[300px] overflow-y-auto pr-2 custom-scrollbar">
                                  {selectedTicket.replies.map((rep: any) => {
                                    const isUser = rep.senderRole === 'User';
                                    return (
                                      <div key={rep.id} className={`p-6 rounded-3xl relative border ${
                                        isUser 
                                          ? 'bg-indigo-500/5 border-indigo-500/10' 
                                          : 'bg-emerald-500/5 border-emerald-500/10'
                                      }`}>
                                        <div className={`absolute -top-3 left-6 px-3 py-1 rounded-full flex items-center space-x-1.5 ${
                                          isUser ? 'bg-indigo-900 border border-indigo-500/30' : 'bg-emerald-900 border border-emerald-500/30'
                                        }`}>
                                          {!isUser && <ShieldCheck className="h-3 w-3 text-emerald-400" />}
                                          <span className={`text-[10px] font-black uppercase tracking-widest ${
                                            isUser ? 'text-indigo-300' : 'text-emerald-300'
                                          }`}>
                                            {rep.senderName} {rep.senderRole && rep.senderRole !== 'User' && `(${rep.senderRole})`}
                                          </span>
                                        </div>
                                        <p className="text-sm text-zinc-200 leading-relaxed whitespace-pre-wrap">
                                          {rep.message || <span className="italic text-zinc-500">No message content provided.</span>}
                                        </p>
                                        <p className="mt-4 text-[10px] text-zinc-600 font-bold">{new Date(rep.createdAt).toLocaleString()}</p>
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            )}

                            <div className="space-y-4 pt-4 border-t border-white/5">
                              <div className="flex items-center space-x-2 text-indigo-400">
                                <Send className="h-4 w-4" />
                                <span className="text-[10px] font-black uppercase tracking-widest">Send Response</span>
                              </div>
                              <textarea 
                                value={replyText}
                                onChange={(e) => setReplyText(e.target.value)}
                                placeholder="Type your professional response here..."
                                className="w-full bg-black/40 border border-white/10 rounded-3xl p-6 text-sm text-white focus:ring-2 focus:ring-indigo-500/50 outline-none min-h-[200px] resize-none"
                              />
                              <div className="flex items-center justify-end space-x-3">
                                <button 
                                  onClick={() => handleReplyTicket(false)}
                                  disabled={saving === selectedTicket.id || !replyText.trim()}
                                  className="px-6 py-3 bg-white/5 hover:bg-white/10 text-white text-[10px] font-black uppercase tracking-widest rounded-xl transition-all disabled:opacity-50"
                                >
                                  {saving === selectedTicket.id ? <Activity className="h-4 w-4 animate-spin" /> : 'Send Reply'}
                                </button>
                                <button 
                                  onClick={() => handleReplyTicket(true)}
                                  disabled={saving === selectedTicket.id || !replyText.trim()}
                                  className="px-6 py-3 bg-indigo-500 hover:bg-indigo-600 text-white text-[10px] font-black uppercase tracking-widest rounded-xl shadow-lg shadow-indigo-500/20 transition-all disabled:opacity-50"
                                >
                                  {saving === selectedTicket.id ? <Activity className="h-4 w-4 animate-spin" /> : 'Reply & Close'}
                                </button>
                              </div>
                            </div>
                          </div>
                        </div>
                      ) : (
                        <div className="h-[500px] border-2 border-dashed border-white/5 rounded-[3rem] flex flex-col items-center justify-center text-center p-12 space-y-4">
                          <div className="p-6 bg-white/5 rounded-full">
                            <MessageSquare className="h-12 w-12 text-zinc-700" />
                          </div>
                          <div className="space-y-2">
                            <h3 className="text-xl font-bold text-white">No Ticket Selected</h3>
                            <p className="text-sm text-muted-foreground max-w-xs">Select a support inquiry from the left to view details and respond.</p>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ) : activeTab === 'keys' ? (
                <div className="space-y-6">
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white/5 p-4 rounded-2xl border border-white/10">
                    <div>
                      <h3 className="text-lg font-black uppercase tracking-widest text-white">Global Platform Access</h3>
                      <p className="text-xs text-muted-foreground mt-1">Manage global access for API keys and generation features.</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-4">
                      <button 
                        onClick={async () => {
                          const action = confirm(`Are you sure you want to ${generationEnabled ? 'SUSPEND' : 'ENABLE'} platform-wide generation? This blocks site and bot generations.`)
                          if (!action) return;
                          
                          setSaving('global-gen')
                          try {
                            const res = await fetch('/api/admin/generation/toggle', {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ enableGeneration: !generationEnabled })
                            })
                            if (res.ok) {
                              const d = await res.json()
                              setGenerationEnabled(d.enabled)
                            }
                          } finally {
                            setSaving(null)
                          }
                        }}
                        className={`px-4 py-2 text-xs font-black uppercase tracking-widest rounded-xl transition-all shadow-lg active:scale-95 flex items-center space-x-2 ${generationEnabled ? 'bg-amber-500/10 hover:bg-amber-500/20 text-amber-500 border border-amber-500/20' : 'bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/20'}`}
                      >
                        {saving === 'global-gen' ? <Activity className="h-4 w-4 animate-spin" /> : generationEnabled ? <Ban className="h-4 w-4" /> : <ShieldCheck className="h-4 w-4" />}
                        <span>{generationEnabled ? 'Lock Generation' : 'Unlock Generation'}</span>
                      </button>

                      <button
                        onClick={async () => {
                          const action = confirm(`Are you sure you want to ${registrationEnabled ? 'DISABLE' : 'ENABLE'} new account registrations?`)
                          if (action) {
                            setSaving('global-reg')
                            try {
                              const res = await fetch('/api/admin/registration-toggle', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ enableRegistration: !registrationEnabled })
                              })
                              if (res.ok) {
                                const d = await res.json()
                                setRegistrationEnabled(d.enabled)
                              }
                            } finally {
                              setSaving(null)
                            }
                          }
                        }}
                        className={`px-4 py-2 text-xs font-black uppercase tracking-widest rounded-xl transition-all shadow-lg active:scale-95 flex items-center space-x-2 ${registrationEnabled ? 'bg-amber-500/10 hover:bg-amber-500/20 text-amber-500 border border-amber-500/20' : 'bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/20'}`}
                      >
                        {saving === 'global-reg' ? <Activity className="h-4 w-4 animate-spin" /> : registrationEnabled ? <Ban className="h-4 w-4" /> : <ShieldCheck className="h-4 w-4" />}
                        <span>{registrationEnabled ? 'Lock Registrations' : 'Open Registrations'}</span>
                      </button>
                      <button 
                        onClick={async () => {
                          const action = confirm(`Are you sure you want to ${keysCreationEnabled ? 'SUSPEND' : 'ENABLE'} creation of new API keys?`)
                          if (!action) return;
                          
                          setSaving('global')
                          try {
                            const res = await fetch('/api/admin/keys/toggle-creation', {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ enableCreation: !keysCreationEnabled })
                            })
                            if (res.ok) {
                              const d = await res.json()
                              setKeysCreationEnabled(d.enabled)
                            }
                          } finally {
                            setSaving(null)
                          }
                        }}
                        className={`px-4 py-2 text-xs font-black uppercase tracking-widest rounded-xl transition-all shadow-lg active:scale-95 flex items-center space-x-2 ${keysCreationEnabled ? 'bg-amber-500/10 hover:bg-amber-500/20 text-amber-500 border border-amber-500/20' : 'bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/20'}`}
                      >
                        {saving === 'global' ? <Activity className="h-4 w-4 animate-spin" /> : keysCreationEnabled ? <Ban className="h-4 w-4" /> : <ShieldCheck className="h-4 w-4" />}
                        <span>{keysCreationEnabled ? 'Suspend New Keys' : 'Enable New Keys'}</span>
                      </button>

                      <button 
                        onClick={async () => {
                          if (confirm(`Are you absolutely sure you want to ENABLE ALL API keys across the platform?`)) {
                            setSaving('global')
                            try {
                              const res = await fetch('/api/admin/keys/bulk-toggle', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ enableAll: true })
                              })
                              if (res.ok) {
                                loadInitialData()
                              }
                            } finally {
                              setSaving(null)
                            }
                          }
                        }}
                        className="px-4 py-2 bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-black uppercase tracking-widest rounded-xl transition-all shadow-lg shadow-emerald-500/20 active:scale-95 flex items-center space-x-2"
                      >
                        {saving === 'global' ? <Activity className="h-4 w-4 animate-spin" /> : <Power className="h-4 w-4" />}
                        <span>Enable All</span>
                      </button>
                      <button 
                        onClick={async () => {
                          if (confirm(`Are you absolutely sure you want to SUSPEND ALL API keys across the platform?`)) {
                            setSaving('global')
                            try {
                              const res = await fetch('/api/admin/keys/bulk-toggle', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ enableAll: false })
                              })
                              if (res.ok) {
                                loadInitialData()
                              }
                            } finally {
                              setSaving(null)
                            }
                          }
                        }}
                        className="px-4 py-2 bg-red-500 hover:bg-red-600 text-white text-xs font-black uppercase tracking-widest rounded-xl transition-all shadow-lg shadow-red-500/20 active:scale-95 flex items-center space-x-2"
                      >
                        {saving === 'global' ? <Activity className="h-4 w-4 animate-spin" /> : <Ban className="h-4 w-4" />}
                        <span>Suspend All</span>
                      </button>
                    </div>
                  </div>

                  <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-white/10 text-xs uppercase tracking-wider text-muted-foreground">
                      <th className="pb-4 font-semibold px-4">Key / Owner</th>
                      <th className="pb-4 font-semibold px-4">Rate Limit</th>
                      <th className="pb-4 font-semibold px-4">Exe</th>
                      <th className="pb-4 font-semibold px-4">Times Used</th>
                      <th className="pb-4 font-semibold px-4">Status</th>
                      <th className="pb-4 font-semibold px-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {keys.length === 0 ? (
                      <tr><td colSpan={5} className="py-12 text-center text-muted-foreground">No API Keys exist on the platform.</td></tr>
                    ) : keys.map(k => {
                      const keyOwnerAv = getDiscordCdnAvatarUrl(k.user?.discordId, k.user?.avatar, 32)
                      return (
                      <tr key={k.id} className="hover:bg-white/[0.02] transition-colors">
                        <td className="py-4 px-4 align-middle">
                          <div className="flex flex-col">
                            <span className="text-white font-bold">{k.name}</span>
                            <span className="text-xs text-indigo-300 font-mono mt-0.5 max-w-[200px] truncate">{k.key}</span>
                            <span className="text-[10px] text-muted-foreground mt-1 flex items-center space-x-1">
                              {keyOwnerAv && <img src={keyOwnerAv} alt="" className="w-3 h-3 rounded-full" />}
                              <span>Owned by <strong>{k.user?.username || 'Orphaned Key'}</strong></span>
                            </span>
                          </div>
                        </td>
                        <td className="py-4 px-4 align-middle">
                          <span className="text-sm bg-black/40 px-2 py-1 rounded font-mono text-white/70">
                            {k.rateLimit} req / {k.rateWindow}s
                          </span>
                        </td>
                        <td className="py-4 px-4 align-middle">
                          <div className="flex items-center">
                            {k.appSessions && k.appSessions.length > 0 ? (
                              <div className="flex items-center space-x-2 bg-white/5 px-2 py-1 rounded-lg border border-white/5">
                                <div className="relative flex">
                                  <div className={`w-2 h-2 rounded-full ${new Date().getTime() - new Date(k.appSessions[0].lastSeen).getTime() < 600000 ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.8)]' : 'bg-zinc-600'}`} />
                                  {new Date().getTime() - new Date(k.appSessions[0].lastSeen).getTime() < 600000 && <div className="absolute inset-0 w-2 h-2 bg-emerald-500 rounded-full animate-ping opacity-30" />}
                                </div>
                                <span className="text-[9px] text-indigo-300 font-black uppercase tracking-tighter">v{k.appSessions[0].appVersion}</span>
                              </div>
                            ) : (
                              <span className="text-[10px] text-white/10 font-black uppercase tracking-widest ml-1">None</span>
                            )}
                          </div>
                        </td>
                        <td className="py-4 px-4 align-middle">
                          <span className="text-sm bg-black/40 px-2 py-1 rounded font-mono text-white/70">
                            {k._count?.usage || 0}
                          </span>
                        </td>
                        <td className="py-4 px-4 align-middle">
                          {k.enabled ? (
                            <span className="text-xs bg-emerald-500/10 text-emerald-400 px-2 py-1 rounded border border-emerald-500/20 font-bold tracking-wide uppercase">Active</span>
                          ) : (
                            <span className="text-xs bg-red-500/10 text-red-400 px-2 py-1 rounded border border-red-500/20 font-bold tracking-wide uppercase">Disabled</span>
                          )}
                        </td>
                        <td className="py-4 px-4 align-middle text-right">
                          <div className="flex items-center justify-end space-x-2">
                            <button 
                              onClick={() => {
                                setLogFilterKey(k.id)
                                setActiveTab('logs')
                                loadLogs(1, k.id)
                              }}
                              className="p-2 bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-400 rounded transition"
                              title="View API Logs for Key"
                            >
                              <Eye className="h-4 w-4" />
                            </button>
                            <button 
                              onClick={() => toggleKeyEnabled(k.id, k.enabled)}
                              className={`p-2 rounded transition ${k.enabled ? 'bg-amber-500/10 hover:bg-amber-500/20 text-amber-500' : 'bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-500'}`}
                              title={k.enabled ? "Disable Key" : "Enable Key"}
                            >
                              {saving === k.id ? <Activity className="h-4 w-4 animate-spin" /> : k.enabled ? <Ban className="h-4 w-4" /> : <Power className="h-4 w-4" />}
                            </button>
                            <button 
                              onClick={() => deleteKey(k.id)}
                              className="p-2 bg-red-500/10 hover:bg-red-500/20 text-red-500 rounded transition"
                              title="Delete Key completely"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    )})}
                  </tbody>
                </table>
              </div>

              ) : activeTab === 'firewall' ? (
                <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4">
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                    {/* Active Jails */}
                    <div className="space-y-4">
                      <h3 className="text-lg font-bold text-white flex items-center space-x-2">
                        <Activity className="h-5 w-5 text-amber-400" />
                        <span>Live Rate-Limit Jails</span>
                      </h3>
                      <div className="bg-white/5 border border-white/10 rounded-2xl overflow-hidden">
                        <table className="w-full text-left">
                          <thead className="bg-white/5 text-[10px] uppercase font-bold text-muted-foreground p-4">
                            <tr>
                              <th className="p-4">IP Address</th>
                              <th className="p-4">Violations</th>
                              <th className="p-4 text-right">Action</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-white/5">
                            {jails.length === 0 ? (
                              <tr><td colSpan={3} className="p-8 text-center text-muted-foreground text-sm italic">No active jails</td></tr>
                            ) : jails.map(j => (
                              <tr key={j.ip}>
                                <td className="p-4 font-mono text-indigo-300 text-sm">{j.ip}</td>
                                <td className="p-4 text-white font-bold">{j.violationCount}</td>
                                <td className="p-4 text-right">
                                  <div className="flex justify-end space-x-2">
                                    <button 
                                      onClick={() => setIncidentModal({
                                        open: true,
                                        title: `Rate Limit Abuse: ${j.ip}`,
                                        message: `IP ${j.ip} has been temporarily jailed for ${j.violationCount} violations.`,
                                        description: `Automatic system jail triggered after persistent rate limit violations from IP: ${j.ip}.\n\nTotal violations: ${j.violationCount}`,
                                        type: 'warning'
                                      })}
                                      className="p-1.5 bg-indigo-500/10 text-indigo-400 rounded hover:bg-indigo-500/20"
                                      title="Push to Public Incident"
                                    >
                                      <Bell className="h-4 w-4" />
                                    </button>
                                    <button onClick={() => clearJail(j.ip)} className="p-1.5 bg-emerald-500/10 text-emerald-400 rounded hover:bg-emerald-500/20"><CheckCircle className="h-4 w-4" /></button>
                                    <button onClick={() => blacklistIp(j.ip, 'Rate limit abuse')} className="p-1.5 bg-red-500/10 text-red-500 rounded hover:bg-red-500/20"><Ban className="h-4 w-4" /></button>
                                  </div>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>

                    {/* Permanent Blacklist */}
                    <div className="space-y-4">
                      <div className="flex items-center justify-between">
                        <h3 className="text-lg font-bold text-white flex items-center space-x-2">
                          <ShieldAlert className="h-5 w-5 text-red-500" />
                          <span>Permanent IP Blacklist</span>
                        </h3>
                        <button 
                          onClick={() => {
                            const ip = prompt('Enter IP to permanently blacklist:')
                            if (ip) blacklistIp(ip, 'Manual blacklist')
                          }}
                          className="text-[10px] bg-red-500 text-white px-3 py-1.5 rounded-lg font-black uppercase"
                        >
                          Manual Ban
                        </button>
                      </div>
                      <div className="bg-white/5 border border-white/10 rounded-2xl overflow-hidden">
                        <table className="w-full text-left">
                          <thead className="bg-white/5 text-[10px] uppercase font-bold text-muted-foreground p-4">
                            <tr>
                              <th className="p-4">IP Address</th>
                              <th className="p-4">Reason</th>
                              <th className="p-4 text-right">Action</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-white/5">
                            {blacklist.length === 0 ? (
                              <tr><td colSpan={3} className="p-8 text-center text-muted-foreground text-sm italic">Blacklist is empty</td></tr>
                            ) : blacklist.map(b => (
                              <tr key={b.id}>
                                <td className="p-4 font-mono text-red-400 text-sm">{b.ip}</td>
                                <td className="p-4 text-white/50 text-xs">{b.reason}</td>
                                <td className="p-4 text-right">
                                  <div className="flex justify-end space-x-2">
                                    <button 
                                      onClick={() => setIncidentModal({
                                        open: true,
                                        title: `Permanent Blacklist: ${b.ip}`,
                                        message: `IP ${b.ip} has been permanently blacklisted.`,
                                        description: `Administrative IP ban issued for IP: ${b.ip}.\nReason: ${b.reason || 'N/A'}\nIssued: ${new Date(b.createdAt).toLocaleString()}`,
                                        type: 'error'
                                      })}
                                      className="p-1.5 bg-indigo-500/10 text-indigo-400 rounded hover:bg-indigo-500/20"
                                      title="Push to Public Incident"
                                    >
                                      <Bell className="h-4 w-4" />
                                    </button>
                                    <button onClick={() => removeBlacklist(b.ip)} className="p-1.5 bg-white/5 text-white/50 rounded hover:bg-white/10 hover:text-white"><Trash2 className="h-4 w-4" /></button>
                                  </div>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                </div>

              ) : activeTab === 'notifications' ? (
                <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4">
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-white/5 pb-6">
                    <h3 className="text-xl font-black uppercase tracking-widest text-white flex items-center space-x-3">
                      <Bell className="h-6 w-6 text-indigo-400" />
                      <span>System Alerts & Notifications</span>
                    </h3>
                  </div>

                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                    {/* Active Alert Banner for Admin Controls */}
                    {notifHistory.some(n => n.active) && (
                      <div className="lg:col-span-2 p-6 bg-indigo-500/5 border border-indigo-500/10 rounded-3xl flex items-center justify-between animate-in fade-in zoom-in duration-500">
                        <div className="flex items-center space-x-6">
                           <div className="p-4 bg-indigo-500/20 rounded-2xl border border-indigo-500/30">
                              <ShieldAlert className="h-6 w-6 text-indigo-400 animate-pulse" />
                           </div>
                           <div className="space-y-1">
                              <p className="text-[10px] font-black uppercase tracking-[0.2em] text-indigo-300">Live Infrastructure Announcement</p>
                              <p className="text-white font-black text-lg tracking-tight">"{notifHistory.find(n => n.active)?.message}"</p>
                           </div>
                        </div>
                        <button
                          onClick={async () => {
                            setSaving('clear-notif')
                            try {
                              await fetch('/api/admin/notifications', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ active: false })
                              })
                              toastSuccess('System Status: Clear', 'All platform notifications have been deactivated.')
                              loadNotifs()
                            } finally {
                              setSaving(null)
                            }
                          }}
                          disabled={saving === 'clear-notif'}
                          className="px-8 py-3 bg-red-500/10 hover:bg-red-500 text-red-500 hover:text-white rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all border border-red-500/20 hover:border-red-500 flex items-center space-x-2 disabled:opacity-50"
                        >
                          {saving === 'clear-notif' ? <Activity className="h-4 w-4 animate-spin" /> : <XCircle className="h-4 w-4" />}
                          <span>Turn Off Alert</span>
                        </button>
                      </div>
                    )}
                    
                    {/* Create Notification */}
                    <div className="glass rounded-[2rem] p-8 border border-white/10 space-y-6">
                      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                        <h4 className="text-sm font-black uppercase tracking-[0.2em] text-indigo-300">Issue a New Platform Alert</h4>
                        <button
                          type="button"
                          disabled={saving === 'discord-outage-preset'}
                          onClick={async () => {
                            setSaving('discord-outage-preset')
                            try {
                              const res = await fetch('/api/admin/notifications', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({
                                  title: 'Discord Bot Outage',
                                  message:
                                    'We are experiencing Discord bot restrictions. Login and verification may use our backup bot. Moderator exam access remains available on the website.',
                                  description:
                                    'Main Discord bot is quarantined or restricted. Backup bot failover may be active for verify and DMs.',
                                  type: 'error',
                                  broadcast: false,
                                  active: true,
                                }),
                              })
                              if (res.ok) {
                                toastSuccess('Discord outage banner published', 'Red site banner is now live.')
                                loadNotifs()
                              } else {
                                toastError('Failed to publish banner')
                              }
                            } finally {
                              setSaving(null)
                            }
                          }}
                          className="px-4 py-2 bg-red-500/10 hover:bg-red-500/20 text-red-300 text-[10px] font-black uppercase tracking-widest rounded-xl border border-red-500/30 disabled:opacity-50"
                        >
                          Discord Bot Outage preset
                        </button>
                      </div>
                      
                      <form className="space-y-4" onSubmit={async (e) => {
                        e.preventDefault()
                        const form = e.target as HTMLFormElement
                        const target = form.elements as any
                        const title = target.title.value
                        const message = target.message.value
                        const description = target.description.value
                        const type = target.type.value
                        const broadcast = target.broadcast.checked

                        setSaving('new-notif')
                        try {
                          const res = await fetch('/api/admin/notifications', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ title, message, description, type, broadcast, active: true })
                          })
                          if (res.ok) {
                            toastSuccess('Alert Published', 'The notification is now live across all pages.')
                            form.reset()
                            loadNotifs()
                          }
                        } finally {
                          setSaving(null)
                        }
                      }}>
                        <div className="space-y-4">
                          <div className="space-y-2">
                            <label className="text-[10px] text-muted-foreground font-black uppercase tracking-widest ml-1">Outage Title / Name</label>
                            <input
                              name="title"
                              required
                              placeholder="e.g. Master Cluster Maintenance"
                              className="w-full bg-black/40 border border-white/10 rounded-2xl py-3 px-4 text-sm text-white focus:ring-1 focus:ring-indigo-500/50 outline-none"
                            />
                          </div>
                          
                          <div className="space-y-2">
                             <label className="text-[10px] text-muted-foreground font-black uppercase tracking-widest ml-1">Short Summary (Banner)</label>
                             <textarea 
                               name="message"
                               rows={2}
                               required
                               placeholder="e.g. API cluster is currently under maintenance..."
                               className="w-full bg-black/40 border border-white/10 rounded-2xl py-3 px-4 text-sm text-white focus:ring-1 focus:ring-indigo-500/50 outline-none resize-none"
                             />
                          </div>

                          <div className="space-y-2">
                             <label className="text-[10px] text-muted-foreground font-black uppercase tracking-widest ml-1">Technical Detail (History)</label>
                             <textarea 
                               name="description"
                               rows={4}
                               placeholder="Provide full technical details for the permanent record..."
                               className="w-full bg-black/40 border border-white/10 rounded-2xl py-3 px-4 text-sm text-white focus:ring-1 focus:ring-indigo-500/50 outline-none resize-none"
                             />
                          </div>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                           <div className="space-y-2">
                              <label className="text-[10px] text-muted-foreground font-black uppercase tracking-widest ml-1">Severity / Color</label>
                              <select name="type" className="w-full bg-black/40 border border-white/10 rounded-xl py-2 px-4 text-xs text-white focus:ring-1 focus:ring-indigo-500/50 outline-none">
                                <option value="warning">Yellow (Warning)</option>
                                <option value="error">Red (Critical/Outage)</option>
                              </select>
                           </div>
                           <div className="flex items-center space-x-3 pt-6 group/check select-none">
                             <div className="relative inline-flex items-center cursor-pointer">
                               <input 
                                 type="checkbox" 
                                 name="broadcast" 
                                 id="broadcheck" 
                                 className="sr-only peer" 
                               />
                               <div className="w-10 h-5 bg-white/10 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-indigo-600 transition-colors after:shadow-sm"></div>
                             </div>
                             <label htmlFor="broadcheck" className="text-[10px] text-white/50 font-black uppercase tracking-widest cursor-pointer group-hover/check:text-white/80 transition-colors">DM Standard+ Users</label>
                           </div>
                        </div>

                        <button 
                          type="submit"
                          disabled={saving === 'new-notif'}
                          className="w-full py-4 bg-indigo-500 hover:bg-indigo-600 disabled:opacity-50 text-white font-black uppercase tracking-widest rounded-2xl transition-all shadow-[0_0_20px_rgba(99,102,241,0.3)] flex items-center justify-center space-x-2"
                        >
                          {saving === 'new-notif' ? <Activity className="h-5 w-5 animate-spin" /> : <Plus className="h-5 w-5" />}
                          <span>Publish Alert</span>
                        </button>
                      </form>
                    </div>

                    {/* History */}
                    <div className="glass rounded-[2rem] p-8 border border-white/10 space-y-6">
                      <h4 className="text-sm font-black uppercase tracking-[0.2em] text-indigo-300">Notification Audit History</h4>
                      
                      <div className="space-y-4 max-h-[400px] overflow-y-auto pr-2 custom-scrollbar">
                        {notifHistory.length === 0 ? (
                          <div className="py-10 text-center text-muted-foreground text-xs font-black uppercase tracking-widest opacity-50">No prior alerts recorded</div>
                        ) : notifHistory.map((n: any) => (
                          <div key={n.id} className="p-4 bg-white/5 border border-white/5 rounded-2xl flex items-start justify-between group">
                            <div className="space-y-1">
                               <div className="flex items-center space-x-2">
                                  <div className={`w-2 h-2 rounded-full ${n.type === 'error' ? 'bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.5)]' : 'bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.5)]'}`} />
                                  <span className={`text-[10px] font-black uppercase tracking-widest ${n.type === 'error' ? 'text-red-400' : 'text-amber-400'}`}>
                                    {n.type === 'error' ? 'Outage' : 'Warning'}
                                  </span>
                                  {n.active && <span className="bg-emerald-500/20 text-emerald-400 px-2 py-0.5 rounded text-[8px] font-black uppercase border border-emerald-500/20">Active</span>}
                               </div>
                               <p className="text-xs text-white/80 line-clamp-2 leading-relaxed">{n.message}</p>
                               <span className="text-[9px] text-muted-foreground font-bold">{new Date(n.createdAt).toLocaleString()}</span>
                            </div>
                            {!n.active && (
                              <button 
                                onClick={async () => {
                                  setSaving(n.id)
                                  try {
                                    await fetch('/api/admin/notifications', {
                                      method: 'POST',
                                      headers: { 'Content-Type': 'application/json' },
                                      body: JSON.stringify({ message: n.message, type: n.type, broadcast: false, active: true })
                                    })
                                    toastSuccess('Re-published', 'Previous alert has been restored.')
                                    loadNotifs()
                                  } finally {
                                    setSaving(null)
                                  }
                                }}
                                className="p-2 rounded-lg bg-indigo-500/10 text-indigo-400 opacity-0 group-hover:opacity-100 transition-all hover:bg-indigo-500 hover:text-white"
                                title="Re-activate"
                              >
                                <Zap className="h-4 w-4" />
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              ) : activeTab === 'donations' ? (
                <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4">
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-white/5 pb-6">
                    <h3 className="text-xl font-black uppercase tracking-widest text-white flex items-center space-x-3">
                      <Gamepad2 className="h-6 w-6 text-indigo-400" />
                      <span>Steam Key Donations</span>
                    </h3>
                    <div className="text-[10px] font-black uppercase tracking-widest text-muted-foreground bg-white/5 px-4 py-2 rounded-xl border border-white/10">
                      Total Donated: {donations.length}
                    </div>
                  </div>

                  <div className="bg-white/5 border border-white/10 rounded-[2rem] overflow-hidden">
                    <table className="w-full text-left">
                      <thead>
                        <tr className="border-b border-white/10 text-[10px] font-black uppercase tracking-widest text-muted-foreground p-4 bg-white/5">
                          <th className="p-4">Donor</th>
                          <th className="p-4">Game</th>
                          <th className="p-4">Steam Key</th>
                          <th className="p-4 text-center">Status</th>
                          <th className="p-4">Date</th>
                          <th className="p-4 text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-white/5">
                        {donationsLoading ? (
                          <tr><td colSpan={6} className="py-20 text-center text-muted-foreground"><Activity className="h-6 w-6 animate-spin mx-auto mb-2 text-indigo-500" />fetching donations...</td></tr>
                        ) : donations.length === 0 ? (
                          <tr><td colSpan={6} className="py-20 text-center text-muted-foreground italic">No donations found.</td></tr>
                        ) : donations.map(d => {
                          const donorAv = getDiscordCdnAvatarUrl(d.user?.discordId, d.user?.avatar, 48)
                          return (
                          <tr key={d.id} className="hover:bg-white/[0.02] transition-colors group">
                            <td className="p-4">
                              <div className="flex items-center space-x-3">
                                {donorAv && <img src={donorAv} alt="" className="w-6 h-6 rounded-full border border-white/10" />}
                                <div className="flex flex-col">
                                  <span className="text-xs font-bold text-white">{d.user?.username || 'Unknown'}</span>
                                  <span className="text-[9px] font-mono text-muted-foreground opacity-50">{d.user?.discordId}</span>
                                </div>
                              </div>
                            </td>
                            <td className="p-4">
                              <div className="flex items-center space-x-2">
                                <div className="p-1.5 bg-indigo-500/10 rounded flex items-center justify-center">
                                  <Gamepad2 className="h-3 w-3 text-indigo-400" />
                                </div>
                                <span className="text-sm font-bold text-white/90">{d.gameName}</span>
                              </div>
                            </td>
                            <td className="p-4">
                              <div className="flex items-center space-x-2">
                                <code className="text-[10px] bg-black/40 px-2 py-1 rounded border border-white/10 text-indigo-300 font-mono">
                                  {d.steamKey}
                                </code>
                                <button 
                                  onClick={() => {
                                    navigator.clipboard.writeText(d.steamKey)
                                    toastSuccess('Copied', 'Key copied to clipboard')
                                  }}
                                  className="p-1 text-white/30 hover:text-white transition-colors"
                                >
                                  <Layers className="h-3 w-3" />
                                </button>
                              </div>
                            </td>
                            <td className="p-4 text-center">
                              <span className={`text-[9px] font-black px-2 py-0.5 rounded uppercase ${
                                d.status === 'APPROVED' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' :
                                d.status === 'REJECTED' ? 'bg-red-500/10 text-red-400 border border-red-500/20' :
                                'bg-amber-500/10 text-amber-400 border border-amber-500/20 animate-pulse'
                              }`}>
                                {d.status}
                              </span>
                            </td>
                            <td className="p-4 text-[10px] text-white/40 font-mono">
                              {new Date(d.createdAt).toLocaleDateString()}
                            </td>
                            <td className="p-4 text-right">
                              <div className="flex justify-end space-x-2">
                                {d.status === 'PENDING' && (
                                  <>
                                    <button
                                      onClick={() => updateDonationStatus(d.id, 'APPROVED')}
                                      className="p-2 bg-emerald-500/10 text-emerald-400 rounded-lg hover:bg-emerald-500 transition-all"
                                      title="Approve & Notify"
                                    >
                                      <CheckCircle className="h-4 w-4" />
                                    </button>
                                    <button
                                      onClick={() => updateDonationStatus(d.id, 'REJECTED')}
                                      className="p-2 bg-red-500/10 text-red-400 rounded-lg hover:bg-red-500 transition-all"
                                      title="Reject & Notify"
                                    >
                                      <XCircle className="h-4 w-4" />
                                    </button>
                                  </>
                                )}
                                <button
                                  onClick={() => deleteDonation(d.id)}
                                  className="p-2 bg-white/5 text-white/30 rounded-lg hover:bg-red-500/20 hover:text-red-500 transition-all"
                                  title="Delete Record"
                                >
                                  <Trash className="h-4 w-4" />
                                </button>
                              </div>
                            </td>
                          </tr>
                        )})}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : activeTab === 'chat' ? (
                <ChatTabComponent 
                  session={session} 
                  messages={chatMessages} 
                  loading={chatLoading} 
                  chatEndRef={chatEndRef}
                  setMessages={setChatMessages}
                  toastError={toastError}
                />
              ) : activeTab === 'hosted-bots' && currentUserRole === 'OWNER' ? (
                <HostedBotAdminPanel toastSuccess={toastSuccess} toastError={toastError} />
              ) : activeTab === 'members-shop' && currentUserRole === 'OWNER' ? (
                <MembersShopPanel variant="owner" toastSuccess={toastSuccess} toastError={toastError} />
              ) : activeTab === 'vouchers' && currentUserRole === 'OWNER' ? (
                <VouchersPanel toastSuccess={toastSuccess} toastError={toastError} />
              ) : activeTab === 'plan-upgrade' && currentUserRole === 'OWNER' ? (
                <PlanUpgradePanel toastSuccess={toastSuccess} toastError={toastError} />
              ) : activeTab === 'settings' ? (
                <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4">
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-white/5 pb-6">
                    <h3 className="text-xl font-black uppercase tracking-widest text-white flex items-center space-x-3">
                      <LayoutGrid className="h-6 w-6 text-indigo-400" />
                      <span>System Settings & Configuration</span>
                    </h3>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                    {/* Discord Bot Config */}
                    <div className="space-y-6">
                      <div className="flex items-center space-x-3 text-indigo-300">
                         <Smartphone className="h-5 w-5" />
                         <h4 className="text-xs font-black uppercase tracking-widest">Discord & Team Infrastructure</h4>
                      </div>
                      
                      <div className="bg-white/5 border border-white/10 rounded-[2rem] p-6 space-y-4">
                        {[
                          { key: 'DISCORD_CLIENT_ID', label: 'Client ID', secret: false },
                          { key: 'DISCORD_CLIENT_SECRET', label: 'Client Secret', secret: true },
                          { key: 'DISCORD_BOT_TOKEN', label: 'Bot Token', secret: true },
                          { key: 'DISCORD_ADMIN_PUBLIC_KEY', label: 'Interaction Public Key', secret: true },
                          { key: 'DISCORD_ALERTS_CHANNEL_ID', label: 'Alerts Channel ID', secret: false },
                          { key: 'DISCORD_AI_CHAT_CHANNEL_ID', label: 'AI Chat Channel ID', secret: false },
                          { key: 'DISCORD_GUILD_ID', label: 'Guild ID', secret: false },
                          { key: 'DISCORD_STAFF_CHANNEL_ID', label: 'Staff Channel ID', secret: false },
                          { key: 'DISCORD_DROP_CHANNEL_ID', label: 'Drop Channel ID', secret: false },
                          { key: 'DISCORD_MANIFEST_UPLOAD_CHANNEL_ID', label: 'Manifest Upload Channel ID', secret: false },
                          { key: 'DISCORD_DROP_ROLE_ID', label: 'Drop Ping Role ID', secret: false },
                          { key: 'DISCORD_DROP_MODE', label: 'Drop Mode (RECYCLE/CONSUME)', secret: false },
                          { key: 'DISCORD_BOT_ENABLED', label: 'Bot Enabled (true/false)', secret: false },
                          { key: 'DISCORD_VERIFY_ENABLED', label: 'Verify Enabled (true/false)', secret: false },
                          { key: 'DISCORD_UNVERIFIED_ROLE_ID', label: 'Unverified Role ID', secret: false },
                          { key: 'DISCORD_VERIFIED_ROLE_ID', label: 'Verified Role ID', secret: false },
                          { key: 'DISCORD_VERIFY_CHANNEL_ID', label: 'Verify Channel ID', secret: false },
                          { key: 'DISCORD_VERIFY_MESSAGE_ID', label: 'Verify Message ID (auto)', secret: false },
                          { key: 'DISCORD_VERIFY_BANNER_URL', label: 'Verify Banner URL', secret: false },
                          { key: 'DISCORD_VERIFY_ALT_BLOCK_MODE', label: 'Alt Block Mode (off/strong/any/custom)', secret: false },
                          { key: 'DISCORD_VERIFY_ALT_BLOCK_FLAGS', label: 'Alt Block Flags (custom comma list)', secret: false },
                          { key: 'DISCORD_BACKUP_BOT_TOKEN', label: 'Backup Bot Token', secret: true },
                          { key: 'DISCORD_BACKUP_CLIENT_ID', label: 'Backup Client ID', secret: false },
                          { key: 'DISCORD_BACKUP_CLIENT_SECRET', label: 'Backup Client Secret', secret: true },
                          { key: 'DISCORD_BOT_FAILOVER_MODE', label: 'Failover Mode (primary/backup/auto)', secret: false },
                          { key: 'DISCORD_BOT_QUARANTINED', label: 'Bot Quarantined (true/false)', secret: false },
                          { key: 'DISCORD_BACKUP_VERIFY_MESSAGE_ID', label: 'Backup Verify Message ID (auto)', secret: false },
                          { key: 'DISCORD_AUTO_OUTAGE_BANNER', label: 'Auto Outage Banner (true/false)', secret: false }
                        ].map(field => {
                          const config = configs.find(c => c.key === field.key)
                          return (
                            <div key={field.key} className="space-y-2">
                               <label className="text-[10px] text-muted-foreground font-black uppercase tracking-widest ml-1">{field.label}</label>
                               <div className="flex space-x-2">
                                  <input 
                                    type={field.secret ? "password" : "text"}
                                    defaultValue={config?.isSecret ? (config.hasValue ? '••••••••••••••••' : '') : config?.value || ''}
                                    placeholder={`Enter ${field.label}...`}
                                    onBlur={(e) => {
                                      const val = e.target.value
                                      if (val && val !== '••••••••••••••••') {
                                        saveConfig(field.key, val, field.secret)
                                      }
                                    }}
                                    className="flex-1 bg-black/40 border border-white/10 rounded-xl py-2 px-4 text-xs text-white font-mono focus:ring-1 focus:ring-indigo-500/50 outline-none"
                                  />
                                  {saving === field.key && <Activity className="h-4 w-4 text-indigo-500 animate-spin self-center" />}
                               </div>
                            </div>
                          )
                        })}

                        <div className="mt-4 p-4 bg-red-500/5 border border-red-500/20 rounded-2xl space-y-3">
                          <p className="text-[10px] font-black uppercase tracking-widest text-red-300">Bot Failover (backup app)</p>
                          <div className="grid grid-cols-2 md:grid-cols-5 gap-2 text-[10px]">
                            <div className="p-2 rounded-lg bg-black/30 border border-white/5">
                              <p className="text-muted-foreground uppercase font-black">Mode</p>
                              <p className="text-white font-bold">{failoverStatus?.mode || '—'}</p>
                            </div>
                            <div className="p-2 rounded-lg bg-black/30 border border-white/5">
                              <p className="text-muted-foreground uppercase font-black">DM / OAuth</p>
                              <p className={`font-bold ${failoverStatus?.activeSource === 'backup' ? 'text-amber-400' : 'text-emerald-400'}`}>
                                {failoverStatus?.activeSource || '—'}
                              </p>
                            </div>
                            <div className="p-2 rounded-lg bg-black/30 border border-white/5">
                              <p className="text-muted-foreground uppercase font-black">Guild cmds</p>
                              <p className={`font-bold ${failoverStatus?.guildSource === 'backup' ? 'text-amber-400' : 'text-emerald-400'}`}>
                                {failoverStatus?.guildSource || failoverStatus?.activeSource || '—'}
                              </p>
                            </div>
                            <div className="p-2 rounded-lg bg-black/30 border border-white/5">
                              <p className="text-muted-foreground uppercase font-black">Quarantined</p>
                              <p className={`font-bold ${failoverStatus?.quarantined ? 'text-red-400' : 'text-white'}`}>
                                {failoverStatus?.quarantined ? 'Yes' : 'No'}
                              </p>
                            </div>
                            <div className="p-2 rounded-lg bg-black/30 border border-white/5">
                              <p className="text-muted-foreground uppercase font-black">Tokens</p>
                              <p className="text-white font-bold">
                                {failoverStatus?.hasPrimaryToken ? 'P' : '—'}/{failoverStatus?.hasBackupToken ? 'B' : '—'}
                              </p>
                            </div>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <button type="button" disabled={failoverLoading} onClick={() => handleFailoverAction('set_mode', { mode: 'primary' })} className="px-3 py-1.5 text-[10px] font-black uppercase rounded-lg border border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/10 disabled:opacity-50">Force primary</button>
                            <button type="button" disabled={failoverLoading} onClick={() => handleFailoverAction('set_mode', { mode: 'backup' })} className="px-3 py-1.5 text-[10px] font-black uppercase rounded-lg border border-amber-500/30 text-amber-300 hover:bg-amber-500/10 disabled:opacity-50">Force backup</button>
                            <button type="button" disabled={failoverLoading} onClick={() => handleFailoverAction('set_mode', { mode: 'auto' })} className="px-3 py-1.5 text-[10px] font-black uppercase rounded-lg border border-indigo-500/30 text-indigo-300 hover:bg-indigo-500/10 disabled:opacity-50">Auto</button>
                            <button type="button" disabled={failoverLoading} onClick={() => handleFailoverAction('clear_quarantine')} className="px-3 py-1.5 text-[10px] font-black uppercase rounded-lg border border-white/10 text-white/70 hover:bg-white/5 disabled:opacity-50">Clear quarantine</button>
                            <button type="button" disabled={failoverLoading} onClick={() => handleFailoverAction('test_dm')} className="px-3 py-1.5 text-[10px] font-black uppercase rounded-lg border border-indigo-500/30 text-indigo-300 hover:bg-indigo-500/10 disabled:opacity-50">Test DM to me</button>
                            {failoverStatus?.backupInviteUrl && (
                              <a href={failoverStatus.backupInviteUrl} target="_blank" rel="noopener noreferrer" className="px-3 py-1.5 text-[10px] font-black uppercase rounded-lg border border-indigo-500/30 text-indigo-300 hover:bg-indigo-500/10">Invite backup bot</a>
                            )}
                          </div>
                        </div>



                        {(() => {
                          const clientId = configs.find(c => c.key === 'DISCORD_CLIENT_ID')?.value
                          const hasClientId = configs.find(c => c.key === 'DISCORD_CLIENT_ID')?.hasValue
                          const hasToken = configs.find(c => c.key === 'DISCORD_BOT_TOKEN')?.hasValue
                          const hasSecret = configs.find(c => c.key === 'DISCORD_CLIENT_SECRET')?.hasValue
                          
                          if (hasClientId && hasToken && hasSecret && clientId && clientId !== '••••••••••••••••') {
                            const inviteEndpoint = '/api/admin/bot/invite?redirect=1'
                            return (
                              <div className="mt-6 space-y-4">
                                <div className="p-4 bg-indigo-500/10 border border-indigo-500/20 rounded-2xl animate-in fade-in zoom-in-95">
                                  <div className="flex items-center justify-between mb-2">
                                    <div className="flex items-center space-x-2">
                                      <div className={`w-2 h-2 rounded-full ${botStatus === 'RUNNING' ? 'bg-emerald-500 animate-pulse' : 'bg-zinc-500'}`} />
                                      <span className="text-[10px] font-black uppercase text-indigo-300">Bot Controller</span>
                                    </div>
                                    <CheckCircle className="h-4 w-4 text-emerald-400" />
                                  </div>

                                  <div className="grid grid-cols-3 gap-2 mb-4">
                                    <button
                                      type="button"
                                      disabled={botLoading || botStatus === 'RUNNING'}
                                      onClick={() => handleBotAction('STATUS_CHANGE', 'RUNNING')}
                                      className="py-1.5 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 text-[9px] font-black uppercase rounded-lg border border-emerald-500/20 disabled:opacity-30 transition-all"
                                    >
                                      Start
                                    </button>
                                    <button
                                      type="button"
                                      disabled={botLoading}
                                      onClick={() => handleBotAction('STATUS_CHANGE', 'RUNNING')}
                                      className="py-1.5 bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 text-[9px] font-black uppercase rounded-lg border border-amber-500/20 transition-all"
                                    >
                                      Restart
                                    </button>
                                    <button
                                      type="button"
                                      disabled={botLoading || botStatus === 'IDLE'}
                                      onClick={() => handleBotAction('STATUS_CHANGE', 'IDLE')}
                                      className="py-1.5 bg-red-500/10 hover:bg-red-500/20 text-red-400 text-[9px] font-black uppercase rounded-lg border border-red-500/20 disabled:opacity-30 transition-all"
                                    >
                                      Stop
                                    </button>
                                  </div>

                                  <div className="flex flex-col space-y-2">
                                    <button 
                                      type="button"
                                      onClick={() => handleBotAction('REGISTER')}
                                      disabled={botLoading}
                                      className="w-full py-2 bg-white/5 hover:bg-white/10 text-white text-[10px] font-black uppercase tracking-widest rounded-xl transition-all flex items-center justify-center space-x-2 border border-white/10"
                                    >
                                      <Activity className={`h-3.5 w-3.5 ${botLoading ? 'animate-spin' : ''}`} />
                                      <span>Sync Slash Commands</span>
                                    </button>

                                    <button 
                                      type="button"
                                      onClick={() => setShowDropModal(true)}
                                      disabled={botLoading || dropLoading}
                                      className="w-full py-2 bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-400 text-[10px] font-black uppercase tracking-widest rounded-xl transition-all flex items-center justify-center space-x-2 border border-indigo-500/20"
                                    >
                                      <Gift className="h-3.5 w-3.5" />
                                      <span>Trigger Account Drop</span>
                                    </button>

                                    <div className="pt-2 border-t border-white/5 space-y-2">
                                      <p className="text-[9px] font-black uppercase text-indigo-300/60 ml-1">Global Broadcast (Self-Adv)</p>
                                      <textarea 
                                        value={broadcastMessage}
                                        onChange={(e) => setBroadcastMessage(e.target.value)}
                                        placeholder="Enter announcement message..."
                                        rows={3}
                                        className="w-full bg-black/40 border border-white/10 rounded-xl py-2 px-3 text-[10px] text-white focus:ring-1 focus:ring-indigo-500/50 outline-none resize-none"
                                      />
                                      <button 
                                        type="button"
                                        onClick={handleBroadcast}
                                        disabled={broadcastLoading || !broadcastMessage.trim() || (broadcastProgress && (broadcastProgress.status === 'RUNNING' || broadcastProgress.status === 'WAITING_RATE_LIMIT'))}
                                        className="w-full py-2 bg-indigo-500/20 hover:bg-indigo-500 text-indigo-400 hover:text-white text-[10px] font-black uppercase tracking-widest rounded-xl transition-all flex items-center justify-center space-x-2 border border-indigo-500/30 disabled:opacity-30 shadow-lg shadow-indigo-500/10"
                                      >
                                        {(broadcastLoading || (broadcastProgress && (broadcastProgress.status === 'RUNNING' || broadcastProgress.status === 'WAITING_RATE_LIMIT'))) ? <Activity className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                                        <span>{broadcastProgress?.status === 'RUNNING' || broadcastProgress?.status === 'WAITING_RATE_LIMIT' ? 'Broadcast in Progress...' : 'Start Global Broadcast'}</span>
                                      </button>

                                      {broadcastProgress && broadcastProgress.status !== 'IDLE' && (
                                        <div className="mt-2 p-2 bg-indigo-500/5 rounded-lg border border-indigo-500/10 space-y-1.5 animate-in fade-in slide-in-from-top-1">
                                          <div className="flex justify-between items-center text-[8px] font-black uppercase tracking-widest">
                                            <span className={broadcastProgress.status === 'WAITING_RATE_LIMIT' ? 'text-amber-400 animate-pulse' : 'text-indigo-300'}>
                                              {broadcastProgress.status === 'WAITING_RATE_LIMIT' ? 'Rate Limited - Waiting...' : `Status: ${broadcastProgress.status}`}
                                            </span>
                                            <span className="text-white">{broadcastProgress.current} / {broadcastProgress.total}</span>
                                          </div>
                                          <div className="h-1 w-full bg-white/5 rounded-full overflow-hidden">
                                            <div 
                                              className={`h-full transition-all duration-500 ${broadcastProgress.status === 'WAITING_RATE_LIMIT' ? 'bg-amber-500' : 'bg-indigo-500'}`}
                                              style={{ width: `${(broadcastProgress.current / (broadcastProgress.total || 1)) * 100}%` }}
                                            />
                                          </div>
                                          <div className="flex justify-between text-[7px] font-bold text-muted-foreground uppercase">
                                            <span className="text-emerald-400/80">Success: {broadcastProgress.success}</span>
                                            <span className="text-red-400/80">Failed: {broadcastProgress.fail}</span>
                                          </div>
                                          {(broadcastProgress.status === 'RUNNING' || broadcastProgress.status === 'WAITING_RATE_LIMIT') && (
                                            <button
                                              type="button"
                                              onClick={handleClearBroadcast}
                                              className="w-full mt-1 py-1.5 bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 text-[8px] font-black uppercase tracking-widest rounded-lg border border-amber-500/20 transition-all"
                                            >
                                              Clear stuck broadcast &amp; unlock
                                            </button>
                                          )}
                                        </div>
                                      )}
                                    </div>

                                    <div className="pt-2 border-t border-white/5 space-y-2">
                                      <p className="text-[9px] font-black uppercase text-indigo-300/60 ml-1">Member Pullback</p>
                                      <input
                                        type="text"
                                        value={pullbackUserId}
                                        onChange={(e) => setPullbackUserId(e.target.value)}
                                        placeholder="OpenSteam user ID or Discord ID (leave empty for all)"
                                        className="w-full bg-black/40 border border-white/10 rounded-xl py-2 px-3 text-[10px] text-white font-mono focus:ring-1 focus:ring-indigo-500/50 outline-none"
                                      />
                                      <button
                                        type="button"
                                        onClick={handlePullback}
                                        disabled={pullbackLoading}
                                        className="w-full py-2 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 text-[10px] font-black uppercase tracking-widest rounded-xl transition-all flex items-center justify-center space-x-2 border border-emerald-500/20 disabled:opacity-30"
                                      >
                                        {pullbackLoading ? <Activity className="h-3.5 w-3.5 animate-spin" /> : <ArrowRightLeft className="h-3.5 w-3.5" />}
                                        <span>{pullbackUserId.trim() ? 'Pullback User' : 'Pullback All'}</span>
                                      </button>
                                      <p className="text-[8px] text-muted-foreground leading-relaxed px-1">
                                        Uses saved OAuth tokens to re-add members to <code className="text-indigo-300/80">DISCORD_GUILD_ID</code>. Target user must have signed in to OpenSteam with <code className="text-indigo-300/80">guilds.join</code>.
                                      </p>
                                    </div>

                                    <a 
                                      href={inviteEndpoint} 
                                      target="_blank" 
                                      rel="noopener noreferrer"
                                      className="w-full py-2 bg-indigo-500 hover:bg-indigo-600 text-white text-[10px] font-black uppercase tracking-widest rounded-xl transition-all flex items-center justify-center space-x-2 shadow-lg shadow-indigo-500/20"
                                    >
                                      <Smartphone className="h-3.5 w-3.5" />
                                      <span>Generate Bot Invite</span>
                                    </a>
                                    <p className="text-[8px] text-muted-foreground leading-relaxed px-1">
                                      Owner-only gateway: <code className="text-indigo-300/80">GET /api/admin/bot/invite</code> — client ID is never exposed in the UI.
                                    </p>
                                  </div>
                                  
                                  <div className="mt-4 p-3 bg-indigo-500/5 border border-indigo-500/20 rounded-xl">
                                    <div className="flex items-center space-x-2 mb-1">
                                      <ShieldCheck className="h-3 w-3 text-indigo-400" />
                                      <span className="text-[9px] font-black uppercase text-indigo-400">WebSocket Daemon Active</span>
                                    </div>
                                    <p className="text-[9px] text-indigo-200/70 leading-relaxed">
                                      The bot is now running as a <b>Persistent Daemon</b>. It stays online in your Discord server and responds to interactions via WebSockets. Ensure you run <code>npm run bot</code> in your production environment.
                                      <br /><br />
                                      <b>IMPORTANT:</b> Go to your Discord Developer Portal and <u>CLEAR</u> the "Interactions Endpoint URL" field so interactions are routed to the daemon.
                                    </p>
                                  </div>
                                </div>
                              </div>
                            )
                          }
                          return null
                        })()}
                      </div>
                    </div>

                    {/* S3 Storage Configuration */}
                    <div className="space-y-6">
                      <div className="flex items-center space-x-3 text-amber-300">
                         <Database className="h-5 w-5" />
                         <h4 className="text-xs font-black uppercase tracking-widest">S3-Compatible Storage</h4>
                      </div>
                      
                      <div className="bg-white/5 border border-white/10 rounded-[2rem] p-6 space-y-4">
                        {[
                          { key: 'AWS_ACCESS_KEY_ID', label: 'Access Key ID', secret: false },
                          { key: 'AWS_SECRET_ACCESS_KEY', label: 'Secret Access Key', secret: true },
                          { key: 'AWS_DEFAULT_REGION', label: 'Region', secret: false },
                          { key: 'AWS_ENDPOINT_URL', label: 'Endpoint URL (e.g. R2/MinIO)', secret: false },
                          { key: 'AWS_S3_BUCKET_NAME', label: 'Bucket Name', secret: false }
                        ].map(field => {
                          const config = configs.find(c => c.key === field.key)
                          return (
                            <div key={field.key} className="space-y-2">
                               <label className="text-[10px] text-muted-foreground font-black uppercase tracking-widest ml-1">{field.label}</label>
                               <div className="flex space-x-2">
                                  <input 
                                    type={field.secret ? "password" : "text"}
                                    defaultValue={config?.isSecret ? (config.hasValue ? '••••••••••••••••' : '') : config?.value || ''}
                                    placeholder={`Enter ${field.label}...`}
                                    onBlur={(e) => {
                                      const val = e.target.value
                                      if (val && val !== '••••••••••••••••') {
                                        saveConfig(field.key, val, field.secret)
                                      }
                                    }}
                                    className="flex-1 bg-black/40 border border-white/10 rounded-xl py-2 px-4 text-xs text-white font-mono focus:ring-1 focus:ring-indigo-500/50 outline-none"
                                  />
                                  {saving === field.key && <Activity className="h-4 w-4 text-indigo-500 animate-spin self-center" />}
                               </div>
                            </div>
                          )
                        })}
                      </div>
                    </div>

                    {/* Global API Defaults */}
                    <div className="space-y-6">
                      <div className="flex items-center space-x-3 text-emerald-300">
                         <Key className="h-5 w-5" />
                         <h4 className="text-xs font-black uppercase tracking-widest">Global API Parameters</h4>
                      </div>
                      
                      <div className="bg-white/5 border border-white/10 rounded-[2rem] p-6 space-y-4">
                        {[
                          { key: 'GLOBAL_RATE_LIMIT', label: 'Default Daily Limit', secret: false, type: 'number' },
                          { key: 'GLOBAL_BURST_LIMIT', label: 'Default Burst (req/min)', secret: false, type: 'number' },
                          { key: 'AUTOGEN_ENABLED', label: 'Daily Autogen Enabled', secret: false, type: 'text', envFallback: true },
                          { key: 'AUTOGEN_MODE', label: 'Autogen Mode (requests or depotbox)', secret: false, type: 'text', envFallback: true },
                          { key: 'AUTOGEN_PROVIDER_ORDER', label: 'Global Autogen Source Order', secret: false, type: 'text', envFallback: true },
                          { key: 'AUTOGEN_DAILY_LIMIT', label: 'Daily Request Autogen Limit', secret: false, type: 'number', envFallback: true },
                          { key: 'AUTOGEN_DEPOTBOX_DAILY_LIMIT', label: 'Daily DepotBox Autogen Limit', secret: false, type: 'number', envFallback: true },
                          { key: 'AUTOGEN_DEPOTBOX_SPREAD_HOURS', label: 'DepotBox Spread Window (hours)', secret: false, type: 'number', envFallback: true },
                          { key: 'DEPOTBOX_REQUESTS_PER_MINUTE', label: 'DepotBox API Rate Limit (req/min)', secret: false, type: 'number', envFallback: true },
                          { key: 'AUTOGEN_OPERATOR_DISCORD_ID', label: 'Autogen Operator Discord ID', secret: false, type: 'text', envFallback: true },
                          { key: 'DEPOTBOX_API_KEY', label: 'DepotBox API Key', secret: true, type: 'text', envFallback: true },
                          { key: 'RYUU_API_KEY', label: 'Internal Ryuu Key', secret: true, type: 'text', envFallback: true },
                          { key: 'MORRENUS_API_KEY', label: 'Internal Morrenus Key', secret: true, type: 'text', envFallback: true }
                        ].map(field => {
                          const config = configs.find(c => c.key === field.key)
                          return (
                            <div key={field.key} className="space-y-2">
                               <div className="flex items-center justify-between px-1">
                                 <label className="text-[10px] text-muted-foreground font-black uppercase tracking-widest">{field.label}</label>
                                 {config?.value === 'ENV' && (
                                   <span className="text-[8px] font-black uppercase tracking-tighter text-indigo-400 bg-indigo-500/10 px-1.5 py-0.5 rounded border border-indigo-500/20">Managed via ENV</span>
                                 )}
                               </div>
                               <div className="flex space-x-2">
                                  <input 
                                    type={field.secret ? "password" : "text"}
                                    defaultValue={config?.value === 'ENV' ? '••••••••••••••••' : (config?.isSecret ? (config.hasValue ? '••••••••••••••••' : '') : config?.value || '')}
                                    placeholder={config?.value === 'ENV' ? "Sensitive (from variable)" : `Enter ${field.label}...`}
                                    onBlur={(e) => {
                                      const val = e.target.value
                                      if (val && val !== '••••••••••••••••' && config?.value !== 'ENV') {
                                        saveConfig(field.key, val, field.secret)
                                      }
                                    }}
                                    className={`flex-1 bg-black/40 border border-white/10 rounded-xl py-2 px-4 text-xs text-white font-mono focus:ring-1 focus:ring-indigo-500/50 outline-none ${config?.value === 'ENV' ? 'opacity-70 grayscale' : ''}`}
                                    disabled={config?.value === 'ENV'}
                                  />
                                  {saving === field.key && <Activity className="h-4 w-4 text-indigo-500 animate-spin self-center" />}
                               </div>
                            </div>
                          )
                        })}
                      </div>
                    </div>

                    {/* Email Infrastructure */}
                    <div className="space-y-6">
                      <div className="flex items-center space-x-3 text-indigo-400">
                         <Bell className="h-5 w-5" />
                         <h4 className="text-xs font-black uppercase tracking-widest">Email Infrastructure (Resend/SMTP)</h4>
                      </div>
                      
                      <div className="bg-white/5 border border-white/10 rounded-[2rem] p-6 space-y-4">
                        <div className="p-4 bg-indigo-500/10 border border-indigo-500/20 rounded-2xl mb-4">
                          <p className="text-[10px] text-indigo-200/70 leading-relaxed italic">
                            System prioritizes <b>Resend API</b> over standard SMTP. If Resend key is provided, standard SMTP ports (465/587) will be bypassed.
                          </p>
                        </div>

                        {[
                          { key: 'RESEND_API_KEY', label: 'Resend API Key', secret: true },
                          { key: 'RESEND_FROM', label: 'Resend From Address', secret: false },
                          { key: 'RESEND_INBOUND_ADDRESS', label: 'Resend Inbound Address', secret: false },
                          { key: 'RESEND_WEBHOOK_SECRET', label: 'Resend Webhook Secret', secret: true },
                          { key: 'SUPPORT_RECIPIENT', label: 'Support Ticket Recipient Email', secret: false },
                          { key: 'SMTP_HOST', label: 'SMTP Host', secret: false },
                          { key: 'SMTP_PORT', label: 'SMTP Port', secret: false },
                          { key: 'SMTP_USER', label: 'SMTP User', secret: false },
                          { key: 'SMTP_PASS', label: 'SMTP Pass', secret: true },
                          { key: 'SMTP_FROM', label: 'SMTP From Address', secret: false }
                        ].map(field => {
                          const config = configs.find(c => c.key === field.key)
                          return (
                            <div key={field.key} className="space-y-2">
                               <label className="text-[10px] text-muted-foreground font-black uppercase tracking-widest ml-1">{field.label}</label>
                               <div className="flex space-x-2">
                                  <input 
                                    type={field.secret ? "password" : "text"}
                                    defaultValue={config?.isSecret ? (config.hasValue ? '••••••••••••••••' : '') : config?.value || ''}
                                    placeholder={`Enter ${field.label}...`}
                                    onBlur={(e) => {
                                      const val = e.target.value
                                      if (val && val !== '••••••••••••••••') {
                                        saveConfig(field.key, val, field.secret)
                                      }
                                    }}
                                    className="flex-1 bg-black/40 border border-white/10 rounded-xl py-2 px-4 text-xs text-white font-mono focus:ring-1 focus:ring-indigo-500/50 outline-none"
                                  />
                                  {saving === field.key && <Activity className="h-4 w-4 text-indigo-500 animate-spin self-center" />}
                               </div>
                            </div>
                          )
                        })}

                        <div className="pt-4 border-t border-white/5">
                           <button 
                             onClick={handleTestEmail}
                             disabled={testEmailLoading}
                             className="w-full py-3 bg-indigo-500 hover:bg-indigo-600 text-white text-xs font-black uppercase tracking-widest rounded-xl transition-all shadow-lg shadow-indigo-500/20 flex items-center justify-center space-x-3 disabled:opacity-50"
                           >
                             {testEmailLoading ? <RotateCcw className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                             <span>Test Delivery (to pokemgo300@gmail.com)</span>
                           </button>
                        </div>
                      </div>
                    </div>

                    {/* Recruitment & Google Integration */}
                    <div className="space-y-6 pt-4">
                      <div className="flex items-center space-x-3 text-indigo-400">
                         <ClipboardList className="h-5 w-5" />
                         <h4 className="text-xs font-black uppercase tracking-widest">Recruitment & Google Integration</h4>
                      </div>
                      <div className="bg-white/5 border border-white/10 rounded-[2.5rem] p-8">
                         <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                            <div className="space-y-4">
                               <div className="space-y-2">
                                  <label className="text-[10px] text-muted-foreground font-black uppercase tracking-widest ml-1">Google Service Account JSON</label>
                                  <textarea 
                                    placeholder='{"type": "service_account", ...}'
                                    className="w-full bg-black/40 border border-white/10 rounded-2xl py-4 px-6 text-[10px] text-white font-mono focus:ring-2 focus:ring-indigo-500/50 outline-none transition-all h-32 resize-none"
                                    defaultValue={configs.find(c => c.key === 'GOOGLE_SERVICE_ACCOUNT')?.hasValue ? '••••••••••••••••' : ''}
                                    onBlur={(e) => {
                                      const val = e.target.value
                                      if (val && val !== '••••••••••••••••') {
                                        saveConfig('GOOGLE_SERVICE_ACCOUNT', val, true)
                                      }
                                    }}
                                  />
                                  <p className="text-[9px] text-muted-foreground leading-relaxed px-1">
                                     Paste your Google Cloud Service Account JSON key here. Ensure the service account has <b>Google Forms API</b> scopes enabled.
                                  </p>
                               </div>
                            </div>
                            <div className="space-y-4">
                               <div className="p-6 bg-indigo-500/10 border border-indigo-500/20 rounded-2xl">
                                  <h5 className="text-[10px] font-black uppercase text-indigo-300 mb-2">Integration Status</h5>
                                  <div className="space-y-3">
                                     <div className="flex items-center justify-between">
                                        <span className="text-[9px] text-white/50 font-bold uppercase">Discord Results Channel</span>
                                        <span className="text-[9px] font-black text-white bg-white/10 px-2 py-0.5 rounded">#1497850215271497808</span>
                                     </div>
                                     <div className="flex items-center justify-between">
                                        <span className="text-[9px] text-white/50 font-bold uppercase">Pass Threshold</span>
                                        <span className="text-[9px] font-black text-emerald-400">{APPLICATION_PASS_SCORE} / {APPLICATION_MAX_SCORE} Points</span>
                                     </div>
                                  </div>
                               </div>
                            </div>
                         </div>
                      </div>
                    </div>

                    {/* VaultCord Members Shop */}
                    <div className="space-y-6 pt-4">
                      <div className="flex items-center space-x-3 text-emerald-400">
                         <ShoppingCart className="h-5 w-5" />
                         <h4 className="text-xs font-black uppercase tracking-widest">VaultCord Members Shop</h4>
                      </div>
                      
                      <div className="bg-white/5 border border-white/10 rounded-[2rem] p-6 space-y-4">
                        {[
                          { key: 'VAULTCORD_API_KEY', label: 'VaultCord API Key', secret: true }
                        ].map(field => {
                          const config = configs.find(c => c.key === field.key)
                          return (
                            <div key={field.key} className="space-y-2">
                               <label className="text-[10px] text-muted-foreground font-black uppercase tracking-widest ml-1">{field.label}</label>
                               <div className="flex space-x-2">
                                  <input 
                                    type={field.secret ? "password" : "text"}
                                    defaultValue={config?.isSecret ? (config.hasValue ? '••••••••••••••••' : '') : config?.value || ''}
                                    placeholder={`Enter ${field.label}...`}
                                    onBlur={(e) => {
                                      const val = e.target.value
                                      if (val && val !== '••••••••••••••••') {
                                        saveConfig(field.key, val, field.secret)
                                      }
                                    }}
                                    className="flex-1 bg-black/30 border border-white/10 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-emerald-500/50 transition-all"
                                  />
                               </div>
                            </div>
                          )
                        })}
                        <p className="text-[10px] text-muted-foreground">
                          Used by Admin → Members Shop to buy and pull Discord members via VaultCord marketplace.
                        </p>
                      </div>
                    </div>

                    {/* Trello Integration */}
                    <div className="space-y-6 pt-4">
                      <div className="flex items-center space-x-3 text-blue-400">
                         <Layers className="h-5 w-5" />
                         <h4 className="text-xs font-black uppercase tracking-widest">Trello Board Integration</h4>
                      </div>
                      
                      <div className="bg-white/5 border border-white/10 rounded-[2rem] p-6 space-y-4">
                        {[
                          { key: 'TRELLO_API_KEY', label: 'Trello API Key', secret: true },
                          { key: 'TRELLO_API_TOKEN', label: 'Trello API Token', secret: true },
                          { key: 'TRELLO_BOARD_ID', label: 'Trello Board ID', secret: false }
                        ].map(field => {
                          const config = configs.find(c => c.key === field.key)
                          return (
                            <div key={field.key} className="space-y-2">
                               <label className="text-[10px] text-muted-foreground font-black uppercase tracking-widest ml-1">{field.label}</label>
                               <div className="flex space-x-2">
                                  <input 
                                    type={field.secret ? "password" : "text"}
                                    defaultValue={config?.isSecret ? (config.hasValue ? '••••••••••••••••' : '') : config?.value || ''}
                                    placeholder={`Enter ${field.label}...`}
                                    onBlur={(e) => {
                                      const val = e.target.value
                                      if (val && val !== '••••••••••••••••') {
                                        saveConfig(field.key, val, field.secret)
                                      }
                                    }}
                                    className="flex-1 bg-black/40 border border-white/10 rounded-xl py-2 px-4 text-xs text-white font-mono focus:ring-1 focus:ring-blue-500/50 outline-none"
                                  />
                                  {saving === field.key && <Activity className="h-4 w-4 text-blue-500 animate-spin self-center" />}
                               </div>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  </div>
                </div>
              ) : activeTab === 'generations' ? (
                <GenerationsPanel />
              ) : activeTab === 'telegram-promos' ? (
                <TelegramPromosPanel />
              ) : activeTab === 'manifests' ? (
                <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4">
                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    <div className="lg:col-span-1 glass rounded-[2rem] p-6 border border-white/10">
                      <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground mb-4">Registry name health</p>
                      <ManifestHealthDonut
                        total={stats?.manifests || manifestTotalCount}
                        placeholderCount={manifestPlaceholderCount}
                      />
                    </div>
                    <div className="lg:col-span-2 glass rounded-[2rem] p-6 border border-amber-500/20 bg-amber-500/5 space-y-3">
                      <p className="text-sm font-bold text-white">Do you need to touch existing manifests?</p>
                      <ul className="text-xs text-muted-foreground space-y-2 list-disc pl-4 leading-relaxed">
                        <li><strong className="text-white/90">ZIP files are fine</strong> — if games download correctly, you do not need to re-upload.</li>
                        <li><strong className="text-amber-300">Placeholder names</strong> (e.g. App 730) — click <strong>Backfill Names</strong> below; Steam titles are fetched and saved to the DB only.</li>
                        <li><strong className="text-white/90">New deploy</strong> — run <code className="text-indigo-300">npx prisma migrate deploy</code> once for the latest schema.</li>
                      </ul>
                    </div>
                  </div>
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <h3 className="text-xl font-black uppercase tracking-widest text-white flex items-center space-x-3">
                      <Database className="h-6 w-6 text-indigo-400" />
                      <span>Manifest Repository</span>
                      {manifestPlaceholderCount > 0 && (
                        <span className="text-[9px] font-black uppercase px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30">
                          {manifestPlaceholderCount} placeholder names
                        </span>
                      )}
                    </h3>
                    
                    <div className="flex items-center space-x-3">
                      <div className="relative group">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <input 
                          type="text"
                          placeholder="Search AppID/Name..."
                          value={manifestSearch}
                          onChange={(e) => setManifestSearch(e.target.value)}
                          onKeyDown={(e) => e.key === 'Enter' && reloadTab('manifests')}
                          className="bg-white/5 border border-white/10 rounded-xl py-2 pl-9 pr-4 text-xs text-white outline-none focus:border-indigo-500 transition-all w-48"
                        />
                      </div>
                      <button
                        disabled={backfillLoading}
                        onClick={async () => {
                          const dryRun = !confirm('Run the name backfill for real?\n\nClick OK to apply changes to the DB.\nClick Cancel to do a dry-run preview (no writes).');
                          setBackfillLoading(true);
                          try {
                            const res = await fetch('/api/admin/manifests/backfill', {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ dryRun, limit: 200 })
                            });
                            const data = await res.json();
                            if (!res.ok) throw new Error(data.error || 'Backfill failed');
                            const verb = data.dryRun ? 'Would update' : 'Updated';
                            toastSuccess(
                              data.dryRun ? 'Dry-run complete' : 'Backfill complete',
                              `${verb} ${data.updated} of ${data.processed} rows. Skipped: ${data.skipped}. Errors: ${data.errors}. ${data.remainingCandidates > 0 ? `~${data.remainingCandidates} more candidates remain — click again to continue.` : 'All done.'}`
                            );
                            if (!data.dryRun && data.updated > 0) reloadTab('manifests');
                          } catch (e: any) {
                            toastError('Backfill failed', e.message);
                          } finally {
                            setBackfillLoading(false);
                          }
                        }}
                        className="px-4 py-2 bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 text-[10px] font-black uppercase rounded-xl border border-amber-500/30 transition-all flex items-center space-x-2 disabled:opacity-50"
                        title="Fetch real Steam names for manifests still named 'Manifest <appId>'"
                      >
                        {backfillLoading ? <Activity className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                        <span>{backfillLoading ? 'Backfilling…' : 'Backfill Names'}</span>
                      </button>
                      <button
                        onClick={() => {
                          const modal = document.getElementById('upload-modal');
                          if (modal) modal.style.display = 'flex';
                        }}
                        className="px-4 py-2 bg-indigo-500 hover:bg-indigo-600 text-white text-[10px] font-black uppercase rounded-xl shadow-lg shadow-indigo-500/20 transition-all flex items-center space-x-2"
                      >
                        <Plus className="h-4 w-4" />
                        <span>Upload New</span>
                      </button>
                    </div>
                  </div>

                  <div className="bg-white/5 border border-white/10 rounded-[2rem] overflow-hidden">
                    <table className="w-full text-left">
                      <thead>
                        <tr className="border-b border-white/10 text-[10px] font-black uppercase tracking-widest text-muted-foreground p-4 bg-white/5">
                          <th className="p-4">App ID</th>
                          <th className="p-4">Game Name</th>
                          <th className="p-4">Owner</th>
                          <th className="p-4">Storage Size</th>
                          <th className="p-4">Stats</th>
                          <th className="p-4">Added On</th>
                          <th className="p-4 text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-white/5">
                        {manifests.length === 0 ? (
                          <tr><td colSpan={6} className="p-20 text-center text-muted-foreground italic">No manifests found in the repository.</td></tr>
                        ) : manifests.map(m => {
                          const manOwnerAv = getDiscordCdnAvatarUrl(m.owner?.discordId, m.owner?.avatar, 40)
                          return (
                          <tr key={m.appId} className="hover:bg-white/[0.02] transition-colors group">
                            <td className="p-4 font-mono text-indigo-300 font-bold">{m.appId}</td>
                            <td className="p-4">
                              <span className="text-sm font-bold text-white max-w-[200px] truncate block">{m.name}</span>
                              {m.isPlaceholderName && (
                                <span className="text-[9px] text-amber-400 font-black uppercase">Placeholder</span>
                              )}
                            </td>
                            <td className="p-4">
                              <div className="flex items-center space-x-2">
                                {manOwnerAv && <img src={manOwnerAv} alt="" className="w-5 h-5 rounded-full border border-white/10" />}
                                <div className="flex flex-col">
                                  <span className="text-xs font-bold text-white/80">{m.owner?.username || 'System'}</span>
                                  <span className="text-[9px] font-mono text-muted-foreground">{m.owner?.discordId}</span>
                                </div>
                              </div>
                            </td>
                            <td className="p-4 text-xs text-white/50">{((m.sizeInStorage || 0) / (1024*1024)).toFixed(2)} MB</td>
                            <td className="p-4">
                              <span className="text-[10px] font-bold text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded flex items-center w-fit space-x-1">
                                <Gamepad className="h-3 w-3" />
                                <span>{m.downloads || 0} Downloads</span>
                              </span>
                            </td>
                            <td className="p-4 text-[10px] text-white/40 font-mono">
                              {new Date(m.createdAt).toLocaleDateString()}
                            </td>
                            <td className="p-4 text-right">
                              <div className="flex justify-end space-x-2">
                                <button
                                  onClick={async () => {
                                    if (confirm(`Are you sure you want to delete manifest for AppID ${m.appId}?`)) {
                                      await fetch(`/api/admin/manifests/${m.appId}`, { method: 'DELETE' });
                                      reloadTab('manifests');
                                    }
                                  }}
                                  className="p-2 bg-red-500/10 text-red-400 rounded-lg hover:bg-red-500/20 transition-all opacity-0 group-hover:opacity-100"
                                >
                                  <Trash className="h-4 w-4" />
                                </button>
                              </div>
                            </td>
                          </tr>
                        )})}
                      </tbody>
                    </table>
                  </div>

                  {manifestTotalPages > 1 && (
                    <div className="flex justify-between items-center py-6">
                      <button 
                        disabled={manifestPage <= 1} 
                        onClick={() => { setManifestPage(prev => prev - 1); reloadTab('manifests'); }}
                        className="px-5 py-2 bg-white/5 hover:bg-white/10 rounded-xl text-white/70 disabled:opacity-30 transition-all font-bold text-xs uppercase"
                      >Previous</button>
                      <span className="text-xs font-bold text-white/40 tracking-widest uppercase">Page {manifestPage} of {manifestTotalPages}</span>
                      <button 
                        disabled={manifestPage >= manifestTotalPages} 
                        onClick={() => { setManifestPage(prev => prev + 1); reloadTab('manifests'); }}
                        className="px-5 py-2 bg-white/5 hover:bg-white/10 rounded-xl text-white/70 disabled:opacity-30 transition-all font-bold text-xs uppercase"
                      >Next</button>
                    </div>
                  )}

                  {/* Upload Modal (Inline styles for simplicity here, could be state-driven) */}
                  <div 
                    id="upload-modal" 
                    className="fixed inset-0 z-[110] hidden items-center justify-center p-4 bg-black/90 backdrop-blur-md"
                    onClick={(e) => { if (e.target === e.currentTarget) e.currentTarget.style.display = 'none'; }}
                  >
                    <div className="bg-[#0A0A0B] border border-white/10 rounded-[2.5rem] w-full max-w-lg shadow-2xl p-8 space-y-6 animate-in zoom-in-95">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-3">
                          <Database className="h-6 w-6 text-indigo-400" />
                          <h2 className="text-xl font-black text-white tracking-tight">Upload Manifest</h2>
                        </div>
                        <button onClick={() => document.getElementById('upload-modal')!.style.display = 'none'} className="text-muted-foreground hover:text-white"><XCircle className="h-6 w-6" /></button>
                      </div>

                      <form 
                        onSubmit={async (e) => {
                          e.preventDefault();
                          const target = e.target as HTMLFormElement;
                          const fd = new FormData(target);
                          const btn = target.querySelector('button[type="submit"]') as HTMLButtonElement;
                          btn.disabled = true;
                          btn.innerText = 'Uploading...';
                          
                          try {
                            const res = await fetch('/api/manifests/upload', {
                              method: 'POST',
                              body: fd,
                              credentials: 'include',
                            });
                            if (res.ok) {
                              toastSuccess('Uploaded', 'Manifest successfully added to repository.');
                              document.getElementById('upload-modal')!.style.display = 'none';
                              reloadTab('manifests');
                            } else {
                              const d = await res.json();
                              toastError('Upload Failed', d.error || 'Server rejected the file.');
                            }
                          } catch {
                            toastError('Error', 'Connection failed during upload.');
                          } finally {
                            btn.disabled = false;
                            btn.innerText = 'Confirm Upload';
                          }
                        }}
                        className="space-y-4"
                      >
                        <div className="grid grid-cols-2 gap-4">
                          <div className="space-y-1.5">
                            <label className="text-[10px] text-muted-foreground font-black uppercase tracking-widest ml-1">Steam App ID *</label>
                            <input name="appId" required placeholder="e.g. 730" className="w-full bg-white/5 border border-white/10 rounded-xl py-3 px-4 text-white font-mono text-sm outline-none focus:border-indigo-500" />
                          </div>
                          <div className="space-y-1.5">
                            <label className="text-[10px] text-muted-foreground font-black uppercase tracking-widest ml-1">Game Name</label>
                            <input name="name" placeholder="e.g. Counter-Strike 2" className="w-full bg-white/5 border border-white/10 rounded-xl py-3 px-4 text-white text-sm outline-none focus:border-indigo-500" />
                          </div>
                        </div>

                        <div className="space-y-1.5 pt-2">
                          <label className="text-[10px] text-muted-foreground font-black uppercase tracking-widest ml-1">Manifest ZIP File *</label>
                          <div className="relative group overflow-hidden bg-white/5 border border-dashed border-white/20 rounded-2xl p-8 flex flex-col items-center justify-center hover:bg-white/[0.08] hover:border-indigo-500/50 transition-all cursor-pointer">
                            <input 
                              type="file" name="file" accept=".zip" required 
                              className="absolute inset-0 opacity-0 cursor-pointer" 
                              onChange={(e: any) => {
                                const file = e.target.files?.[0];
                                const label = e.target.parentElement?.querySelector('.file-label');
                                if (label && file) label.textContent = `${file.name} (${(file.size / (1024*1024)).toFixed(2)} MB)`;
                              }}
                            />
                            <Activity className="h-8 w-8 text-indigo-400 mb-2 opacity-50 group-hover:opacity-100 transition-opacity" />
                            <p className="text-xs font-bold text-white file-label">Select ZIP package...</p>
                            <p className="text-[9px] text-muted-foreground mt-1 uppercase tracking-tighter">Maximum size: 5GB</p>
                          </div>
                        </div>

                        <button 
                          type="submit"
                          className="w-full py-4 bg-indigo-500 hover:bg-indigo-600 text-white text-xs font-black uppercase tracking-widest rounded-2xl transition-all shadow-xl shadow-indigo-500/20 mt-4 active:scale-95"
                        >
                          Confirm Upload
                        </button>
                      </form>
                    </div>
                  </div>
                </div>
              ) : activeTab === 'staff-exams' ? (
                <div className="space-y-8 animate-in fade-in slide-in-from-bottom-8 duration-700">
                  <PromoTenureControls />
                  <ModAttemptsTable />
                </div>
              ) : activeTab === 'applications' ? (
                <ApplicationsTabComponent
                  responses={formResponses} 
                  loading={formsLoading} 
                  onGrade={(resp: any) => { setGradingModal({ open: true, response: resp }); setAiGrades({}); setAiGradeMeta(null); setEditingAiScoreId(null) }}
                  formId={formId}
                  setFormId={setFormId}
                  refresh={loadApplications}
                  trelloCards={trelloCards}
                  trelloLists={trelloLists}
                  trelloStats={trelloStats}
                  trelloLoading={trelloLoading}
                  trelloError={trelloError}
                  loadTrello={loadTrelloData}
                  moveCard={trelloMoveCard}
                  onPushToTrello={syncFormsToTrello}
                  savingTrello={saving === 'trello-move'}
                />
              ) : activeTab === 'exe' ? (
                <div className="space-y-8 animate-in fade-in slide-in-from-bottom-6 duration-700">
                  {/* Exe Overview Header - Enhanced with gradients and glassmorphism */}
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                    <div className="group p-6 bg-white/5 border border-white/10 rounded-[2rem] space-y-2 hover:bg-white/10 transition-all duration-500 relative overflow-hidden">
                      <div className="absolute -right-4 -top-4 w-20 h-20 bg-indigo-500/10 rounded-full blur-2xl group-hover:bg-indigo-500/20 transition-all" />
                      <p className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground flex items-center space-x-2">
                        <Monitor className="h-3 w-3" />
                        <span>Total Sessions</span>
                      </p>
                      <p className="text-4xl font-black text-white tracking-tighter">{exeOverview?.totalSessions || 0}</p>
                    </div>
                    
                    <div className="group p-6 bg-emerald-500/5 border border-emerald-500/10 rounded-[2rem] space-y-2 hover:bg-emerald-500/10 transition-all duration-500 relative overflow-hidden">
                      <div className="absolute -right-4 -top-4 w-20 h-20 bg-emerald-500/10 rounded-full blur-2xl group-hover:bg-emerald-500/20 transition-all" />
                      <p className="text-[10px] font-black uppercase tracking-[0.2em] text-emerald-400 flex items-center space-x-2">
                        <Wifi className="h-3 w-3" />
                        <span>Online Now</span>
                      </p>
                      <p className="text-4xl font-black text-white tracking-tighter">{exeOverview?.onlineSessions || 0}</p>
                    </div>

                    <div className="group p-6 bg-red-500/5 border border-red-500/10 rounded-[2rem] space-y-2 hover:bg-red-500/10 transition-all duration-500 relative overflow-hidden">
                      <div className="absolute -right-4 -top-4 w-20 h-20 bg-red-500/10 rounded-full blur-2xl group-hover:bg-red-500/20 transition-all" />
                      <p className="text-[10px] font-black uppercase tracking-[0.2em] text-red-400 flex items-center space-x-2">
                        <Ban className="h-3 w-3" />
                        <span>Disabled Keys</span>
                      </p>
                      <p className="text-4xl font-black text-white tracking-tighter">{exeOverview?.disabledKeys || 0}</p>
                    </div>

                    <div className="group p-6 bg-amber-500/5 border border-amber-500/10 rounded-[2rem] space-y-2 hover:bg-amber-500/10 transition-all duration-500 relative overflow-hidden">
                      <div className="absolute -right-4 -top-4 w-20 h-20 bg-amber-500/10 rounded-full blur-2xl group-hover:bg-amber-500/20 transition-all" />
                      <p className="text-[10px] font-black uppercase tracking-[0.2em] text-amber-400 flex items-center space-x-2">
                        <RefreshCw className="h-3 w-3" />
                        <span>Updates Pending</span>
                      </p>
                      <p className="text-4xl font-black text-white tracking-tighter">{exeOverview?.pendingForceUpdate || 0}</p>
                    </div>
                  </div>

                  {/* Search & Filter Controls */}
                  <div className="flex flex-col md:flex-row gap-4 items-center justify-between">
                    <div className="relative flex-1 group w-full">
                      <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground group-focus-within:text-indigo-400 transition-colors" />
                      <input 
                        type="text" 
                        placeholder="Search by Machine ID, Username or Discord ID..." 
                        value={exeSearch}
                        onChange={(e) => setExeSearch(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && loadExeSessions()}
                        className="w-full bg-white/5 border border-white/10 rounded-2xl py-3 pl-12 pr-4 text-sm text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/50 transition-all"
                      />
                    </div>
                    
                    <div className="flex items-center space-x-3 w-full md:w-auto">
                      <button 
                        onClick={() => { setExeOnlineFilter(!exeOnlineFilter); setTimeout(loadExeSessions, 10); }}
                        className={`px-4 py-2.5 rounded-2xl text-[10px] font-black uppercase tracking-widest border transition-all flex items-center space-x-2 ${exeOnlineFilter ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400' : 'bg-white/5 border-white/10 text-white/40 hover:text-white'}`}
                      >
                        <Wifi className="h-3.5 w-3.5" />
                        <span>Online Only</span>
                      </button>
                      
                      <button 
                        onClick={loadExeSessions}
                        className="p-2.5 bg-indigo-500 hover:bg-indigo-600 text-white rounded-2xl shadow-lg shadow-indigo-500/20 transition-all active:scale-95"
                      >
                        <RotateCcw className={`h-5 w-5 ${exeLoading ? 'animate-spin' : ''}`} />
                      </button>
                    </div>
                  </div>

                  {/* Sessions Table - Enhanced layout and typography */}
                  <div className="glass rounded-[2.5rem] border border-white/10 overflow-hidden shadow-2xl shadow-black/40">
                    <div className="p-8 border-b border-white/10 flex items-center justify-between bg-white/[0.02]">
                      <div className="space-y-1">
                        <h3 className="text-lg font-black uppercase tracking-widest text-white flex items-center space-x-3">
                          <LayoutGrid className="h-5 w-5 text-indigo-400" />
                          <span>Active ManifestApp Fleet</span>
                        </h3>
                        <p className="text-[10px] text-muted-foreground font-bold uppercase tracking-wider opacity-60 ml-8">Monitoring real-time desktop instances and events</p>
                      </div>
                      <button 
                        onClick={loadExeSessions} 
                        className="p-3 bg-white/5 hover:bg-white/10 border border-white/10 rounded-2xl transition-all active:scale-95 group"
                      >
                        <RotateCcw className={`h-4 w-4 text-indigo-400 ${exeLoading ? 'animate-spin' : 'group-hover:rotate-180 transition-transform duration-500'}`} />
                      </button>
                    </div>

                    <div className="overflow-x-auto">
                      <table className="w-full text-left">
                        <thead>
                          <tr className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground/60 p-4 bg-black/20">
                            <th className="p-6">Client Identity</th>
                            <th className="p-6">Network Status</th>
                            <th className="p-6">Daily Resource Usage</th>
                            <th className="p-6">Telemetry Feed</th>
                            <th className="p-6 text-right">Control Plane</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-white/5">
                          {exeSessions.length === 0 ? (
                            <tr>
                              <td colSpan={5} className="py-32 text-center text-muted-foreground">
                                <div className="space-y-4">
                                  <Monitor className="h-12 w-12 mx-auto opacity-10 animate-pulse" />
                                  <p className="italic text-sm font-black uppercase tracking-widest opacity-40">{exeLoading ? 'Querying fleet status...' : 'No matching signals found in the database.'}</p>
                                </div>
                              </td>
                            </tr>
                          ) : exeSessions.map(s => (
                            <tr 
                              key={s.sessionId} 
                              className="hover:bg-white/[0.03] transition-all group/row cursor-pointer"
                              onClick={() => loadSessionDetails(s.sessionId)}
                            >
                              <td className="p-6">
                                <div className="flex items-center space-x-4">
                                  <div className="w-12 h-12 bg-indigo-500/10 border border-indigo-500/20 rounded-2xl flex items-center justify-center text-indigo-400 group-hover/row:scale-110 transition-transform">
                                    <Smartphone className="h-6 w-6" />
                                  </div>
                                  <div className="flex flex-col">
                                    <span className="text-sm font-black text-white tracking-tight">{s.user?.username ?? "Unknown"}</span>
                                    <div className="flex items-center space-x-2 mt-0.5">
                                      <span className="text-[9px] bg-indigo-500/20 text-indigo-300 px-1.5 py-0.5 rounded font-black uppercase tracking-tighter border border-indigo-500/20">v{s.appVersion}</span>
                                      <span className="text-[9px] text-white/20 font-mono tracking-tighter truncate w-24">ID: {s.sessionId.substring(0, 12)}...</span>
                                    </div>
                                  </div>
                                </div>
                              </td>
                              <td className="p-6">
                                <div className="flex items-center space-x-3">
                                  <div className="relative">
                                    <div className={`w-3 h-3 rounded-full ${s.online ? 'bg-emerald-500 shadow-[0_0_12px_rgba(16,185,129,0.8)]' : 'bg-zinc-700 shadow-none'}`} />
                                    {s.online && <div className="absolute inset-0 w-3 h-3 bg-emerald-500 rounded-full animate-ping opacity-40" />}
                                  </div>
                                  <div className="flex flex-col">
                                    <span className={`text-[10px] font-black uppercase tracking-widest ${s.online ? 'text-emerald-400' : 'text-zinc-500'}`}>
                                      {s.online ? 'Transmitting' : 'Signal Lost'}
                                    </span>
                                    <span className="text-[9px] text-white/30 font-bold uppercase">{s.online ? 'Connected' : '10m+ Inactive'}</span>
                                  </div>
                                </div>
                              </td>
                              <td className="p-6">
                                <div className="flex flex-col space-y-2 min-w-[140px]">
                                  <div className="flex justify-between items-end">
                                    <span className="text-[10px] font-black text-white/60 tracking-widest">{s.usage.today} <span className="text-white/20">/</span> {s.usage.limit}</span>
                                    <span className="text-[9px] font-black text-indigo-400 uppercase tracking-tighter">{Math.round((s.usage.today / s.usage.limit) * 100)}%</span>
                                  </div>
                                  <div className="w-full h-2 bg-white/5 rounded-full overflow-hidden border border-white/5 p-[1px]">
                                    <div 
                                      className={`h-full rounded-full transition-all duration-1000 ease-out shadow-[0_0_8px_rgba(99,102,241,0.4)] ${
                                        (s.usage.today / s.usage.limit) > 0.8 ? 'bg-gradient-to-r from-indigo-500 to-red-500' : 'bg-gradient-to-r from-indigo-600 to-indigo-400'
                                      }`}
                                      style={{ width: `${Math.min(100, (s.usage.today / s.usage.limit) * 100)}%` }} 
                                    />
                                  </div>
                                </div>
                              </td>
                              <td className="p-6">
                                {s.lastEvent ? (
                                  <div className="flex items-center space-x-3 bg-white/[0.03] border border-white/5 p-2 rounded-2xl group-hover/row:bg-white/[0.06] transition-colors">
                                    <div className="w-8 h-8 rounded-xl bg-black/40 flex items-center justify-center text-indigo-400">
                                      {s.lastEvent.type === 'heartbeat' ? <Activity className="h-4 w-4" /> : 
                                       s.lastEvent.type === 'startup' ? <Zap className="h-4 w-4" /> :
                                       s.lastEvent.type === 'install' ? <Plus className="h-4 w-4" /> :
                                       <Search className="h-4 w-4" />}
                                    </div>
                                    <div className="flex flex-col">
                                      <span className="text-[9px] font-black uppercase text-indigo-300 tracking-widest">{s.lastEvent.type}</span>
                                      <span className="text-[10px] text-white/70 font-medium truncate w-32 leading-none mt-1">{s.lastEvent.gameName || s.lastEvent.detail || 'Generic Ping'}</span>
                                    </div>
                                  </div>
                                ) : (
                                  <span className="text-[10px] text-white/10 font-black uppercase tracking-widest italic">No Data Stream</span>
                                )}
                              </td>
                              <td className="p-6 text-right">
                                <div className="flex items-center justify-end space-x-3">
                                  <button 
                                    onClick={async (e) => {
                                      e.stopPropagation();
                                      const res = await fetch(`/api/admin/keys/${encodeURIComponent(s.apiKey)}/commands`, {
                                        method: 'PUT',
                                        headers: { 'Content-Type': 'application/json' },
                                        body: JSON.stringify({ disable: !s.commands.disable, forceUpdate: s.commands.forceUpdate })
                                      })
                                      if (res.ok) {
                                        toastSuccess(s.commands.disable ? 'Access Restored' : 'Access Revoked', `ManifestApp lockdown ${s.commands.disable ? 'lifted' : 'engaged'} for key.`);
                                        loadExeSessions();
                                      }
                                    }}
                                    className={`group/btn relative px-4 py-2.5 rounded-2xl text-[10px] font-black uppercase tracking-[0.15em] transition-all overflow-hidden ${
                                      s.commands.disable 
                                        ? 'bg-emerald-500 text-white shadow-[0_0_15px_rgba(16,185,129,0.3)] hover:scale-105 active:scale-95' 
                                        : 'bg-red-500/10 text-red-500 border border-red-500/20 hover:bg-red-500 hover:text-white hover:shadow-[0_0_15px_rgba(239,68,68,0.3)] hover:scale-105 active:scale-95'
                                    }`}
                                  >
                                    <div className="relative z-10 flex items-center space-x-2">
                                      {s.commands.disable ? <CheckCircle className="h-3.5 w-3.5" /> : <Ban className="h-3.5 w-3.5" />}
                                      <span>{s.commands.disable ? 'Unlock Client' : 'Lock Key'}</span>
                                    </div>
                                  </button>
                                  
                                  <button 
                                    onClick={async (e) => {
                                      e.stopPropagation();
                                      const res = await fetch(`/api/admin/keys/${encodeURIComponent(s.apiKey)}/commands`, {
                                        method: 'PUT',
                                        headers: { 'Content-Type': 'application/json' },
                                        body: JSON.stringify({ disable: s.commands.disable, forceUpdate: !s.commands.forceUpdate })
                                      })
                                      if (res.ok) {
                                        toastSuccess('Command Queued', `Remote update signal ${!s.commands.forceUpdate ? 'transmitted' : 'cancelled'}.`);
                                        loadExeSessions();
                                      }
                                    }}
                                    className={`group/btn p-2.5 rounded-2xl transition-all border ${
                                      s.commands.forceUpdate 
                                        ? 'bg-amber-500 text-white border-amber-500 shadow-[0_0_15px_rgba(245,158,11,0.3)] hover:scale-105 active:scale-95' 
                                        : 'bg-white/5 text-white/40 border-white/10 hover:border-amber-500/50 hover:text-amber-400 hover:scale-105 active:scale-95'
                                    }`}
                                    title="Force Remote Update"
                                  >
                                    <RefreshCw className={`h-4 w-4 ${s.commands.forceUpdate ? 'animate-spin' : ''}`} />
                                  </button>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              ) : activeTab === 'organizations' ? (
                <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4">
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-white/5 pb-6">
                    <h3 className="text-xl font-black uppercase tracking-widest text-white flex items-center space-x-3">
                      <Users className="h-6 w-6 text-indigo-400" />
                      <span>Organization Sovereignty</span>
                    </h3>
                  </div>

                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-white/10 text-[10px] uppercase tracking-widest text-muted-foreground font-black">
                        <th className="pb-4 px-4 text-left">Organization Name</th>
                        <th className="pb-4 px-4">Owner</th>
                        <th className="pb-4 px-4 text-center">Plan</th>
                        <th className="pb-4 px-4 text-center">Members</th>
                        <th className="pb-4 px-4 text-center">API Keys</th>
                        <th className="pb-4 px-4 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5">
                      {organizationsLoading ? (
                        <tr><td colSpan={6} className="py-20 text-center text-muted-foreground"><Activity className="h-6 w-6 animate-spin mx-auto mb-2 text-indigo-500" />Syncing org records...</td></tr>
                      ) : organizations.length === 0 ? (
                        <tr><td colSpan={6} className="py-20 text-center text-muted-foreground italic">No organizations created on the platform yet.</td></tr>
                      ) : organizations.map(o => {
                        const orgOwnerAv = getDiscordCdnAvatarUrl(o.owner?.discordId, o.owner?.avatar, 40)
                        return (
                        <tr key={o.id} className="hover:bg-white/[0.02] transition-colors group">
                          <td className="py-5 px-4">
                            <div className="flex items-center space-x-3">
                              <div className="p-2 bg-indigo-500/10 rounded-lg border border-indigo-500/20">
                                <Users className="h-4 w-4 text-indigo-400" />
                              </div>
                              <div className="flex flex-col">
                                <span className="text-sm font-bold text-white mb-0.5">{o.name}</span>
                                <span className="text-[10px] font-mono text-muted-foreground opacity-50">{o.id}</span>
                              </div>
                            </div>
                          </td>
                          <td className="py-5 px-4">
                            <div className="flex items-center space-x-2">
                              {orgOwnerAv && <img src={orgOwnerAv} alt="" className="w-5 h-5 rounded-full border border-white/10" />}
                              <div className="flex flex-col">
                                <span className="text-xs font-bold text-white/80">{o.owner?.username || 'Legacy Admin'}</span>
                                <span className="text-[9px] font-mono text-muted-foreground">{o.owner?.discordId || '00000000'}</span>
                              </div>
                            </div>
                          </td>
                          <td className="py-5 px-4 text-center">
                            <select
                              value={o.plan}
                              onChange={(e) => updateOrgPlan(o.id, e.target.value)}
                              className={`text-[10px] font-black uppercase px-2 py-1 rounded border outline-none cursor-pointer hover:bg-white/5 transition-colors ${
                                o.plan === 'FREE' ? 'bg-zinc-500/10 border-zinc-500/20 text-zinc-300' :
                                o.plan === 'PREMIUM' ? 'bg-amber-500/10 border-amber-500/20 text-amber-400' :
                                o.plan === 'BUSINESS' || o.plan === 'CUSTOM' ? 'bg-indigo-500/10 border-indigo-500/20 text-indigo-400' :
                                'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
                              }`}
                            >
                              <option value="FREE">Free</option>
                              <option value="REGULAR">Regular</option>
                              <option value="PREMIUM">Premium</option>
                              <option value="BUSINESS">Business</option>
                              <option value="CUSTOM">Custom</option>
                            </select>
                          </td>
                          <td className="py-5 px-4 text-center">
                            <span className="text-xs font-bold text-white/60">{o._count?.members || 0}</span>
                          </td>
                          <td className="py-5 px-4 text-center">
                            <span className="text-xs font-bold text-white/60">{o._count?.apiKeys || 0}</span>
                          </td>
                          <td className="py-5 px-4 text-right">
                            <div className="flex flex-col items-end">
                              <span className="text-[9px] text-muted-foreground font-mono uppercase opacity-40">Created {new Date(o.createdAt).toLocaleDateString()}</span>
                              {saving === o.id && <Activity className="h-3 w-3 text-indigo-500 animate-spin mt-1" />}
                            </div>
                          </td>
                        </tr>
                      )})}
                    </tbody>
                  </table>
                </div>
              ) : activeTab === 'appeals' ? (
                <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4">
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-white/5 pb-6">
                    <div>
                      <h3 className="text-xl font-black uppercase tracking-widest text-white flex items-center space-x-3">
                        <Gavel className="h-6 w-6 text-indigo-400" />
                        <span>Judiciary Appeals</span>
                      </h3>
                      <p className="text-[10px] text-muted-foreground font-black uppercase tracking-widest mt-1">Reviewing user disputes and ban lift requests</p>
                    </div>
                    <button 
                      onClick={loadAppeals}
                      className="p-2.5 bg-white/5 hover:bg-white/10 border border-white/10 rounded-2xl transition-all active:scale-95 group"
                    >
                      <RotateCcw className={`h-4 w-4 text-indigo-400 ${loading ? 'animate-spin' : 'group-hover:rotate-180 transition-transform duration-500'}`} />
                    </button>
                  </div>

                  <div className="bg-white/5 border border-white/10 rounded-[2.5rem] overflow-hidden shadow-2xl">
                    <table className="w-full text-left">
                      <thead>
                        <tr className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground/60 p-4 bg-black/20">
                          <th className="p-6">Appellant</th>
                          <th className="p-6">Status</th>
                          <th className="p-6">Appeal Statement</th>
                          <th className="p-6">Submitted</th>
                          <th className="p-6 text-right">Verdict</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-white/5">
                        {appeals.length === 0 ? (
                          <tr>
                            <td colSpan={5} className="py-32 text-center text-muted-foreground">
                              <div className="space-y-4">
                                <Gavel className="h-12 w-12 mx-auto opacity-10 animate-pulse" />
                                <p className="italic text-sm font-black uppercase tracking-widest opacity-40">No pending or historical appeals found.</p>
                              </div>
                            </td>
                          </tr>
                        ) : appeals.map(a => {
                          const appAv = getDiscordCdnAvatarUrl(a.user?.discordId, a.user?.avatar, 40)
                          return (
                          <tr key={a.id} className="hover:bg-white/[0.02] transition-colors group">
                            <td className="p-6">
                              <div className="flex items-center space-x-3">
                                {appAv ? (
                                  <img src={appAv} alt="" className="w-10 h-10 rounded-full border border-white/10" />
                                ) : (
                                  <div className="w-10 h-10 rounded-full bg-indigo-500/10 flex items-center justify-center border border-indigo-500/20 text-indigo-400 font-bold">
                                    {a.user?.username?.charAt(0) || '?'}
                                  </div>
                                )}
                                <div className="flex flex-col">
                                  <span className="text-sm font-bold text-white">{a.user?.username || 'Unknown User'}</span>
                                  <span className="text-[9px] font-mono text-muted-foreground opacity-50">{a.user?.discordId || '0000000000'}</span>
                                </div>
                              </div>
                            </td>
                            <td className="p-6">
                              <span className={`text-[9px] font-black uppercase px-2 py-1 rounded border ${
                                a.action === 'APPEAL_SUBMITTED' ? 'bg-amber-500/10 text-amber-400 border-amber-500/20' :
                                a.action === 'APPEAL_ACCEPTED' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' :
                                'bg-red-500/10 text-red-400 border-red-500/20'
                              }`}>
                                {a.action.replace('APPEAL_', '')}
                              </span>
                            </td>
                            <td className="p-6">
                              <div className="max-w-md">
                                <p className="text-xs text-white/70 line-clamp-2 italic" title={typeof a.details === 'object' ? JSON.stringify(a.details) : a.details}>"{typeof a.details === 'object' ? JSON.stringify(a.details) : (a.details || 'No statement provided.')}"</p>
                              </div>
                            </td>
                            <td className="p-6 text-[10px] text-white/40 font-mono">
                              {new Date(a.createdAt).toLocaleDateString()}
                            </td>
                            <td className="p-6 text-right">
                              {a.action === 'APPEAL_SUBMITTED' ? (
                                <div className="flex justify-end space-x-2">
                                  <button 
                                    disabled={saving === a.id}
                                    onClick={(e) => { e.stopPropagation(); handleAppealAction(a.id, 'ACCEPT'); }}
                                    className="px-4 py-2 bg-emerald-500 hover:bg-emerald-600 text-white text-[9px] font-black uppercase rounded-xl transition-all shadow-lg shadow-emerald-500/20 disabled:opacity-50"
                                  >
                                    Accept
                                  </button>
                                  <button 
                                    disabled={saving === a.id}
                                    onClick={(e) => { e.stopPropagation(); handleAppealAction(a.id, 'DECLINE'); }}
                                    className="px-4 py-2 bg-red-500 hover:bg-red-600 text-white text-[9px] font-black uppercase rounded-xl transition-all shadow-lg shadow-red-500/20 disabled:opacity-50"
                                  >
                                    Decline
                                  </button>
                                </div>
                              ) : (
                                <span className="text-[10px] font-black uppercase text-white/20 tracking-widest italic">Resolved</span>
                              )}
                            </td>
                          </tr>
                        )})}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : activeTab === 'logs' ? (
                <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4">
                  {/* Sub-tab Selector */}
                  <div className="flex items-center space-x-1 bg-white/5 p-1 rounded-2xl w-fit">
                    <button 
                      onClick={() => setLogSubTab('api')}
                      className={`px-6 py-2 rounded-xl text-xs font-bold uppercase tracking-widest transition-all ${logSubTab === 'api' ? 'bg-indigo-500 text-white shadow-lg shadow-indigo-500/20' : 'text-muted-foreground hover:text-white'}`}
                    >
                      Live API Traffic
                    </button>
                    {(currentUserRole === 'ADMIN' || currentUserRole === 'OWNER') && (
                      <button 
                        onClick={() => { setLogSubTab('audit'); loadAuditLogs(1); }}
                        className={`px-6 py-2 rounded-xl text-xs font-bold uppercase tracking-widest transition-all ${logSubTab === 'audit' ? 'bg-indigo-500 text-white shadow-lg shadow-indigo-500/20' : 'text-muted-foreground hover:text-white'}`}
                      >
                        Administrative Audits
                      </button>
                    )}
                  </div>

                  {logSubTab === 'api' ? (
                    <div className="space-y-4">
                      {logFilterKey && (
                        <div className="flex items-center justify-between p-3 bg-indigo-500/10 border border-indigo-500/20 rounded-xl mb-4">
                          <span className="text-indigo-200 text-sm flex items-center space-x-2">
                            <Search className="h-4 w-4" />
                            <span>Filtering logs for a specific API Key</span>
                          </span>
                          <button 
                            onClick={() => { setLogFilterKey(null); loadLogs(1, null) }}
                            className="p-1 text-indigo-400 hover:text-indigo-300"
                          >
                            <XCircle className="h-4 w-4" />
                          </button>
                        </div>
                      )}
                      <table className="w-full text-left border-collapse">
                        <thead>
                          <tr className="border-b border-white/10 text-[10px] font-black uppercase tracking-widest text-muted-foreground">
                            <th className="pb-3 px-2">Time</th>
                            <th className="pb-3 px-2">Method</th>
                            <th className="pb-3 px-2">Endpoint</th>
                            <th className="pb-3 px-2">Status</th>
                            <th className="pb-3 px-2">IP Addr</th>
                            <th className="pb-3 px-2">Owner</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-white/5">
                          {logs.length === 0 ? (
                            <tr><td colSpan={6} className="py-12 text-center text-muted-foreground italic">No API logs available.</td></tr>
                          ) : logs.map(l => (
                             <tr key={l.id} className="hover:bg-white/[0.02] transition-colors group">
                               <td className="py-2.5 px-2 text-[10px] text-white/50 font-mono">{new Date(l.createdAt).toLocaleTimeString()}</td>
                               <td className="py-2.5 px-2">
                                 <span className={`text-[9px] font-black px-1.5 py-0.5 rounded uppercase ${getMethodColor(l.method)}`}>{l.method}</span>
                               </td>
                               <td className="py-2.5 px-2 text-xs font-mono text-indigo-300 max-w-[200px] truncate" title={l.endpoint}>{l.endpoint}</td>
                               <td className="py-2.5 px-2">
                                 <span className={`text-[9px] font-black px-1.5 py-0.5 rounded border ${getStatusColor(l.status)}`}>{l.status}</span>
                               </td>
                               <td className="py-2.5 px-2 text-[10px] text-white/70 font-mono">{l.ip || '—'}</td>
                               <td className="py-2.5 px-2 text-[10px] text-white/90">
                                 {l.apiKey?.user?.username || 'Unknown'} 
                                 <span className="text-white/30 border border-white/10 ml-1 rounded px-1 lowercase">{l.apiKey?.name || 'key'}</span>
                               </td>
                             </tr>
                          ))}
                        </tbody>
                      </table>
                      {logTotalPages > 1 && (
                        <div className="flex justify-between items-center py-4 border-t border-white/10 mt-4">
                          <button disabled={logPage <= 1} onClick={() => loadLogs(logPage - 1, logFilterKey)} className="px-3 py-1 bg-white/5 rounded text-white/70 disabled:opacity-30">Previous</button>
                          <span className="text-[10px] font-bold text-white/40 uppercase tracking-widest">Page {logPage} / {logTotalPages}</span>
                          <button disabled={logPage >= logTotalPages} onClick={() => loadLogs(logPage + 1, logFilterKey)} className="px-3 py-1 bg-white/5 rounded text-white/70 disabled:opacity-30">Next</button>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <table className="w-full text-left border-collapse">
                        <thead>
                          <tr className="border-b border-white/10 text-[10px] font-black uppercase tracking-widest text-muted-foreground">
                            <th className="pb-3 px-2">Timestamp</th>
                            <th className="pb-3 px-2">Admin/Mod</th>
                            <th className="pb-3 px-2 text-center">Action</th>
                            <th className="pb-3 px-2">Description</th>
                            <th className="pb-3 px-2 text-right">Performer IP</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-white/5">
                          {auditLogs.length === 0 ? (
                            <tr><td colSpan={5} className="py-12 text-center text-muted-foreground italic">No administrative actions recorded yet.</td></tr>
                          ) : auditLogs.map(a => {
                            const auditPerformerAv = getDiscordCdnAvatarUrl(a.user?.discordId, a.user?.avatar, 32)
                            return (
                            <tr key={a.id} className="hover:bg-white/[0.02] transition-colors group">
                              <td className="py-3 px-2 text-[10px] text-white/50 font-mono">{new Date(a.createdAt).toLocaleString()}</td>
                              <td className="py-3 px-2">
                                <div className="flex items-center space-x-2">
                                  {auditPerformerAv && <img src={auditPerformerAv} alt="" className="w-4 h-4 rounded-full border border-white/10" />}
                                  <span className="text-xs font-bold text-white tracking-tight">{a.user?.username || 'System'}</span>
                                </div>
                              </td>
                              <td className="py-3 px-2 text-center">
                                <span className={`text-[9px] font-black px-2 py-0.5 rounded uppercase tracking-tighter ${
                                  a.action.includes('BAN') || a.action.includes('REJECT') ? 'bg-red-500/20 text-red-400' :
                                  a.action.includes('CLEAR') || a.action.includes('APPROVE') ? 'bg-emerald-500/20 text-emerald-400' : 
                                  'bg-indigo-500/20 text-indigo-400'
                                }`}>
                                  {a.action.replace('_', ' ')}
                                </span>
                              </td>
                              <td className="py-3 px-2 text-[11px] text-white/70 italic">
                                {typeof a.details === 'object' ? JSON.stringify(a.details) : (a.details || '—')}
                              </td>
                              <td className="py-3 px-2 text-[10px] text-white/30 font-mono text-right">
                                {a.ip || '—'}
                              </td>
                            </tr>
                          )})}
                        </tbody>
                      </table>
                      {auditTotalPages > 1 && (
                        <div className="flex justify-between items-center py-4 border-t border-white/10 mt-4">
                          <button disabled={auditPage <= 1} onClick={() => loadAuditLogs(auditPage - 1)} className="px-5 py-1.5 bg-white/5 rounded-xl text-white/70 disabled:opacity-30 font-bold text-[10px] uppercase">Prev</button>
                          <span className="text-[10px] font-bold text-white/40 uppercase tracking-widest">Page {auditPage} / {auditTotalPages}</span>
                          <button disabled={auditPage >= auditTotalPages} onClick={() => loadAuditLogs(auditPage + 1)} className="px-5 py-1.5 bg-white/5 rounded-xl text-white/70 disabled:opacity-30 font-bold text-[10px] uppercase">Next</button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ) : activeTab === 'punishments' ? (
                <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4">
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-white/5 pb-6">
                    <div>
                      <h3 className="text-xl font-black uppercase tracking-widest text-white flex items-center space-x-3">
                        <ShieldAlert className="h-6 w-6 text-indigo-400" />
                        <span>Guild Punishments</span>
                      </h3>
                      <p className="text-[10px] text-muted-foreground font-black uppercase tracking-widest mt-1">
                        Synchronized Discord warnings and mutes with on-site proof and modification overrides
                      </p>
                    </div>
                    <div className="flex items-center space-x-3">
                      {currentUserRole === 'OWNER' && (
                        <button
                          onClick={handleOpenCreate}
                          className="px-4 py-2.5 bg-indigo-500 hover:bg-indigo-600 text-white text-xs font-black uppercase tracking-widest rounded-2xl transition-all shadow-lg shadow-indigo-500/20 flex items-center space-x-2"
                        >
                          <Plus className="h-4 w-4" />
                          <span>New Infraction</span>
                        </button>
                      )}
                      <button 
                        onClick={loadPunishments}
                        className="p-2.5 bg-white/5 hover:bg-white/10 border border-white/10 rounded-2xl transition-all active:scale-95 group"
                      >
                        <RotateCcw className={`h-4 w-4 text-indigo-400 ${punishmentsLoading ? 'animate-spin' : 'group-hover:rotate-180 transition-transform duration-500'}`} />
                      </button>
                    </div>
                  </div>

                  {/* Search Bar */}
                  <div className="flex items-center bg-white/5 border border-white/10 rounded-2xl px-6 py-4">
                    <Search className="h-5 w-5 text-muted-foreground mr-3" />
                    <input
                      type="text"
                      placeholder="Search punishments by user name, Discord ID, reason or moderator..."
                      value={punishmentSearch}
                      onChange={(e) => setPunishmentSearch(e.target.value)}
                      className="w-full bg-transparent outline-none text-white text-sm placeholder-white/30 font-medium"
                    />
                  </div>

                  <div className="bg-white/5 border border-white/10 rounded-[2.5rem] overflow-hidden shadow-2xl">
                    <table className="w-full text-left">
                      <thead>
                        <tr className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground/60 p-4 bg-black/20">
                          <th className="p-6">Member</th>
                          <th className="p-6">Type</th>
                          <th className="p-6">Reason</th>
                          <th className="p-6">Duration</th>
                          <th className="p-6">Moderator</th>
                          <th className="p-6">Proof</th>
                          <th className="p-6">Date</th>
                          {currentUserRole === 'OWNER' && <th className="p-6 text-right">Actions</th>}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-white/5">
                        {punishmentsLoading ? (
                          <tr>
                            <td colSpan={currentUserRole === 'OWNER' ? 8 : 7} className="py-32 text-center text-muted-foreground">
                              <div className="flex flex-col items-center justify-center space-y-4">
                                <Activity className="h-8 w-8 animate-spin text-indigo-400" />
                                <span className="text-xs font-black uppercase tracking-widest text-indigo-400">Loading Punishments...</span>
                              </div>
                            </td>
                          </tr>
                        ) : filteredPunishments.length === 0 ? (
                          <tr>
                            <td colSpan={currentUserRole === 'OWNER' ? 8 : 7} className="py-32 text-center text-muted-foreground">
                              <div className="space-y-4">
                                <ShieldCheck className="h-12 w-12 mx-auto opacity-10 animate-pulse text-emerald-400" />
                                <p className="italic text-sm font-black uppercase tracking-widest opacity-40">No punishment logs found matching your query.</p>
                              </div>
                            </td>
                          </tr>
                        ) : filteredPunishments.map(p => (
                          <tr key={p.id} className="hover:bg-white/[0.02] transition-colors group">
                            <td className="p-6">
                              <div className="flex flex-col">
                                <span className="text-sm font-bold text-white">{p.username}</span>
                                <span className="text-[9px] font-mono text-muted-foreground opacity-50">{p.discordId}</span>
                              </div>
                            </td>
                            <td className="p-6">
                              <span className={`text-[9px] font-black uppercase px-2 py-1 rounded border ${
                                p.type === 'WARN' ? 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20' :
                                p.type === 'TIMEOUT' ? 'bg-indigo-500/10 text-indigo-400 border-indigo-500/20' :
                                'bg-red-500/10 text-red-400 border-red-500/20'
                              }`}>
                                {p.type}
                              </span>
                            </td>
                            <td className="p-6">
                              <div className="max-w-xs">
                                <p className="text-xs text-white/70 line-clamp-2" title={p.reason}>{p.reason}</p>
                              </div>
                            </td>
                            <td className="p-6">
                              {p.duration ? (
                                <span className="text-xs font-mono text-white/90 bg-white/5 border border-white/10 px-2 py-0.5 rounded-lg">
                                  {p.duration}
                                </span>
                              ) : (
                                <span className="text-xs text-white/20">—</span>
                              )}
                            </td>
                            <td className="p-6">
                              <div className="flex flex-col">
                                <span className="text-xs text-white/95 font-medium">{p.moderatorName}</span>
                                <span className="text-[8px] font-mono text-white/30">{p.moderatorId}</span>
                              </div>
                            </td>
                            <td className="p-6">
                              {p.proofUrl && p.proofUrl.startsWith('http') ? (
                                <div className="relative group/proof">
                                  <img
                                    src={p.proofUrl}
                                    alt="Proof Thumbnail"
                                    onClick={() => setSelectedProofUrl(p.proofUrl)}
                                    className="w-12 h-12 object-cover rounded-xl border border-white/10 hover:border-indigo-400/40 hover:scale-105 transition-all duration-300 cursor-pointer shadow-lg"
                                    onError={(e) => {
                                      (e.target as any).style.display = 'none';
                                      const nextNode = (e.target as any).nextSibling;
                                      if (nextNode) nextNode.style.display = 'flex';
                                    }}
                                  />
                                  <div 
                                    onClick={() => setSelectedProofUrl(p.proofUrl)}
                                    className="hidden w-12 h-12 rounded-xl bg-white/5 border border-white/10 flex flex-col items-center justify-center text-[8px] text-white/40 cursor-pointer hover:bg-white/10 hover:text-white transition-all"
                                  >
                                    <Eye className="h-4 w-4 mb-0.5" />
                                    <span>Proof</span>
                                  </div>
                                </div>
                              ) : (
                                <span className="text-xs text-white/20">None</span>
                              )}
                            </td>
                            <td className="p-6 text-[10px] text-white/40 font-mono">
                              {new Date(p.createdAt).toLocaleDateString()}
                            </td>
                            {currentUserRole === 'OWNER' && (
                              <td className="p-6 text-right">
                                <div className="flex justify-end space-x-2">
                                  <button
                                    onClick={() => handleOpenEdit(p)}
                                    className="p-2 bg-white/5 hover:bg-white/10 hover:text-indigo-400 rounded-xl transition-all"
                                    title="Edit Infraction"
                                  >
                                    <FileText className="h-4 w-4" />
                                  </button>
                                  <button
                                    onClick={() => deletePunishment(p.id)}
                                    className="p-2 bg-white/5 hover:bg-red-500/20 hover:text-red-400 rounded-xl transition-all"
                                    title="Delete Infraction"
                                  >
                                    <Trash2 className="h-4 w-4" />
                                  </button>
                                </div>
                              </td>
                            )}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : activeTab === 'verify' ? (
                <div className="space-y-8 animate-in fade-in slide-in-from-bottom-8 duration-700">
                  <div className="glass rounded-3xl p-6 sm:p-10 shadow-2xl space-y-6">
                    <div className="flex items-center space-x-3 mb-6">
                      <div className="p-3 bg-indigo-500/20 text-indigo-400 rounded-xl">
                        <UserCheck className="h-6 w-6" />
                      </div>
                      <div>
                        <h2 className="text-xl font-bold text-white">Verification Center</h2>
                        <p className="text-sm text-muted-foreground">Monitor and manage Discord verification sessions.</p>
                      </div>
                    </div>
                    <VerifySessionsPanel 
                      sessions={verifySessions} 
                      onReviewed={() => loadConfigs()} 
                    />
                  </div>
                </div>
              ) : (
                <div className="py-32 text-center text-white/20 italic font-black uppercase tracking-widest">
                   No module selected
                </div>
              )}
            </div>
        </div>

        {/* Grading Modal */}
        {gradingModal.open && gradingModal.response && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={() => { setGradingModal({ open: false, response: null }); setAiGrades({}); setAiGradeMeta(null); setEditingAiScoreId(null) }} />
            <div className="glass rounded-[2.5rem] w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col relative animate-in zoom-in-95 duration-200">
              <div className="p-8 border-b border-white/10 flex justify-between items-center bg-white/5">
                <div>
                  <h2 className="text-2xl font-black text-white uppercase tracking-widest flex items-center">
                    <ClipboardList className="h-6 w-6 text-indigo-400 mr-3" />
                    Grade Submission
                  </h2>
                  <p className="text-[10px] text-muted-foreground font-black uppercase tracking-widest mt-1">ID: {gradingModal.response.responseId}</p>
                </div>
                <button onClick={() => { setGradingModal({ open: false, response: null }); setAiGrades({}); setAiGradeMeta(null); setEditingAiScoreId(null) }} className="p-2 hover:bg-white/10 rounded-xl text-white/50 hover:text-white transition-all">
                  <XCircle className="h-6 w-6" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-8 space-y-8 custom-scrollbar">
                <div className="space-y-4">
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="text-xs font-black text-indigo-400 uppercase tracking-widest flex items-center">
                      <FileText className="h-3 w-3 mr-2" />
                      Answers
                    </h3>
                    <div className="flex items-center gap-2">
                      {Object.keys(aiGrades).length > 0 && (
                        <div className="text-[10px] font-black uppercase tracking-widest text-white/40">
                          Total: <span className="text-white/80">{Object.values(aiGrades).reduce((s, v) => s + (Number(v.score) || 0), 0)}</span>
                          <span className="text-white/30"> / {(() => {
                            const rows = Array.isArray(gradingModal.response.answersOrdered)
                              ? gradingModal.response.answersOrdered
                              : Object.entries(gradingModal.response.answers || {}).map(([title, value]: [any, any]) => ({ questionId: String(title), title, value }))
                            return rows.length * 10
                          })()}</span>
                        </div>
                      )}
                      <button
                        onClick={runAiPregrade}
                        disabled={aiGradeLoading}
                        className="px-3 py-1.5 bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-300 border border-indigo-500/20 rounded-xl transition-all disabled:opacity-50 text-[10px] font-black uppercase tracking-widest flex items-center gap-2"
                      >
                        {aiGradeLoading ? <Activity className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />}
                        <span>AI pre-grade</span>
                      </button>
                    </div>
                  </div>
                  {aiGradeMeta?.modelLabel && (
                    <p className="text-[10px] text-white/30 font-mono">Model: {aiGradeMeta.modelLabel}</p>
                  )}
                  <div className="grid gap-4">
                    {(Array.isArray(gradingModal.response.answersOrdered)
                      ? gradingModal.response.answersOrdered
                      : Object.entries(gradingModal.response.answers).map(([title, value]: [any, any]) => ({
                          questionId: String(title),
                          title,
                          value,
                        }))
                    ).map((row: any) => (
                      <div key={row.questionId ?? row.title} className="bg-white/5 border border-white/5 p-4 rounded-2xl">
                        <div className="flex items-start justify-between gap-3">
                          <p className="text-[10px] font-black text-white/40 uppercase tracking-widest mb-1">{row.title}</p>
                          <div className="flex items-center gap-2">
                            {editingAiScoreId === String(row.questionId) ? (
                              <input
                                type="number"
                                autoFocus
                                min={0}
                                max={10}
                                defaultValue={aiGrades[String(row.questionId)]?.score ?? 0}
                                onBlur={(e) => {
                                  const n = Number(e.target.value)
                                  const score = Number.isFinite(n) ? Math.max(0, Math.min(10, Math.round(n))) : 0
                                  setAiGrades(prev => ({ ...prev, [String(row.questionId)]: { ...(prev[String(row.questionId)] || {}), score } }))
                                  setEditingAiScoreId(null)
                                }}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                                  if (e.key === 'Escape') setEditingAiScoreId(null)
                                }}
                                className="w-16 bg-black/40 border border-white/10 rounded-lg px-2 py-1 text-[10px] text-white font-mono outline-none focus:border-indigo-500/50"
                              />
                            ) : (
                              <button
                                onDoubleClick={() => setEditingAiScoreId(String(row.questionId))}
                                className="px-2 py-1 rounded-lg border border-white/10 bg-black/30 text-[10px] font-black uppercase tracking-widest text-white/70 hover:bg-white/5 transition-all select-none"
                                title="Double-click to edit points"
                              >
                                {(aiGrades[String(row.questionId)]?.score ?? '—')}/10
                              </button>
                            )}
                          </div>
                        </div>
                        <p className="text-sm text-white font-medium">{row.value || <span className="italic text-white/20">No answer</span>}</p>
                        {aiGrades[String(row.questionId)]?.rationale && (
                          <p className="text-[10px] text-white/35 mt-2">{aiGrades[String(row.questionId)]?.rationale}</p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>

                <div className="space-y-6 pt-6 border-t border-white/10">
                  <h3 className="text-xs font-black text-emerald-400 uppercase tracking-widest flex items-center">
                    <Zap className="h-3 w-3 mr-2" />
                    Grading Form
                  </h3>
                  
                  <GradingForm 
                    response={gradingModal.response} 
                    onSubmit={submitGrade} 
                    onCancel={() => setGradingModal({ open: false, response: null })} 
                    isSaving={saving === 'grading'}
                  />
                </div>
              </div>
            </div>
          </div>
        )}
        <footer className="w-full py-8 border-t border-white/5 mt-12 flex justify-center space-x-6">
          <a href="/tos" className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground hover:text-indigo-400 transition-colors">Terms of Service</a>
          <a href="/privacy" className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground hover:text-indigo-400 transition-colors">Privacy Policy</a>
          <a href="/credits" className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground hover:text-indigo-400 transition-colors">Credits</a>
          <span className="text-[10px] font-bold uppercase tracking-widest text-white/20">© 2026 Admin Portal</span>
        </footer>
      </main>

      {/* Custom Plan Modal */}
      {editingCustomUser && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in transition-all">
          <div className="bg-[#0A0A0B] border border-white/10 rounded-[2.5rem] w-full max-w-md shadow-2xl shadow-indigo-500/10 overflow-hidden animate-in zoom-in-95 slide-in-from-bottom-4 duration-300">
            <div className="p-8 space-y-6">
              <div className="flex items-center justify-between">
                <div className="space-y-1">
                  <h2 className="text-xl font-black text-white tracking-tight">Plan overrides</h2>
                  <p className="text-xs text-muted-foreground uppercase font-bold tracking-widest">
                    {editingCustomUser.username} · <span className="text-indigo-300">{editingCustomUser.plan}</span>
                  </p>
                </div>
                <button 
                  onClick={() => setEditingCustomUser(null)}
                  className="p-2 bg-white/5 hover:bg-white/10 rounded-full text-muted-foreground hover:text-white transition-all"
                >
                  <XCircle className="h-5 w-5" />
                </button>
              </div>

              <div className="space-y-4">
                <div className="space-y-2">
                  <label className="text-[10px] text-muted-foreground font-black uppercase tracking-widest ml-1">Daily Global Limit</label>
                  <input 
                    type="number" 
                    value={customForm.daily}
                    onChange={(e) => setCustomForm({ ...customForm, daily: parseInt(e.target.value, 10) || 0 })}
                    className="w-full bg-white/5 border border-white/10 rounded-2xl py-4 px-6 text-white font-mono focus:ring-2 focus:ring-indigo-500/50 outline-none transition-all"
                    placeholder="e.g. 100000"
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] text-muted-foreground font-black uppercase tracking-widest ml-1">Burst Limit (Req/Min)</label>
                  <input 
                    type="number" 
                    value={customForm.minute}
                    onChange={(e) => setCustomForm({ ...customForm, minute: parseInt(e.target.value, 10) || 0 })}
                    className="w-full bg-white/5 border border-white/10 rounded-2xl py-4 px-6 text-white font-mono focus:ring-2 focus:ring-indigo-500/50 outline-none transition-all"
                    placeholder="e.g. 100"
                  />
                </div>
                
                <div className="space-y-3 p-4 bg-white/5 rounded-2xl border border-white/10">
                  <div className="flex items-center justify-between">
                    <div className="space-y-1">
                      <span className="text-xs font-bold text-white">Subscription Duration</span>
                      <p className="text-[10px] text-muted-foreground leading-tight">Set how long this plan stays active</p>
                    </div>
                    <button 
                      type="button"
                      onClick={() =>
                        setCustomForm({
                          ...customForm,
                          indefinite: !customForm.indefinite,
                          ...(customForm.indefinite ? {} : { expiryDate: '' }),
                        })
                      }
                      className={`px-3 py-1 rounded-lg text-[10px] font-black uppercase transition-all ${customForm.indefinite ? 'bg-indigo-500 text-white' : 'bg-white/10 text-white/40'}`}
                    >
                      {customForm.indefinite ? 'Indefinite' : 'Limited'}
                    </button>
                  </div>
                  
                  {!customForm.indefinite && (
                    <div className="pt-2 space-y-3 animate-in slide-in-from-top-2 duration-200">
                      <div className="space-y-1.5">
                        <label className="text-[10px] text-muted-foreground font-black uppercase tracking-widest">End date (manual)</label>
                        <input
                          type="datetime-local"
                          value={customForm.expiryDate}
                          onChange={(e) => setCustomForm({ ...customForm, expiryDate: e.target.value })}
                          className="w-full bg-black/40 border border-white/10 rounded-xl py-2 px-3 text-white text-xs font-mono focus:ring-1 focus:ring-indigo-500 outline-none"
                        />
                        <p className="text-[9px] text-muted-foreground leading-tight">
                          If set, this exact time is used. Otherwise the duration below applies from today.
                        </p>
                      </div>
                      <div className="flex items-center space-x-3">
                        <input 
                          type="number" 
                          min="1"
                          max="120"
                          value={customForm.months}
                          onChange={(e) => setCustomForm({ ...customForm, months: parseInt(e.target.value, 10) || 1 })}
                          className="w-20 bg-black/40 border border-white/10 rounded-xl py-2 px-3 text-white text-xs font-mono focus:ring-1 focus:ring-indigo-500 outline-none"
                        />
                        <span className="text-[10px] font-black text-muted-foreground uppercase tracking-widest">Months from today</span>
                      </div>
                    </div>
                  )}
                </div>
              </div>

                <div className="flex items-center justify-between p-4 bg-white/5 rounded-2xl border border-white/10">
                  <div className="space-y-1">
                    <span className="text-xs font-bold text-white">Ryuu API Access</span>
                    <p className="text-[10px] text-muted-foreground leading-tight">Enable Ryuu multi-source auto-gen</p>
                  </div>
                  <button 
                    type="button"
                    onClick={() => setCustomForm({ ...customForm, ryuu: !customForm.ryuu })}
                    className={`w-12 h-6 rounded-full transition-all relative ${customForm.ryuu ? 'bg-indigo-500' : 'bg-white/10'}`}
                  >
                    <div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all ${customForm.ryuu ? 'left-7' : 'left-1'}`}></div>
                  </button>
                </div>

                <div className="flex items-center justify-between p-4 bg-white/5 rounded-2xl border border-white/10">
                  <div className="space-y-1">
                    <span className="text-xs font-bold text-white">Morrenus API Access</span>
                    <p className="text-[10px] text-muted-foreground leading-tight">Allow high-performance manifest fetching</p>
                  </div>
                  <button 
                    type="button"
                    onClick={() => setCustomForm({ ...customForm, morrenus: !customForm.morrenus })}
                    className={`w-12 h-6 rounded-full transition-all relative ${customForm.morrenus ? 'bg-indigo-500' : 'bg-white/10'}`}
                  >
                    <div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all ${customForm.morrenus ? 'left-7' : 'left-1'}`}></div>
                  </button>
                </div>

              <div className="pt-4 grid grid-cols-2 gap-4">
                <button 
                  type="button"
                  onClick={() => setEditingCustomUser(null)}
                  className="py-4 bg-white/5 text-white/70 text-xs font-black uppercase tracking-widest rounded-2xl hover:bg-white/10 transition-all"
                >
                  Cancel
                </button>
                <button 
                  type="button"
                  onClick={async () => {
                    let planExpiry: string | null = null
                    if (!customForm.indefinite) {
                      if (customForm.expiryDate.trim()) {
                        planExpiry = new Date(customForm.expiryDate).toISOString()
                      } else {
                        const d = new Date()
                        d.setMonth(d.getMonth() + customForm.months)
                        planExpiry = d.toISOString()
                      }
                    }
                    await updateUser(editingCustomUser.id, {
                      customDailyLimit: customForm.daily,
                      customMinuteLimit: customForm.minute,
                      customAllowMorrenus: customForm.morrenus,
                      customAllowRyuu: customForm.ryuu,
                      planExpiry,
                    })
                    setEditingCustomUser(null)
                  }}
                  className="py-4 bg-indigo-500 text-white text-xs font-black uppercase tracking-widest rounded-2xl hover:bg-indigo-600 transition-all shadow-xl shadow-indigo-500/20"
                >
                  Save Config
                </button>
              </div>
            </div>
          </div>
        </div>

      )}

      {/* Punishment Edit/Create Modal */}
      {editingPunishment && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in transition-all">
          <div className="bg-[#0A0A0B] border border-white/10 rounded-[2.5rem] w-full max-w-md shadow-2xl shadow-indigo-500/10 overflow-hidden animate-in zoom-in-95 slide-in-from-bottom-4 duration-300">
            <div className="p-8 space-y-6">
              <div className="flex items-center justify-between">
                <div className="space-y-1">
                  <h2 className="text-xl font-black text-white tracking-tight">
                    {editingPunishment === 'new' ? 'Log Infraction' : 'Edit Infraction'}
                  </h2>
                  <p className="text-xs text-muted-foreground uppercase font-bold tracking-widest">
                    {editingPunishment === 'new' ? 'Create new punishment record' : `Editing record ID: ${editingPunishment.id.slice(0, 8)}...`}
                  </p>
                </div>
                <button 
                  onClick={() => setEditingPunishment(null)}
                  className="p-2 bg-white/5 hover:bg-white/10 rounded-full text-muted-foreground hover:text-white transition-all"
                >
                  <XCircle className="h-5 w-5" />
                </button>
              </div>

              <div className="space-y-4">
                <div className="space-y-2">
                  <label className="text-[10px] text-muted-foreground font-black uppercase tracking-widest ml-1">Type</label>
                  <select 
                    value={punishmentForm.type}
                    onChange={(e) => setPunishmentForm({ ...punishmentForm, type: e.target.value })}
                    className="w-full bg-white/5 border border-white/10 rounded-2xl py-4 px-6 text-white outline-none focus:ring-2 focus:ring-indigo-500/50 transition-all font-sans"
                  >
                    <option value="WARN" className="bg-[#0A0A0B] text-white">WARN</option>
                    <option value="TIMEOUT" className="bg-[#0A0A0B] text-white">TIMEOUT</option>
                  </select>
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] text-muted-foreground font-black uppercase tracking-widest ml-1">Target Username</label>
                  <input 
                    type="text" 
                    value={punishmentForm.username}
                    onChange={(e) => setPunishmentForm({ ...punishmentForm, username: e.target.value })}
                    className="w-full bg-white/5 border border-white/10 rounded-2xl py-4 px-6 text-white focus:ring-2 focus:ring-indigo-500/50 outline-none transition-all"
                    placeholder="e.g. johndoe"
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] text-muted-foreground font-black uppercase tracking-widest ml-1">Target Discord ID</label>
                  <input 
                    type="text" 
                    value={punishmentForm.discordId}
                    onChange={(e) => setPunishmentForm({ ...punishmentForm, discordId: e.target.value })}
                    className="w-full bg-white/5 border border-white/10 rounded-2xl py-4 px-6 text-white font-mono focus:ring-2 focus:ring-indigo-500/50 outline-none transition-all"
                    placeholder="e.g. 123456789012345678"
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] text-muted-foreground font-black uppercase tracking-widest ml-1">Reason</label>
                  <textarea 
                    value={punishmentForm.reason}
                    onChange={(e) => setPunishmentForm({ ...punishmentForm, reason: e.target.value })}
                    className="w-full bg-white/5 border border-white/10 rounded-2xl py-4 px-6 text-white focus:ring-2 focus:ring-indigo-500/50 outline-none transition-all h-24 resize-none"
                    placeholder="Reason for this infraction..."
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] text-muted-foreground font-black uppercase tracking-widest ml-1">Duration (Optional - For timeouts)</label>
                  <input 
                    type="text" 
                    value={punishmentForm.duration}
                    onChange={(e) => setPunishmentForm({ ...punishmentForm, duration: e.target.value })}
                    className="w-full bg-white/5 border border-white/10 rounded-2xl py-4 px-6 text-white focus:ring-2 focus:ring-indigo-500/50 outline-none transition-all"
                    placeholder="e.g. 5m, 1h, 1d"
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] text-muted-foreground font-black uppercase tracking-widest ml-1">Proof URL (Image/Screenshot Link)</label>
                  <input 
                    type="text" 
                    value={punishmentForm.proofUrl}
                    onChange={(e) => setPunishmentForm({ ...punishmentForm, proofUrl: e.target.value })}
                    className="w-full bg-white/5 border border-white/10 rounded-2xl py-4 px-6 text-white font-mono focus:ring-2 focus:ring-indigo-500/50 outline-none transition-all"
                    placeholder="e.g. https://cdn.discordapp.com/attachments/..."
                  />
                </div>

                <button 
                  disabled={saving === 'save-punishment'}
                  onClick={handleSavePunishment}
                  className="w-full py-4 bg-indigo-500 text-white text-xs font-black uppercase tracking-widest rounded-2xl hover:bg-indigo-600 transition-all shadow-xl shadow-indigo-500/20 disabled:opacity-50"
                >
                  {saving === 'save-punishment' ? 'Saving Infraction...' : 'Save Infraction'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Proof Lightbox Modal */}
      {selectedProofUrl && (
        <div className="fixed inset-0 z-[300] flex items-center justify-center p-4 bg-black/95 backdrop-blur-md animate-in fade-in transition-all">
          <div className="relative max-w-4xl max-h-[85vh] flex flex-col items-center">
            <button 
              onClick={() => setSelectedProofUrl(null)}
              className="absolute -top-12 right-0 p-2.5 bg-white/5 hover:bg-white/10 rounded-full text-white/50 hover:text-white transition-all z-10"
            >
              <XCircle className="h-6 w-6" />
            </button>
            <img 
              src={selectedProofUrl} 
              alt="High-resolution Infraction Proof" 
              className="rounded-2xl border border-white/10 max-w-full max-h-[80vh] object-contain shadow-2xl"
            />
            <div className="mt-4 flex items-center space-x-2 text-xs font-mono text-white/40">
              <ExternalLink className="h-3.5 w-3.5" />
              <a href={selectedProofUrl} target="_blank" rel="noopener noreferrer" className="hover:text-indigo-400 underline transition-all">
                Open image in new tab
              </a>
            </div>
          </div>
        </div>
      )}

      {/* Custom Confirmation Dialog */}
      {executiveReportsUser && (
        <ExecutiveReportsPanel
          userId={executiveReportsUser.id}
          username={executiveReportsUser.username}
          onClose={() => setExecutiveReportsUser(null)}
        />
      )}

      {confirmDialog.open && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in transition-all">
          <div className="bg-[#0A0A0B] border border-white/10 rounded-[2.5rem] w-full max-w-sm shadow-2xl shadow-indigo-500/10 overflow-hidden animate-in zoom-in-95 duration-300">
            <div className="p-8 text-center space-y-6">
              <div className={`mx-auto w-16 h-16 rounded-full flex items-center justify-center ${
                confirmDialog.type === 'danger' ? 'bg-red-500/10 text-red-500' : 
                confirmDialog.type === 'warning' ? 'bg-amber-500/10 text-amber-500' : 
                'bg-indigo-500/10 text-indigo-500'
              }`}>
                {confirmDialog.type === 'danger' ? <Ban className="h-8 w-8" /> : <ShieldAlert className="h-8 w-8" />}
              </div>
              
              <div className="space-y-2">
                <h3 className="text-xl font-black text-white tracking-tight">{confirmDialog.title}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">{confirmDialog.message}</p>
              </div>

              <div className="grid grid-cols-2 gap-3 pt-2">
                <button 
                  onClick={() => setConfirmDialog(p => ({ ...p, open: false }))}
                  className="py-3.5 bg-white/5 hover:bg-white/10 text-white text-xs font-black uppercase tracking-widest rounded-2xl transition-all"
                >
                  Cancel
                </button>
                <button 
                  onClick={confirmDialog.onConfirm}
                  className={`py-3.5 text-white text-xs font-black uppercase tracking-widest rounded-2xl transition-all shadow-xl ${
                    confirmDialog.type === 'danger' ? 'bg-red-500 hover:bg-red-600 shadow-red-500/20' : 'bg-indigo-500 hover:bg-indigo-600 shadow-indigo-500/20'
                  }`}
                >
                  Confirm
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      {/* Public Incident Modal */}
      {incidentModal.open && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-md animate-in fade-in duration-300">
          <div className="bg-[#0c0c12] border border-white/10 rounded-[2.5rem] w-full max-w-lg p-8 space-y-6 shadow-2xl shadow-indigo-500/10">
            <div className="flex items-center space-x-4">
              <div className={`p-3 rounded-2xl ${incidentModal.type === 'error' ? 'bg-red-500/20 text-red-400' : 'bg-amber-500/20 text-amber-400'}`}>
                <Bell className="h-6 w-6" />
              </div>
              <div>
                <h3 className="text-xl font-black text-white uppercase tracking-tight">Push to Public Status</h3>
                <p className="text-[10px] text-muted-foreground font-black uppercase tracking-widest">Convert Internal Alert to Public Incident</p>
              </div>
            </div>

            <div className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Incident Title</label>
                <input 
                  value={incidentModal.title}
                  onChange={e => setIncidentModal({...incidentModal, title: e.target.value})}
                  className="w-full bg-white/5 border border-white/10 rounded-2xl py-3 px-4 text-sm text-white focus:outline-none focus:ring-1 focus:ring-indigo-500/50"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Summary (Banner)</label>
                <textarea 
                  value={incidentModal.message}
                  onChange={e => setIncidentModal({...incidentModal, message: e.target.value})}
                  rows={2}
                  className="w-full bg-white/5 border border-white/10 rounded-2xl py-3 px-4 text-sm text-white focus:outline-none focus:ring-1 focus:ring-indigo-500/50 resize-none"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Technical Details</label>
                <textarea 
                  value={incidentModal.description}
                  onChange={e => setIncidentModal({...incidentModal, description: e.target.value})}
                  rows={4}
                  className="w-full bg-white/5 border border-white/10 rounded-2xl py-3 px-4 text-sm text-white focus:outline-none focus:ring-1 focus:ring-indigo-500/50 resize-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Severity</label>
                  <select 
                    value={incidentModal.type}
                    onChange={e => setIncidentModal({...incidentModal, type: e.target.value as any})}
                    className="w-full bg-white/5 border border-white/10 rounded-xl py-2 px-3 text-xs text-white"
                  >
                    <option value="warning" className="bg-black">Yellow (Warning)</option>
                    <option value="error" className="bg-black">Red (Critical)</option>
                  </select>
                </div>
              </div>
            </div>

            <div className="flex space-x-3 pt-2">
              <button 
                onClick={() => setIncidentModal({...incidentModal, open: false})}
                className="flex-1 py-4 bg-white/5 hover:bg-white/10 text-white rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all"
              >
                Cancel
              </button>
              <button 
                onClick={submitIncident}
                disabled={saving === 'push-incident'}
                className="flex-[2] py-4 bg-indigo-500 hover:bg-indigo-600 text-white rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all shadow-lg shadow-indigo-500/20 disabled:opacity-50 flex items-center justify-center space-x-2"
              >
                {saving === 'push-incident' ? <Activity className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                <span>Publish Incident</span>
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Session Detail Modal */}
      {selectedSession && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 md:p-8">
          <div className="absolute inset-0 bg-black/80 backdrop-blur-md animate-in fade-in duration-300" onClick={() => setSelectedSession(null)} />
          <div className="relative w-full max-w-4xl bg-[#0a0a0c] border border-white/10 rounded-[2.5rem] shadow-[0_0_50px_rgba(0,0,0,0.5)] overflow-hidden animate-in zoom-in-95 fade-in duration-300 flex flex-col max-h-[90vh]">
            {/* Modal Header */}
            <div className="p-8 border-b border-white/5 bg-white/[0.02] flex items-center justify-between">
              <div className="flex items-center space-x-4">
                <div className="w-14 h-14 bg-indigo-500/10 border border-indigo-500/20 rounded-2xl flex items-center justify-center text-indigo-400">
                  <Monitor className="h-8 w-8" />
                </div>
                <div>
                  <h2 className="text-2xl font-black text-white tracking-tight">Machine Inspector</h2>
                  <p className="text-[10px] text-muted-foreground font-bold uppercase tracking-widest opacity-60">ID: {selectedSession.sessionId}</p>
                </div>
              </div>
              <button 
                onClick={() => setSelectedSession(null)}
                className="p-3 bg-white/5 hover:bg-white/10 border border-white/10 rounded-2xl transition-all active:scale-90"
              >
                <XCircle className="h-6 w-6 text-white/40" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto custom-scrollbar p-8">
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                {/* Left Column: Identity & Hardware */}
                <div className="space-y-8">
                  <section className="space-y-4">
                    <h4 className="text-[10px] font-black uppercase tracking-[0.2em] text-indigo-400">Client Identity</h4>
                    <div className="p-6 bg-white/5 border border-white/10 rounded-3xl space-y-4">
                      <div className="flex items-center space-x-3">
                         <div className="w-12 h-12 rounded-2xl bg-indigo-500/10 flex items-center justify-center border border-indigo-500/20 text-indigo-400 font-black text-lg">
                            {selectedSession.user?.username?.charAt(0) ?? "?"}
                         </div>
                         <div className="flex flex-col">
                            <span className="text-sm font-black text-white tracking-tight">{selectedSession.user?.username ?? "Unknown"}</span>
                            <span className="text-[10px] text-muted-foreground font-mono opacity-50">{selectedSession.user?.discordId ?? "—"}</span>
                         </div>
                      </div>
                      <div className="pt-4 space-y-3 border-t border-white/5">
                         <div className="flex justify-between items-center text-[10px] font-black">
                            <span className="text-muted-foreground uppercase tracking-widest">Plan Tier</span>
                            <span className="text-indigo-400 bg-indigo-500/10 px-2 py-0.5 rounded border border-indigo-500/20 uppercase">{selectedSession.plan}</span>
                         </div>
                         <div className="flex justify-between items-center text-[10px] font-black">
                            <span className="text-muted-foreground uppercase tracking-widest">App Version</span>
                            <span className="text-white bg-white/5 px-2 py-0.5 rounded border border-white/10">v{selectedSession.appVersion}</span>
                         </div>
                      </div>
                    </div>
                  </section>

                  <section className="space-y-4">
                    <h4 className="text-[10px] font-black uppercase tracking-[0.2em] text-indigo-400">Environment Metadata</h4>
                    <div className="p-6 bg-white/5 border border-white/10 rounded-3xl space-y-5">
                      <div className="flex items-start space-x-3">
                         <Smartphone className="h-4 w-4 text-white/20 mt-1" />
                         <div className="flex flex-col">
                            <span className="text-[10px] font-black text-muted-foreground uppercase tracking-[0.15em]">Operating System</span>
                            <span className="text-[11px] text-white/90 font-bold mt-1.5 leading-relaxed bg-black/20 p-2 rounded-xl border border-white/5 italic">"{selectedSession.os || 'Windows 11 Build 22631'}"</span>
                         </div>
                      </div>
                      <div className="flex items-start space-x-3 pt-5 border-t border-white/5">
                         <ShieldCheck className="h-4 w-4 text-white/20 mt-1" />
                         <div className="flex flex-col">
                            <span className="text-[10px] font-black text-muted-foreground uppercase tracking-[0.15em]">Hardware Signature</span>
                            <span className="text-[10px] text-white/50 font-mono mt-1.5 break-all leading-relaxed bg-black/20 p-2 rounded-xl border border-white/5">{selectedSession.machineId || 'HID-0x3F92A1B0C'}</span>
                         </div>
                      </div>
                    </div>
                  </section>
                </div>

                {/* Right Column: Activity History */}
                <div className="lg:col-span-2 space-y-6">
                  <div className="flex items-center justify-between">
                    <h4 className="text-[10px] font-black uppercase tracking-[0.2em] text-indigo-400">Activity Telemetry (Latest 50)</h4>
                    <div className="flex items-center space-x-2">
                       <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                       <span className="text-[10px] text-emerald-400 font-black uppercase tracking-widest">Live Stream Active</span>
                    </div>
                  </div>

                  <div className="space-y-3 max-h-[500px] overflow-y-auto custom-scrollbar pr-2">
                    {!selectedSession.events || selectedSession.events.length === 0 ? (
                       <div className="py-24 text-center text-white/10 italic text-sm border-2 border-dashed border-white/5 rounded-[2.5rem]">
                          <div className="space-y-4">
                            <Activity className="h-10 w-10 mx-auto opacity-10" />
                            <p className="font-black uppercase tracking-widest">No telemetry signals found</p>
                          </div>
                       </div>
                    ) : selectedSession.events.map((evt: any, idx: number) => (
                       <div key={idx} className="p-5 bg-white/[0.02] border border-white/5 rounded-[1.5rem] flex items-center justify-between group hover:bg-white/[0.05] transition-all hover:scale-[1.01]">
                          <div className="flex items-center space-x-4">
                             <div className={`w-10 h-10 rounded-2xl flex items-center justify-center border ${
                                evt.type === 'startup' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' :
                                evt.type === 'heartbeat' ? 'bg-indigo-500/10 text-indigo-400 border-indigo-500/20' :
                                evt.type === 'install' ? 'bg-amber-500/10 text-amber-400 border-amber-500/20' :
                                'bg-white/5 text-white/40 border-white/10'
                             }`}>
                                {evt.type === 'startup' ? <Zap className="h-5 w-5" /> : 
                                 evt.type === 'heartbeat' ? <Activity className="h-5 w-5" /> :
                                 evt.type === 'install' ? <Plus className="h-5 w-5" /> :
                                 <FileText className="h-5 w-5" />}
                             </div>
                             <div className="flex flex-col">
                                <span className="text-[11px] font-black text-white uppercase tracking-wider">{evt.type}</span>
                                <span className="text-[10px] text-muted-foreground mt-0.5 font-medium">{evt.gameName || evt.detail || 'System process signal transmitted.'}</span>
                             </div>
                          </div>
                          <div className="flex flex-col items-end">
                             <span className="text-[11px] font-black text-white/40 tracking-tighter">{new Date(evt.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
                             <span className="text-[9px] font-bold text-white/10 uppercase tracking-tighter mt-1">{new Date(evt.timestamp).toLocaleDateString()}</span>
                          </div>
                       </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="p-8 border-t border-white/5 bg-white/[0.02] flex items-center justify-between">
              <div className="flex items-center space-x-10 text-[10px] font-black uppercase tracking-[0.2em]">
                 <div className="flex flex-col">
                    <span className="text-white/20 mb-1.5">Network Status</span>
                    <span className={`flex items-center space-x-2 ${selectedSession.online ? 'text-emerald-400' : 'text-zinc-600'}`}>
                       <span className={`w-1.5 h-1.5 rounded-full ${selectedSession.online ? 'bg-emerald-500' : 'bg-zinc-600'}`} />
                       <span>{selectedSession.online ? 'ONLINE SIGNAL' : 'DISCONNECTED'}</span>
                    </span>
                 </div>
                 <div className="flex flex-col">
                    <span className="text-white/20 mb-1.5">Usage Efficiency</span>
                    <span className="text-white">{selectedSession.usage.today} <span className="text-white/20">/</span> {selectedSession.usage.limit} <span className="text-white/20">REQ</span></span>
                 </div>
              </div>
              <div className="flex space-x-4">
                 <button 
                  onClick={() => setSelectedSession(null)}
                  className="px-8 py-4 bg-white/5 hover:bg-white/10 text-white/60 text-[10px] font-black uppercase tracking-widest rounded-[1.25rem] transition-all border border-white/10"
                 >
                   Dismiss
                 </button>
                 <button 
                  className="px-10 py-4 bg-indigo-500 hover:bg-indigo-600 text-white text-[10px] font-black uppercase tracking-widest rounded-[1.25rem] transition-all shadow-xl shadow-indigo-500/30"
                  onClick={() => window.open(`https://discord.com/users/${selectedSession.user.discordId}`, '_blank')}
                 >
                   Open Profile
                 </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Trigger Account Drop Modal */}
      {showDropModal && (
        <div className="fixed inset-0 z-[150] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/80 backdrop-blur-md animate-in fade-in duration-300" onClick={() => setShowDropModal(false)} />
          <div className="relative w-full max-w-md bg-[#0a0a0c] border border-white/10 rounded-[2.5rem] shadow-[0_0_50px_rgba(0,0,0,0.5)] overflow-hidden animate-in zoom-in-95 fade-in duration-300 p-8">
            
            {/* Modal Header */}
            <div className="flex items-center space-x-4 mb-6">
              <div className="w-12 h-12 bg-indigo-500/10 border border-indigo-500/20 rounded-2xl flex items-center justify-center text-indigo-400">
                <Gift className="h-6 w-6" />
              </div>
              <div>
                <h2 className="text-xl font-black text-white tracking-tight">Trigger Account Drop</h2>
                <p className="text-[9px] text-muted-foreground font-bold uppercase tracking-widest opacity-60">Simulate Discord Slash Command</p>
              </div>
            </div>

            {/* Modal Content */}
            <div className="space-y-6">
              <div className="bg-white/[0.02] border border-white/5 rounded-2xl p-4 space-y-2">
                <label className="text-[10px] font-black uppercase text-indigo-300 tracking-wider">Number of Accounts</label>
                <div className="flex items-center space-x-4">
                  <input 
                    type="range" 
                    min="1" 
                    max="25" 
                    value={dropAmount} 
                    onChange={(e) => setDropAmount(parseInt(e.target.value) || 1)} 
                    className="flex-1 accent-indigo-500 bg-zinc-800 h-1.5 rounded-lg appearance-none cursor-pointer"
                  />
                  <input 
                    type="number"
                    min="1"
                    max="25"
                    value={dropAmount}
                    onChange={(e) => {
                      const val = parseInt(e.target.value) || 0
                      setDropAmount(Math.max(1, Math.min(25, val)))
                    }}
                    className="w-16 bg-black/40 border border-white/10 rounded-xl py-1 text-center text-sm font-black text-white font-mono focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/50 outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                  />
                </div>
                <p className="text-[9px] text-muted-foreground mt-2">
                  Select a quantity between 1 and 25 accounts to drop instantly to Discord.
                </p>
              </div>

              <div className="bg-white/[0.02] border border-white/5 rounded-2xl p-4 space-y-2">
                <label className="text-[10px] font-black uppercase text-indigo-300 tracking-wider">Platform</label>
                <input
                  type="text"
                  placeholder="e.g. steam, netflix"
                  value={dropPlatform}
                  onChange={(e) => setDropPlatform(e.target.value.trim().toLowerCase())}
                  className="w-full bg-black/40 border border-white/10 rounded-xl py-2 px-4 text-xs text-white font-mono focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/50 outline-none"
                />
                <p className="text-[9px] text-muted-foreground mt-2">
                  Matches a file in drops/ (steam.txt, netflix.txt, etc.).
                </p>
              </div>

              <div className="bg-white/[0.02] border border-white/5 rounded-2xl p-4 space-y-2">
                <label className="text-[10px] font-black uppercase text-indigo-300 tracking-wider">Minimum Games Filter</label>
                <div className="flex items-center space-x-4">
                  <input 
                    type="number"
                    min="0"
                    placeholder="e.g. 10 (optional)"
                    value={minGamesFilter === 0 ? '' : minGamesFilter}
                    onChange={(e) => {
                      const val = parseInt(e.target.value) || 0
                      setMinGamesFilter(Math.max(0, val))
                    }}
                    className="flex-1 bg-black/40 border border-white/10 rounded-xl py-2 px-4 text-xs text-white font-mono focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/50 outline-none"
                  />
                </div>
                <p className="text-[9px] text-muted-foreground mt-2">
                  Only drop accounts that have at least this number of total games. Leave 0 or empty for no filter.
                </p>
              </div>

              {/* Action Buttons */}
              <div className="flex space-x-3">
                <button 
                  type="button"
                  onClick={() => { setShowDropModal(false); setMinGamesFilter(0); }}
                  className="flex-1 py-3 bg-white/5 hover:bg-white/10 text-white rounded-xl text-[10px] font-black uppercase tracking-widest transition-all border border-white/5"
                >
                  Cancel
                </button>
                <button 
                  type="button"
                  onClick={async () => {
                    setDropLoading(true)
                    try {
                      const res = await fetch('/api/admin/bot/commands', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ action: 'MANUAL_DROP', count: dropAmount, minGames: minGamesFilter, platform: dropPlatform })
                      })
                      const data = await res.json()
                      if (res.ok) {
                        toastSuccess('Drop Successful', data.message || `Dropped ${dropAmount} accounts to Discord drop channel!`)
                        setShowDropModal(false)
                        setMinGamesFilter(0)
                      } else {
                        toastError('Drop Failed', data.error || 'Failed to trigger account drop.')
                      }
                    } catch (err: any) {
                      toastError('Drop Error', err.message || 'An unexpected error occurred.')
                    } finally {
                      setDropLoading(false)
                    }
                  }}
                  disabled={dropLoading}
                  className="flex-[2] py-3 bg-indigo-500 hover:bg-indigo-600 text-white rounded-xl text-[10px] font-black uppercase tracking-widest transition-all shadow-lg shadow-indigo-500/20 disabled:opacity-50 flex items-center justify-center space-x-2"
                >
                  {dropLoading ? <Activity className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  <span>Execute Drop</span>
                </button>
              </div>

            </div>

          </div>
        </div>
      )}
    </div>
  )
}

function ApplicationsTabComponent({ responses, loading, onGrade, formId, setFormId, refresh, trelloCards, trelloLists, trelloStats, trelloLoading, trelloError, loadTrello, moveCard, onPushToTrello, savingTrello }: any) {
  const [filter, setFilter] = useState<'all' | 'graded' | 'ungraded'>('all')
  
  // Compute stats
  const graded = responses.filter((r: any) => r.graded)
  const ungraded = responses.filter((r: any) => !r.graded)
  const avgScore = graded.length > 0 ? Math.round(graded.reduce((sum: number, r: any) => sum + (r.score || 0), 0) / graded.length) : null
  const passCount = graded.filter((r: any) => (r.score || 0) >= APPLICATION_PASS_SCORE).length
  const failCount = graded.filter((r: any) => (r.score || 0) < APPLICATION_PASS_SCORE).length

  const filtered = filter === 'graded' ? graded : filter === 'ungraded' ? ungraded : responses

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-white/5 pb-6">
        <div className="flex items-center space-x-3">
          <div className="p-3 bg-indigo-500/20 rounded-2xl border border-indigo-500/30">
            <ClipboardList className="h-6 w-6 text-indigo-400" />
          </div>
          <div>
            <h3 className="text-xl font-black text-white uppercase tracking-widest text-shadow-glow flex items-center">Recruitment Center</h3>
            <p className="text-[10px] text-muted-foreground font-black uppercase tracking-widest">Process Google Form applications & release results</p>
          </div>
        </div>
        <div className="flex items-center space-x-2">
          <div className="relative group">
            <input type="text" value={formId} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setFormId(e.target.value)} placeholder="Google Form ID..."
              className="bg-white/5 border border-white/10 rounded-xl px-4 py-2 text-sm text-white w-64 focus:border-indigo-500/50 transition-all outline-none" />
          </div>
          <button onClick={refresh} disabled={loading} className="p-2 bg-indigo-500 hover:bg-indigo-600 text-white rounded-xl transition-all disabled:opacity-50">
            {loading ? <Activity className="h-5 w-5 animate-spin" /> : <Search className="h-5 w-5" />}
          </button>
        </div>
      </div>

      {/* Stats Bar */}
      {responses.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <div className="p-3 bg-white/5 rounded-2xl border border-white/10 text-center">
            <p className="text-lg font-black text-white">{responses.length}</p>
            <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">Total</p>
          </div>
          <div className="p-3 bg-emerald-500/10 rounded-2xl border border-emerald-500/20 text-center">
            <p className="text-lg font-black text-emerald-400">{graded.length}</p>
            <p className="text-[9px] font-black uppercase tracking-widest text-emerald-400/60">Graded</p>
          </div>
          <div className="p-3 bg-amber-500/10 rounded-2xl border border-amber-500/20 text-center">
            <p className="text-lg font-black text-amber-400">{ungraded.length}</p>
            <p className="text-[9px] font-black uppercase tracking-widest text-amber-400/60">Pending</p>
          </div>
          <div className="p-3 bg-indigo-500/10 rounded-2xl border border-indigo-500/20 text-center">
            <p className="text-lg font-black text-indigo-400">{avgScore ?? '—'}</p>
            <p className="text-[9px] font-black uppercase tracking-widest text-indigo-400/60">Avg Score</p>
          </div>
          <div className="p-3 bg-white/5 rounded-2xl border border-white/10 text-center">
            <p className="text-lg font-black text-white">{passCount}<span className="text-emerald-400">✓</span> / {failCount}<span className="text-red-400">✗</span></p>
            <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">Pass/Fail</p>
          </div>
        </div>
      )}

      {/* Filter Tabs */}
      <div className="flex space-x-2">
        {(['all', 'ungraded', 'graded'] as const).map(f => (
          <button key={f} onClick={() => setFilter(f)}
            className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all border ${filter === f ? 'bg-indigo-500/20 text-indigo-400 border-indigo-500/30' : 'bg-white/5 text-muted-foreground border-white/10 hover:bg-white/10'}`}>
            {f === 'all' ? `All (${responses.length})` : f === 'graded' ? `Graded (${graded.length})` : `Pending (${ungraded.length})`}
          </button>
        ))}
      </div>

      <div className="glass rounded-3xl border border-white/10 overflow-hidden shadow-2xl">
        <table className="w-full text-left">
          <thead>
            <tr className="bg-white/5 text-[10px] font-black uppercase tracking-widest text-muted-foreground">
              <th className="px-6 py-4">Status</th>
              <th className="px-6 py-4">Time</th>
              <th className="px-6 py-4">Discord</th>
              <th className="px-6 py-4">Score</th>
              <th className="px-6 py-4">Percentile</th>
              <th className="px-6 py-4 text-right">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {loading && filtered.length === 0 ? (
              <tr><td colSpan={6} className="px-6 py-20 text-center">
                <Activity className="h-8 w-8 text-indigo-500 animate-spin mx-auto mb-4" />
                <p className="text-xs font-bold text-muted-foreground uppercase tracking-widest">Syncing with Google Forms Cloud...</p>
              </td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={6} className="px-6 py-20 text-center text-muted-foreground italic text-sm">
                {filter !== 'all' ? `No ${filter} submissions.` : 'No submissions found. Check your Form ID and Google permissions.'}
              </td></tr>
            ) : (
              filtered.map((resp: any) => {
                const discordKey = Object.keys(resp.answers).find((k: string) => k.toLowerCase().includes('discord'));
                const discordVal = discordKey ? resp.answers[discordKey] : 'N/A';
                return (
                  <tr key={resp.responseId} className="group hover:bg-white/[0.02] transition-colors">
                    <td className="px-6 py-4">
                      {resp.graded ? (
                        <span className={`text-[10px] font-black uppercase tracking-widest px-2 py-1 rounded-full border ${(resp.score || 0) >= APPLICATION_PASS_SCORE ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20' : 'text-red-400 bg-red-500/10 border-red-500/20'}`}>
                          {(resp.score || 0) >= APPLICATION_PASS_SCORE ? 'Passed' : 'Failed'}
                        </span>
                      ) : (
                        <span className="text-[10px] font-black uppercase tracking-widest px-2 py-1 rounded-full border text-amber-400 bg-amber-500/10 border-amber-500/20">Pending</span>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      <p className="text-sm text-white font-medium">{new Date(resp.createTime).toLocaleDateString()}</p>
                      <p className="text-[10px] text-white/30">{new Date(resp.createTime).toLocaleTimeString()}</p>
                    </td>
                    <td className="px-6 py-4">
                      <span className="text-sm text-indigo-300 font-bold">{discordVal}</span>
                    </td>
                    <td className="px-6 py-4">
                      {resp.graded ? <span className="text-sm font-bold text-white">{resp.score}/{APPLICATION_MAX_SCORE}</span> : <span className="text-sm text-white/20">—</span>}
                    </td>
                    <td className="px-6 py-4">
                      {resp.percentile !== null ? (
                        <div className="flex items-center space-x-2">
                          <div className="w-16 h-1.5 bg-white/10 rounded-full overflow-hidden">
                            <div className="h-full bg-indigo-500 rounded-full" style={{ width: `${resp.percentile}%` }} />
                          </div>
                          <span className="text-[10px] font-black text-indigo-400">{resp.percentile}th</span>
                        </div>
                      ) : <span className="text-sm text-white/20">—</span>}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <button onClick={() => onGrade(resp)}
                        className={`px-4 py-1.5 border rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${resp.graded ? 'bg-white/5 hover:bg-white/10 text-muted-foreground border-white/10' : 'bg-indigo-500/10 hover:bg-indigo-500 text-indigo-400 hover:text-white border-indigo-500/20'}`}>
                        {resp.graded ? 'Re-grade' : 'Grade & Release'}
                      </button>
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Trello Board Sync */}
      <div className="mt-10 pt-8 border-t border-white/10">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
          <div className="flex items-center space-x-3">
            <div className="p-3 bg-blue-500/20 rounded-2xl border border-blue-500/30">
              <Layers className="h-6 w-6 text-blue-400" />
            </div>
            <div>
              <h3 className="text-xl font-black text-white uppercase tracking-widest flex items-center">
                Trello Board Sync
                {trelloStats && (
                  <span className="ml-3 text-[8px] text-blue-400 bg-blue-500/10 px-2 py-0.5 rounded-full border border-blue-500/20 font-black uppercase tracking-widest">
                    {trelloStats.total} cards
                  </span>
                )}
              </h3>
              <p className="text-[10px] text-muted-foreground font-black uppercase tracking-widest">Parse application marking from Trello board</p>
            </div>
          </div>
          <div className="flex items-center space-x-3">
            <button onClick={loadTrello} disabled={trelloLoading} className="px-4 py-2 bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 border border-blue-500/20 rounded-xl transition-all disabled:opacity-50 flex items-center space-x-2 text-[10px] font-black uppercase tracking-widest">
              {trelloLoading ? <Activity className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              <span>Sync Trello</span>
            </button>
            <button onClick={onPushToTrello} disabled={trelloLoading} className="px-4 py-2 bg-indigo-500 hover:bg-indigo-600 text-white rounded-xl transition-all disabled:opacity-50 flex items-center space-x-2 text-[10px] font-black uppercase tracking-widest">
              {trelloLoading ? <Activity className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
              <span>Push all to Trello</span>
            </button>
          </div>
        </div>

        {trelloError && (
          <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-2xl mb-4">
            <p className="text-xs text-red-400 font-bold">{trelloError}</p>
            <p className="text-[10px] text-red-400/60 mt-1">Set TRELLO_API_KEY, TRELLO_API_TOKEN, TRELLO_BOARD_ID in System Config.</p>
          </div>
        )}

        {trelloStats && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            <div className="p-3 bg-white/5 rounded-2xl border border-white/10 text-center">
              <p className="text-lg font-black text-white">{trelloStats.total}</p>
              <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">Total</p>
            </div>
            <div className="p-3 bg-amber-500/10 rounded-2xl border border-amber-500/20 text-center">
              <p className="text-lg font-black text-amber-400">{trelloStats.pending}</p>
              <p className="text-[9px] font-black uppercase tracking-widest text-amber-400/60">Pending</p>
            </div>
            <div className="p-3 bg-emerald-500/10 rounded-2xl border border-emerald-500/20 text-center">
              <p className="text-lg font-black text-emerald-400">{trelloStats.accepted}</p>
              <p className="text-[9px] font-black uppercase tracking-widest text-emerald-400/60">Accepted</p>
            </div>
            <div className="p-3 bg-red-500/10 rounded-2xl border border-red-500/20 text-center">
              <p className="text-lg font-black text-red-400">{trelloStats.failed}</p>
              <p className="text-[9px] font-black uppercase tracking-widest text-red-400/60">Failed</p>
            </div>
          </div>
        )}

        {trelloCards.length > 0 && (
          <div className="glass rounded-3xl border border-white/10 overflow-hidden shadow-2xl">
            <table className="w-full text-left">
              <thead>
                <tr className="bg-white/5 text-[10px] font-black uppercase tracking-widest text-muted-foreground">
                  <th className="px-6 py-4">Status</th>
                  <th className="px-6 py-4">Applicant</th>
                  <th className="px-6 py-4">List</th>
                  <th className="px-6 py-4">Labels</th>
                  <th className="px-6 py-4">Last Activity</th>
                  <th className="px-6 py-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {trelloCards.map((card: any) => (
                  <tr key={card.id} className="group hover:bg-white/[0.02] transition-colors">
                    <td className="px-6 py-4">
                      <span className={`text-[10px] font-black uppercase tracking-widest px-2 py-1 rounded-full border ${
                        card.status === 'ACCEPTED' ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20' :
                        card.status === 'FAILED' ? 'text-red-400 bg-red-500/10 border-red-500/20' :
                        card.status === 'PENDING' ? 'text-amber-400 bg-amber-500/10 border-amber-500/20' :
                        'text-white/40 bg-white/5 border-white/10'
                      }`}>{card.status}</span>
                    </td>
                    <td className="px-6 py-4">
                      <p className="text-sm text-white font-bold truncate max-w-[200px]">{card.name}</p>
                      {card.desc && <p className="text-[10px] text-white/30 truncate max-w-[200px]">{card.desc.substring(0, 60)}</p>}
                    </td>
                    <td className="px-6 py-4">
                      <span className="text-xs text-blue-300 font-medium">{card.list}</span>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex flex-wrap gap-1">
                        {card.labels.map((l: any) => (
                          <span key={l.id} className={`text-[8px] font-black uppercase px-1.5 py-0.5 rounded border ${
                            l.color === 'green' ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' :
                            l.color === 'red' ? 'bg-red-500/20 text-red-400 border-red-500/30' :
                            l.color === 'yellow' ? 'bg-amber-500/20 text-amber-400 border-amber-500/30' :
                            l.color === 'blue' ? 'bg-blue-500/20 text-blue-400 border-blue-500/30' :
                            l.color === 'purple' ? 'bg-purple-500/20 text-purple-400 border-purple-500/30' :
                            'bg-white/10 text-white/50 border-white/20'
                          }`}>{l.name || l.color}</span>
                        ))}
                        {card.labels.length === 0 && <span className="text-[9px] text-white/20 italic">none</span>}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <p className="text-xs text-white/50">{new Date(card.dateLastActivity).toLocaleDateString()}</p>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex items-center justify-end space-x-2">
                        {trelloLists.length > 0 && (
                          <select
                            defaultValue={card.listId}
                            onChange={(e: React.ChangeEvent<HTMLSelectElement>) => { if (e.target.value !== card.listId) moveCard(card.id, e.target.value, card.name) }}
                            disabled={savingTrello}
                            className="bg-black/50 border border-white/10 text-white text-[10px] rounded-lg px-2 py-1 outline-none"
                          >
                            {trelloLists.map((list: any) => (
                              <option key={list.id} value={list.id}>{list.name}</option>
                            ))}
                          </select>
                        )}
                        <a href={card.url} target="_blank" rel="noopener noreferrer" className="p-1.5 bg-white/5 hover:bg-white/10 rounded-lg transition-all border border-white/10">
                          <ExternalLink className="h-3.5 w-3.5 text-white/50" />
                        </a>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {!trelloLoading && trelloCards.length === 0 && !trelloError && (
          <div className="text-center py-12 text-muted-foreground">
            <Layers className="h-10 w-10 mx-auto mb-3 text-white/10" />
            <p className="text-xs font-bold uppercase tracking-widest">Click &quot;Sync Trello&quot; to load board data</p>
          </div>
        )}
      </div>
    </div>
  )
}

function GradingForm({ response, onSubmit, onCancel, isSaving }: any) {
  // Try to pre-fill Discord User ID
  const discordKey = Object.keys(response.answers).find(k => k.toLowerCase().includes('discord') && !k.toLowerCase().includes('username'));
  const initialDiscordId = response.answers[discordKey || ''] || '';
  
  // Try to find a name
  const nameKey = Object.keys(response.answers).find(k => k.toLowerCase().includes('name') || k.toLowerCase().includes('nick'));
  const initialUsername = response.answers[nameKey || ''] || '';

  const [formData, setFormData] = useState({
    discordUserId: initialDiscordId,
    username: initialUsername,
    score: '',
    feedback: ''
  })

  const numericScore = parseInt(formData.score) || 0
  const isPassed = numericScore >= APPLICATION_PASS_SCORE

  return (
    <div className="grid gap-6">
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <label className="text-[10px] font-black text-white/40 uppercase tracking-widest">Discord User ID</label>
          <input 
            type="text" 
            value={formData.discordUserId}
            onChange={(e) => setFormData(prev => ({ ...prev, discordUserId: e.target.value }))}
            placeholder="e.g. 1234567890"
            className="w-full bg-white/5 border border-white/10 rounded-2xl px-4 py-3 text-sm text-white focus:border-indigo-500 transition-all outline-none"
          />
        </div>
        <div className="space-y-2">
          <label className="text-[10px] font-black text-white/40 uppercase tracking-widest">Username</label>
          <input 
            type="text" 
            value={formData.username}
            onChange={(e) => setFormData(prev => ({ ...prev, username: e.target.value }))}
            placeholder="e.g. michal"
            className="w-full bg-white/5 border border-white/10 rounded-2xl px-4 py-3 text-sm text-white focus:border-indigo-500 transition-all outline-none"
          />
        </div>
      </div>

      <div className="space-y-2">
        <label className="text-[10px] font-black text-white/40 uppercase tracking-widest">Score (out of {APPLICATION_MAX_SCORE})</label>
        <div className="relative">
          <input 
            type="number" 
            value={formData.score}
            onChange={(e) => setFormData(prev => ({ ...prev, score: e.target.value }))}
            placeholder={String(APPLICATION_PASS_SCORE)}
            className={`w-full bg-white/5 border ${formData.score ? (isPassed ? 'border-emerald-500/50' : 'border-red-500/50') : 'border-white/10'} rounded-2xl px-4 py-3 text-sm text-white focus:border-indigo-500 transition-all outline-none`}
          />
          {formData.score && (
            <div className={`absolute right-4 top-1/2 -translate-y-1/2 px-2 py-0.5 rounded text-[8px] font-black uppercase tracking-widest ${isPassed ? 'bg-emerald-500 text-white' : 'bg-red-500 text-white'}`}>
              {isPassed ? 'Pass' : 'Fail'}
            </div>
          )}
        </div>
      </div>

      <div className="space-y-2">
        <label className="text-[10px] font-black text-white/40 uppercase tracking-widest">Overall Feedback</label>
        <textarea 
          value={formData.feedback}
          onChange={(e) => setFormData(prev => ({ ...prev, feedback: e.target.value }))}
          placeholder="Great application! You demonstrated excellent knowledge of..."
          rows={4}
          className="w-full bg-white/5 border border-white/10 rounded-2xl px-4 py-3 text-sm text-white focus:border-indigo-500 transition-all outline-none resize-none"
        />
      </div>

      <div className="flex items-center space-x-3 pt-4">
        <button 
          onClick={() =>
            onSubmit({
              ...formData,
              responseId: response.responseId ?? '',
            })
          }
          disabled={isSaving || !formData.discordUserId || !formData.score}
          className="flex-1 py-4 bg-indigo-500 hover:bg-indigo-600 text-white rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all shadow-lg shadow-indigo-500/20 disabled:opacity-50 flex items-center justify-center space-x-2"
        >
          {isSaving ? <Activity className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          <span>Release Grading & Notify</span>
        </button>
        <button 
          onClick={onCancel}
          className="px-8 py-4 bg-white/5 hover:bg-white/10 text-white/50 hover:text-white rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}

function ChatTabComponent({ session, messages, loading, chatEndRef, setMessages, toastError }: any) {
  const [newMessage, setNewMessage] = useState('')
  const [isSending, setIsSending] = useState(false)

  const sendChatMessage = async (e?: React.FormEvent) => {
    if (e) e.preventDefault()
    if (!newMessage.trim() || isSending) return

    const msgContent = newMessage.trim()
    setNewMessage('')
    
    // Optimistic Update
    const optimisticMsg = {
      id: 'temp-' + Date.now(),
      userId: (session?.user as any).id,
      username: session?.user?.name || 'You',
      avatar: session?.user?.image || null,
      content: msgContent,
      role: (session?.user as any).role || 'MODERATOR',
      createdAt: new Date().toISOString(),
      optimistic: true
    }
    setMessages((prev: any) => [...prev, optimisticMsg])

    setIsSending(true)
    try {
      const res = await fetch('/api/admin/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: msgContent })
      })
      if (!res.ok) {
        setMessages((prev: any) => prev.filter((m: any) => m.id !== optimisticMsg.id))
        setNewMessage(msgContent)
        toastError('Chat Error', 'Failed to transmit directive.')
        return
      }
      const data = await res.json()
      if (data?.message) {
        setMessages((prev: any) => prev.map((m: any) => m.id === optimisticMsg.id ? data.message : m))
      }
    } finally {
      setIsSending(false)
    }
  }

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-white/5 pb-6">
        <div className="flex items-center space-x-3">
          <div className="p-3 bg-indigo-500/20 rounded-2xl border border-indigo-500/30">
            <MessageSquare className="h-6 w-6 text-indigo-400" />
          </div>
          <div>
            <h3 className="text-xl font-black text-white uppercase tracking-widest text-shadow-glow flex items-center">
              Admin Command Center
              <span className="ml-3 flex items-center space-x-1.5 text-[8px] text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full border border-emerald-500/20 animate-pulse font-black uppercase tracking-widest">
                <span className="w-1 h-1 rounded-full bg-emerald-500"></span>
                <span>Live Secure Channel</span>
              </span>
            </h3>
            <p className="text-[10px] text-muted-foreground font-black uppercase tracking-widest">Real-time collaboration for moderators & admins</p>
          </div>
        </div>
      </div>

      <div className="glass rounded-[2rem] border border-white/10 overflow-hidden flex flex-col h-[600px] relative">
        <div className="flex-1 overflow-y-auto p-6 space-y-4 custom-scrollbar">
          {loading && messages.length === 0 ? (
            <div className="h-full flex items-center justify-center flex-col space-y-4">
              <Activity className="h-8 w-8 text-indigo-500 animate-spin" />
              <p className="text-xs font-bold text-muted-foreground uppercase tracking-widest">Syncing encrypted data...</p>
            </div>
          ) : messages.length === 0 ? (
            <div className="h-full flex items-center justify-center flex-col space-y-4">
              <MessageSquare className="h-12 w-12 text-white/5" />
              <p className="text-xs font-bold text-muted-foreground uppercase tracking-widest italic">No messages in command center yet.</p>
            </div>
          ) : (
            messages.filter(Boolean).map((msg: any) => (
              <div key={msg.id} className={`flex items-start space-x-3 ${msg.userId === (session?.user as any).id ? 'flex-row-reverse space-x-reverse' : ''}`}>
                <div className="flex-shrink-0">
                   <img src={getDiscordCdnAvatarUrl(msg.user?.discordId, msg.user?.avatar || msg.avatar, 64) || '/favicon.ico'} className="h-8 w-8 rounded-xl border border-white/10 shadow-lg" alt="" onError={(e: any) => { e.target.src = '/favicon.ico' }} />
                </div>
                <div className={`max-w-[70%] space-y-1 ${msg.userId === (session?.user as any).id ? 'items-end' : ''}`}>
                  <div className="flex items-center space-x-2">
                    <span className="text-[10px] font-black text-white/70 uppercase tracking-tighter">{msg?.username ?? "Unknown"}</span>
                    <span className={`text-[8px] font-black px-1.5 py-0.5 rounded uppercase ${
                      (msg.role === 'ADMIN' || msg.role === 'OWNER') ? 'bg-red-500/20 text-red-400 border border-red-500/30' : 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                    }`}>{msg.role}</span>
                    <span className="text-[8px] text-white/20 font-mono italic">{new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                  </div>
                  <div className={`p-3 rounded-2xl text-sm leading-relaxed ${
                    msg.userId === (session?.user as any).id 
                      ? 'bg-indigo-500 text-white shadow-xl shadow-indigo-500/20 rounded-tr-none border border-indigo-400/30' 
                      : 'bg-white/5 text-white/90 border border-white/10 rounded-tl-none'
                  } ${msg.optimistic ? 'opacity-50 border-dashed' : ''}`}>
                    {msg.content}
                  </div>
                </div>
              </div>
            ))
          )}
          <div ref={chatEndRef} />
        </div>
        
        <form onSubmit={sendChatMessage} className="p-4 bg-black/40 border-t border-white/10 backdrop-blur-md">
          <div className="flex items-center space-x-2 bg-white/5 border border-white/10 rounded-2xl p-1.5 focus-within:border-indigo-500/50 transition-all">
            <input 
              type="text"
              value={newMessage}
              onChange={(e) => setNewMessage(e.target.value)}
              placeholder="Type an administrative directive..."
              className="flex-1 bg-transparent border-none outline-none text-white px-4 py-2 text-sm"
              disabled={isSending}
            />
            <button 
              type="submit"
              disabled={!newMessage.trim() || isSending}
              className="p-2.5 bg-indigo-500 hover:bg-indigo-600 disabled:opacity-30 disabled:hover:bg-indigo-500 text-white rounded-xl shadow-lg shadow-indigo-500/20 transition-all active:scale-95"
            >
              {isSending ? <Activity className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
