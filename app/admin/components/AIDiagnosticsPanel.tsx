'use client'

import { useState } from 'react'
import {
  Sparkles,
  Activity,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  RefreshCw,
  Cpu,
  ShieldCheck,
  Server,
  Zap,
  ArrowRight,
  FileText,
} from 'lucide-react'

interface Finding {
  category: string
  severity: 'critical' | 'warning' | 'info'
  title: string
  description: string
  recommendation: string
  quickFixKey?: string
}

interface DiagnosticReport {
  healthScore: number
  overallStatus: 'OPERATIONAL' | 'DEGRADED' | 'CRITICAL'
  summary: string
  findings: Finding[]
  rawMarkdown?: string
  provider?: string
  model?: string
  analyzedAt?: string
}

interface AIDiagnosticsPanelProps {
  onNavigateTab?: (tab: string) => void
}

export function AIDiagnosticsPanel({ onNavigateTab }: AIDiagnosticsPanelProps) {
  const [analyzing, setAnalyzing] = useState(false)
  const [report, setReport] = useState<DiagnosticReport | null>(null)
  const [activeTab, setActiveTab] = useState<'findings' | 'raw'>('findings')

  const runDiagnosticScan = async () => {
    setAnalyzing(true)
    try {
      const res = await fetch('/api/admin/diagnostics/ai-analyze', {
        method: 'POST',
      })
      if (res.ok) {
        const data = await res.json()
        setReport(data)
      }
    } catch (err) {
      console.error('Failed to run AI Diagnostic scan:', err)
    } finally {
      setAnalyzing(false)
    }
  }

  const scoreColor =
    (report?.healthScore || 0) >= 90
      ? 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10'
      : (report?.healthScore || 0) >= 70
      ? 'text-amber-400 border-amber-500/30 bg-amber-500/10'
      : 'text-red-400 border-red-500/30 bg-red-500/10'

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500 w-full pb-8">
      {/* Header Banner */}
      <div className="glass rounded-[2rem] p-6 border border-white/10 relative overflow-hidden bg-gradient-to-br from-indigo-950/40 via-zinc-900/60 to-purple-950/30">
        <div className="absolute top-0 right-0 w-96 h-96 bg-purple-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6 relative z-10">
          <div className="flex items-center gap-4">
            <div className="p-3.5 bg-indigo-500/20 rounded-2xl border border-indigo-500/30 shadow-lg shadow-indigo-500/10">
              <Cpu className="h-8 w-8 text-indigo-400 animate-pulse" />
            </div>
            <div>
              <div className="flex items-center gap-2.5">
                <h2 className="text-3xl font-black text-white tracking-tighter uppercase">
                  AI System Diagnostics
                </h2>
                <span className="px-3 py-1 rounded-full text-[9px] font-black uppercase tracking-widest bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 flex items-center gap-1">
                  <Sparkles className="h-3 w-3 text-indigo-400" />
                  <span>LLM Telemetry Engine</span>
                </span>
              </div>
              <p className="text-muted-foreground text-xs font-medium mt-0.5">
                Automated root-cause analysis, system health scoring, and AI recommendations.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={runDiagnosticScan}
            disabled={analyzing}
            className="px-6 py-3.5 bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700 text-white font-black text-xs uppercase tracking-widest rounded-2xl border border-indigo-400/30 transition-all shadow-lg shadow-indigo-500/20 active:scale-95 disabled:opacity-50 flex items-center gap-2.5 shrink-0"
          >
            <Sparkles className={`h-4 w-4 ${analyzing ? 'animate-spin' : ''}`} />
            <span>{analyzing ? 'Analyzing Telemetry...' : 'Run AI Infrastructure Audit'}</span>
          </button>
        </div>
      </div>

      {/* Initial Prompt State */}
      {!report && !analyzing && (
        <div className="glass rounded-[2rem] p-12 border border-white/5 text-center space-y-4">
          <Cpu className="h-12 w-12 mx-auto text-indigo-400/40 animate-pulse" />
          <div className="max-w-md mx-auto space-y-2">
            <h3 className="text-lg font-black text-white uppercase tracking-wider">
              Ready to Scan Infrastructure
            </h3>
            <p className="text-xs text-muted-foreground">
              Click <strong className="text-indigo-300">Run AI Infrastructure Audit</strong> above to execute an automated health inspection across database connections, storage volumes, Discord bot services, and traffic error logs using our local LLM.
            </p>
          </div>
          <button
            type="button"
            onClick={runDiagnosticScan}
            className="px-5 py-2.5 bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 rounded-xl text-xs font-bold transition-all inline-flex items-center gap-2"
          >
            <Sparkles className="h-4 w-4 text-indigo-400" />
            <span>Start Scan</span>
          </button>
        </div>
      )}

      {/* Loading Scan State */}
      {analyzing && (
        <div className="glass rounded-[2rem] p-12 border border-white/5 text-center space-y-4 animate-in fade-in">
          <RefreshCw className="h-10 w-10 mx-auto text-indigo-400 animate-spin" />
          <div className="space-y-1">
            <h3 className="text-base font-black text-white uppercase tracking-widest">
              Evaluating System Telemetry
            </h3>
            <p className="text-xs text-muted-foreground">
              Fetching node status, error traces, and database health metrics for LLM synthesis...
            </p>
          </div>
        </div>
      )}

      {/* Report Output View */}
      {report && !analyzing && (
        <div className="space-y-6 animate-in fade-in">
          {/* Top Score Matrix */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* Score Card */}
            <div className="glass rounded-[2rem] p-6 border border-white/5 flex items-center gap-5">
              <div
                className={`w-20 h-20 rounded-2xl border flex items-center justify-center font-black text-3xl font-mono shrink-0 ${scoreColor}`}
              >
                {report.healthScore}
              </div>
              <div>
                <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
                  AI Health Index
                </p>
                <h4 className="text-xl font-black text-white tracking-tight uppercase mt-0.5">
                  {report.overallStatus}
                </h4>
                <p className="text-[10px] text-white/50 font-mono mt-1">
                  Provider: {report.provider || 'Local LLM'} ({report.model || 'llama3'})
                </p>
              </div>
            </div>

            {/* Summary Card */}
            <div className="md:col-span-2 glass rounded-[2rem] p-6 border border-white/5 flex flex-col justify-between">
              <div>
                <p className="text-[10px] font-black uppercase tracking-widest text-indigo-400 mb-2">
                  Executive AI Summary
                </p>
                <p className="text-xs text-white/90 leading-relaxed font-medium">
                  {report.summary}
                </p>
              </div>
              <div className="text-[9px] font-mono text-muted-foreground mt-4">
                Analyzed at: {report.analyzedAt ? new Date(report.analyzedAt).toLocaleString() : 'Just now'}
              </div>
            </div>
          </div>

          {/* Navigation Bar */}
          <div className="flex items-center justify-between border-b border-white/5 pb-4">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setActiveTab('findings')}
                className={`px-4 py-2 rounded-xl text-xs font-black uppercase tracking-wider transition-all ${
                  activeTab === 'findings'
                    ? 'bg-indigo-500 text-white shadow-md shadow-indigo-500/20'
                    : 'text-muted-foreground hover:text-white hover:bg-white/5'
                }`}
              >
                Actionable Findings ({report.findings?.length || 0})
              </button>
              {report.rawMarkdown && (
                <button
                  type="button"
                  onClick={() => setActiveTab('raw')}
                  className={`px-4 py-2 rounded-xl text-xs font-black uppercase tracking-wider transition-all ${
                    activeTab === 'raw'
                      ? 'bg-indigo-500 text-white shadow-md shadow-indigo-500/20'
                      : 'text-muted-foreground hover:text-white hover:bg-white/5'
                  }`}
                >
                  Raw LLM Markdown
                </button>
              )}
            </div>
          </div>

          {/* Findings List */}
          {activeTab === 'findings' && (
            <div className="space-y-4">
              {report.findings && report.findings.length > 0 ? (
                report.findings.map((f, i) => {
                  const badgeColor =
                    f.severity === 'critical'
                      ? 'bg-red-500/20 text-red-300 border-red-500/30'
                      : f.severity === 'warning'
                      ? 'bg-amber-500/20 text-amber-300 border-amber-500/30'
                      : 'bg-blue-500/20 text-blue-300 border-blue-500/30'

                  return (
                    <div
                      key={i}
                      className="glass rounded-2xl p-6 border border-white/5 space-y-3 hover:border-white/10 transition-all"
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <span
                              className={`px-2.5 py-0.5 rounded-full text-[9px] font-black uppercase border tracking-wider ${badgeColor}`}
                            >
                              {f.severity}
                            </span>
                            <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
                              {f.category}
                            </span>
                          </div>
                          <h4 className="text-base font-black text-white tracking-tight">{f.title}</h4>
                        </div>
                      </div>

                      <p className="text-xs text-muted-foreground leading-relaxed">{f.description}</p>

                      <div className="p-3 bg-white/[0.03] border border-white/5 rounded-xl space-y-1">
                        <p className="text-[10px] font-black uppercase text-indigo-300 tracking-wider">
                          AI Recommendation
                        </p>
                        <p className="text-xs text-white/90">{f.recommendation}</p>
                      </div>
                    </div>
                  )
                })
              ) : (
                <div className="glass rounded-2xl p-12 text-center text-muted-foreground space-y-2">
                  <CheckCircle2 className="h-8 w-8 mx-auto text-emerald-400" />
                  <p className="text-sm font-bold text-white uppercase tracking-wider">
                    No System Issues Detected
                  </p>
                  <p className="text-xs">All monitored subsystems passed LLM diagnostic checks.</p>
                </div>
              )}
            </div>
          )}

          {/* Raw LLM Markdown Output */}
          {activeTab === 'raw' && report.rawMarkdown && (
            <div className="glass rounded-[2rem] p-8 border border-white/5 font-mono text-xs text-white/80 leading-relaxed whitespace-pre-wrap">
              {report.rawMarkdown}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
