'use client';
import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { Shield, Server, Bot, Cloud, CheckCircle, AlertCircle, ChevronDown, ChevronUp, Clock, HelpCircle, Loader2, Plus, Trash2, Edit3, X, Check } from 'lucide-react';

interface IncidentEvent {
  title: string;
  time: string;
  type: 'investigating' | 'identified' | 'monitoring' | 'resolved' | 'completed';
  message: string;
}

interface Incident {
  id: string;
  title: string;
  date: string;
  severity: 'minor' | 'major' | 'maintenance' | 'resolved';
  updates: IncidentEvent[];
}

export default function IncidentsPage() {
  const { data: session } = useSession();
  const user = session?.user as any;
  const isAdmin = user && (user.role === 'ADMIN' || user.role === 'OWNER');

  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [expandedIncident, setExpandedIncident] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [systemStatus, setSystemStatus] = useState<Record<string, string>>({
    website: 'operational',
    ryuu: 'operational',
    morrenus: 'operational',
    s3: 'operational',
    firewall: 'operational',
    bot: 'operational',
  });
  const [latency, setLatency] = useState<Record<string, number>>({
    website: 0,
    ryuu: 0,
    morrenus: 0,
  });
  const [activeIncidentSeverity, setActiveIncidentSeverity] = useState<'major' | 'minor' | 'maintenance' | null>(null);
  const [uptimePercent, setUptimePercent] = useState<number>(100);
  const [dailyHistory, setDailyHistory] = useState<string[]>(new Array(90).fill('operational'));

  // Admin Panels state
  const [showCreatePanel, setShowCreatePanel] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newSeverity, setNewSeverity] = useState('minor');
  const [newUpdateTitle, setNewUpdateTitle] = useState('Investigating Issue');
  const [newUpdateType, setNewUpdateType] = useState('investigating');
  const [newUpdateMessage, setNewUpdateMessage] = useState('');
  const [creating, setCreating] = useState(false);

  // Admin Inline update state
  const [inlineUpdateIncidentId, setInlineUpdateIncidentId] = useState<string | null>(null);
  const [inlineTitle, setInlineTitle] = useState('Status Update');
  const [inlineType, setInlineType] = useState('monitoring');
  const [inlineMessage, setInlineMessage] = useState('');
  const [inlineSeverity, setInlineSeverity] = useState('');
  const [updating, setUpdating] = useState(false);

  // Fetch both system components status & incident records
  const fetchData = async () => {
    try {
      // 1. Fetch live system component statuses
      const statusRes = await fetch('/api/incidents/status');
      const statusData = await statusRes.json();
      if (statusData.success && statusData.statuses) {
        setSystemStatus(statusData.statuses);
        if (statusData.latency) setLatency(statusData.latency);
        if (typeof statusData.uptimePercent === 'number') setUptimePercent(statusData.uptimePercent);
        if (Array.isArray(statusData.dailyHistory)) setDailyHistory(statusData.dailyHistory);
      }

      // 2. Fetch dynamic incidents list
      const incidentsRes = await fetch('/api/incidents');
      const incidentsData = await incidentsRes.json();
      if (incidentsData.success && incidentsData.incidents) {
        setIncidents(incidentsData.incidents);
        // Determine the worst active (non-resolved) incident severity
        const active = incidentsData.incidents.filter((inc: Incident) => inc.severity !== 'resolved');
        if (active.some((inc: Incident) => inc.severity === 'major')) {
          setActiveIncidentSeverity('major');
        } else if (active.some((inc: Incident) => inc.severity === 'minor' || inc.severity === 'maintenance')) {
          setActiveIncidentSeverity(active.find((inc: Incident) => inc.severity === 'minor') ? 'minor' : 'maintenance');
        } else {
          setActiveIncidentSeverity(null);
        }
      }
    } catch (e) {
      console.error('Failed to pull system status and logs:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    // Poll every 45 seconds
    const interval = setInterval(fetchData, 45000);
    return () => clearInterval(interval);
  }, []);

  // Recalculate the worst active severity from a given incident list
  const recalculateActiveSeverity = (list: Incident[]) => {
    const active = list.filter(inc => inc.severity !== 'resolved');
    if (active.some(inc => inc.severity === 'major')) {
      setActiveIncidentSeverity('major');
    } else if (active.some(inc => inc.severity === 'minor' || inc.severity === 'maintenance')) {
      setActiveIncidentSeverity(active.find(inc => inc.severity === 'minor') ? 'minor' : 'maintenance');
    } else {
      setActiveIncidentSeverity(null);
    }
  };

  // Create Incident Callback
  const handleCreateIncident = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim() || !newUpdateMessage.trim()) return;

    setCreating(true);
    try {
      const res = await fetch('/api/incidents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'CREATE',
          title: newTitle,
          severity: newSeverity,
          updateTitle: newUpdateTitle,
          updateType: newUpdateType,
          updateMessage: newUpdateMessage
        })
      });
      const data = await res.json();
      if (data.success && data.incident) {
        const updated = [data.incident, ...incidents];
        setIncidents(updated);
        recalculateActiveSeverity(updated);
        // Reset state
        setNewTitle('');
        setNewUpdateMessage('');
        setNewSeverity('minor');
        setNewUpdateTitle('Investigating Issue');
        setNewUpdateType('investigating');
        setShowCreatePanel(false);
      } else {
        alert(data.error || 'Failed to open incident');
      }
    } catch (err: any) {
      alert('Error: ' + err.message);
    } finally {
      setCreating(false);
    }
  };

  // Add Inline Incident Update Callback
  const handleAddInlineUpdate = async (e: React.FormEvent, incidentId: string) => {
    e.preventDefault();
    if (!inlineMessage.trim()) return;

    setUpdating(true);
    try {
      const res = await fetch('/api/incidents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'ADD_UPDATE',
          incidentId,
          updateTitle: inlineTitle,
          updateType: inlineType,
          updateMessage: inlineMessage,
          severity: inlineSeverity || undefined
        })
      });
      const data = await res.json();
      if (data.success && data.incident) {
        // Replace updated incident in feed
        const updated = incidents.map((inc) => inc.id === incidentId ? data.incident : inc);
        setIncidents(updated);
        recalculateActiveSeverity(updated);
        // Reset state
        setInlineMessage('');
        setInlineTitle('Status Update');
        setInlineType('monitoring');
        setInlineSeverity('');
        setInlineUpdateIncidentId(null);
      } else {
        alert(data.error || 'Failed to append update');
      }
    } catch (err: any) {
      alert('Error: ' + err.message);
    } finally {
      setUpdating(false);
    }
  };

  // Delete Incident Callback
  const handleDeleteIncident = async (incidentId: string) => {
    if (!confirm('Are you sure you want to permanently delete this incident record?')) return;

    try {
      const res = await fetch('/api/incidents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'DELETE', incidentId })
      });
      const data = await res.json();
      if (data.success) {
        const updated = incidents.filter((inc) => inc.id !== incidentId);
        setIncidents(updated);
        recalculateActiveSeverity(updated);
      } else {
        alert(data.error || 'Failed to delete incident');
      }
    } catch (err: any) {
      alert('Error: ' + err.message);
    }
  };

  // Map backend key to components
  const components = [
    { key: 'website', name: 'Website & User Dashboard', desc: 'Main user interface and account management.', icon: Server },
    { key: 'ryuu', name: 'Ryuu Manifest Generator', desc: 'Core manifest generator service API.', icon: Cloud },
    { key: 'morrenus', name: 'Morrenus Fallback API', desc: 'Secondary generation gateway API.', icon: Cloud },
    { key: 's3', name: 'AWS S3 Cloud Storage', desc: 'Secure repository for manifest ZIPs.', icon: Server },
    { key: 'firewall', name: 'Sentinel Firewall & Rate-Limiter', desc: 'Real-time security and anti-abuse layers.', icon: Shield },
    { key: 'bot', name: 'Discord Integration Bot', desc: 'Interactive guild daemon and /gen handler.', icon: Bot },
  ];

  // Helper to get color/labels for each status
  const getStatusConfig = (status: string) => {
    switch (status) {
      case 'degraded':
        return {
          label: 'degraded',
          dotClass: 'bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.4)]',
          textClass: 'text-amber-400',
        };
      case 'major_outage':
        return {
          label: 'down',
          dotClass: 'bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.4)] animate-pulse',
          textClass: 'text-rose-400',
        };
      default:
        return {
          label: 'Operational',
          dotClass: 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.4)]',
          textClass: 'text-emerald-400',
        };
    }
  };

  // Determine overall status — active manual incidents override live pings
  const hasOutage = Object.values(systemStatus).some(s => s === 'major_outage') || activeIncidentSeverity === 'major';
  const hasDegradation = Object.values(systemStatus).some(s => s === 'degraded') || activeIncidentSeverity === 'minor' || activeIncidentSeverity === 'maintenance';
  
  const overallConfig = hasOutage 
    ? {
        label: 'down',
        desc: 'Some components are experiencing outage issues. Staff is actively on it.',
        colorClass: 'bg-rose-950/20 border-rose-500/20 shadow-[0_0_50px_rgba(244,63,94,0.02)]',
        dotClass: 'bg-rose-500',
        pingClass: 'bg-rose-400',
        textClass: 'text-rose-400'
      }
    : hasDegradation
    ? {
        label: 'degraded',
        desc: 'Core services are functional but experiencing minor latency or degradation.',
        colorClass: 'bg-amber-950/20 border-amber-500/20 shadow-[0_0_50px_rgba(245,158,11,0.02)]',
        dotClass: 'bg-amber-500',
        pingClass: 'bg-amber-400',
        textClass: 'text-amber-400'
      }
    : {
        label: 'Operational',
        desc: 'Verified by OpenSteam Sentinel monitoring agents',
        colorClass: 'bg-emerald-950/20 border-emerald-500/20 shadow-[0_0_50px_rgba(16,185,129,0.02)]',
        dotClass: 'bg-emerald-500',
        pingClass: 'bg-emerald-400',
        textClass: 'text-emerald-400'
      };

  return (
    <div className="min-h-screen bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-slate-950 via-[#09090b] to-black text-gray-200 font-sans antialiased selection:bg-indigo-500/30 selection:text-white pb-16">
      {/* Header Grid */}
      <header className="max-w-4xl mx-auto pt-16 px-4 pb-8 border-b border-white/5 flex flex-col md:flex-row md:items-center md:justify-between gap-6">
        <div className="space-y-2">
          <div className="flex items-center space-x-3">
            <span className="bg-indigo-500/10 border border-indigo-500/20 px-3 py-1 rounded-full text-xs font-semibold tracking-wider text-indigo-400 uppercase">
              OpenSteam Status
            </span>
            {loading && (
              <span className="flex items-center gap-1 text-[10px] text-gray-500 font-semibold uppercase tracking-wider">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                syncing live logs...
              </span>
            )}
          </div>
          <h1 className="text-3xl font-extrabold text-white tracking-tight">System Incidents & Status</h1>
          <p className="text-sm text-gray-400">
            Real-time status updates and historical incident logs for the OpenSteam network.
          </p>
        </div>

        <div className="flex gap-2 self-start md:self-auto">
          {isAdmin && (
            <button
              onClick={() => setShowCreatePanel(!showCreatePanel)}
              className="bg-indigo-600 hover:bg-indigo-500 text-white font-semibold py-2 px-4 rounded-xl border border-indigo-500/20 transition-all text-sm flex items-center gap-2 shadow-lg shadow-indigo-950/40"
            >
              <Plus className="w-4 h-4" />
              Create Incident
            </button>
          )}
          <a 
            href="/" 
            className="bg-white/5 hover:bg-white/10 text-white font-medium py-2 px-4 rounded-xl border border-white/10 transition-all text-sm flex items-center gap-2"
          >
            Return to Dashboard
          </a>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 mt-10 space-y-8 animate-in fade-in slide-in-from-bottom-5 duration-500">
        
        {/* Dynamic Overall Systems Indicator */}
        <div className={`border rounded-2xl p-6 flex items-center justify-between transition-all ${overallConfig.colorClass}`}>
          <div className="flex items-center gap-4">
            <div className="relative flex h-5 w-5">
              <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-40 ${overallConfig.pingClass}`}></span>
              <span className={`relative inline-flex rounded-full h-5 w-5 shadow-md ${overallConfig.dotClass}`}></span>
            </div>
            <div>
              <h2 className="text-lg font-bold text-white leading-tight uppercase tracking-wider">{overallConfig.label}</h2>
              <p className={`text-xs mt-0.5 font-medium ${overallConfig.textClass}`}>{overallConfig.desc}</p>
            </div>
          </div>
          
          <div className="hidden sm:block text-xs font-semibold text-emerald-400/80 bg-emerald-500/10 border border-emerald-500/20 px-2.5 py-1 rounded-md">
            Uptime: 99.98%
          </div>
        </div>

        {/* Dynamic Admin Creation Panel */}
        {isAdmin && showCreatePanel && (
          <form onSubmit={handleCreateIncident} className="bg-[#101014]/90 border border-indigo-500/20 rounded-2xl p-6 space-y-4 shadow-[0_0_50px_rgba(99,102,241,0.05)] animate-in slide-in-from-top-4 duration-300">
            <div className="flex justify-between items-center pb-2 border-b border-white/5">
              <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
                <Plus className="w-4 h-4 text-indigo-400" />
                Open New System Incident
              </h3>
              <button type="button" onClick={() => setShowCreatePanel(false)} className="text-gray-500 hover:text-white transition-all">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="grid md:grid-cols-2 gap-4">
              <div className="space-y-1">
                <label className="text-xs font-semibold text-gray-400">Incident Title</label>
                <input
                  type="text"
                  placeholder="e.g. Ryuu API Latency Spike"
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  className="w-full bg-black/50 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-indigo-500 transition-all"
                  required
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-gray-400">Incident Severity</label>
                <select
                  value={newSeverity}
                  onChange={(e) => setNewSeverity(e.target.value)}
                  className="w-full bg-black/50 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-indigo-500 transition-all"
                >
                  <option value="minor">minor</option>
                  <option value="major">major</option>
                  <option value="maintenance">maintenance</option>
                  <option value="resolved">resolved</option>
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-gray-400">Update Title</label>
                <input
                  type="text"
                  placeholder="e.g. Investigating"
                  value={newUpdateTitle}
                  onChange={(e) => setNewUpdateTitle(e.target.value)}
                  className="w-full bg-black/50 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-indigo-500 transition-all"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-gray-400">Update Type</label>
                <select
                  value={newUpdateType}
                  onChange={(e) => setNewUpdateType(e.target.value)}
                  className="w-full bg-black/50 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-indigo-500 transition-all"
                >
                  <option value="investigating">investigating</option>
                  <option value="identified">identified</option>
                  <option value="monitoring">monitoring</option>
                  <option value="resolved">resolved</option>
                  <option value="completed">completed</option>
                </select>
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-xs font-semibold text-gray-400">Description Message</label>
              <textarea
                placeholder="Describe what has happened and the active recovery steps taken..."
                value={newUpdateMessage}
                onChange={(e) => setNewUpdateMessage(e.target.value)}
                rows={3}
                className="w-full bg-black/50 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-indigo-500 transition-all resize-none"
                required
              />
            </div>

            <button
              type="submit"
              disabled={creating}
              className="bg-indigo-600 hover:bg-indigo-500 disabled:bg-indigo-800 text-white font-semibold py-2 px-4 rounded-xl text-xs uppercase tracking-wider transition-all flex items-center gap-2"
            >
              {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
              Publish Incident
            </button>
          </form>
        )}

        {/* Component Health Grid */}
        <div className="bg-[#101014]/60 border border-white/5 rounded-2xl p-6 space-y-6">
          <h3 className="text-sm font-bold text-white uppercase tracking-wider">Active Components</h3>
          
          <div className="grid md:grid-cols-2 gap-4">
            {components.map((c) => {
              const Icon = c.icon;
              const status = systemStatus[c.key] || 'operational';
              const cfg = getStatusConfig(status);
              const ms = latency[c.key];

              return (
                <div key={c.name} className="bg-white/[0.01] hover:bg-white/[0.02] border border-white/5 rounded-xl p-4 flex items-start gap-4 transition-all">
                  <div className="p-2.5 bg-white/5 rounded-lg border border-white/10 text-gray-300">
                    <Icon className="w-5 h-5" />
                  </div>
                  <div className="flex-1 space-y-1">
                    <div className="flex items-center justify-between">
                      <h4 className="text-sm font-semibold text-white">{c.name}</h4>
                      <span className={`flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider ${cfg.textClass}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${cfg.dotClass}`}></span>
                        {cfg.label}
                      </span>
                    </div>
                    <div className="flex justify-between items-center">
                      <p className="text-xs text-gray-400 leading-relaxed">{c.desc}</p>
                      {!!ms && (
                        <span className="text-[10px] bg-white/5 px-1.5 py-0.5 rounded border border-white/5 font-mono text-gray-500">
                          {ms}ms
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>

          {/* 90-Day Visual Uptime Bars */}
          <div className="pt-6 border-t border-white/5 space-y-3">
            <div className="flex justify-between text-xs text-gray-400 font-semibold">
              <span>90 Days Ago</span>
              <span className={`font-bold ${
                uptimePercent >= 99.9 ? 'text-emerald-400' :
                uptimePercent >= 99 ? 'text-amber-400' : 'text-rose-400'
              }`}>{uptimePercent.toFixed(2)}% Uptime</span>
              <span>Today</span>
            </div>

            <div className="flex gap-[2px] sm:gap-[3px]">
              {dailyHistory.map((dayStatus, idx) => {
                const isOutage = dayStatus === 'outage';
                const isDegraded = dayStatus === 'degraded';
                const daysAgo = 89 - idx;
                const date = new Date();
                date.setDate(date.getDate() - daysAgo);
                const label = date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
                const colorClass = isOutage
                  ? 'bg-rose-500/80 hover:bg-rose-400 shadow-[0_0_8px_rgba(244,63,94,0.2)]'
                  : isDegraded
                  ? 'bg-amber-500/80 hover:bg-amber-400 shadow-[0_0_8px_rgba(245,158,11,0.2)]'
                  : 'bg-emerald-500/80 hover:bg-emerald-400 shadow-[0_0_8px_rgba(16,185,129,0.2)]';
                const tooltip = isOutage
                  ? `${label}: Major outage`
                  : isDegraded
                  ? `${label}: Degraded performance`
                  : `${label}: Operational`;
                return (
                  <div
                    key={idx}
                    className={`flex-1 h-7 rounded-sm transition-all cursor-pointer ${colorClass}`}
                    title={tooltip}
                  />
                );
              })}
            </div>
          </div>
        </div>

        {/* Historical Incidents Feed */}
        <div className="space-y-4">
          <h3 className="text-sm font-bold text-white uppercase tracking-wider px-1">Incident History</h3>

          {incidents.length === 0 ? (
            <div className="border border-white/5 rounded-2xl p-8 text-center text-gray-500 text-sm">
              No recent incidents reported. OpenSteam components are healthy.
            </div>
          ) : (
            <div className="space-y-4">
              {incidents.map((incident) => {
                const isExpanded = expandedIncident === incident.id;
                const severityColor = 
                  incident.severity === 'resolved' ? 'border-emerald-500/30 bg-emerald-500/[0.02] text-emerald-400' :
                  incident.severity === 'maintenance' ? 'border-indigo-500/30 bg-indigo-500/[0.02] text-indigo-400' :
                  'border-rose-500/30 bg-rose-500/[0.02] text-rose-400';

                return (
                  <div 
                    key={incident.id} 
                    className={`border rounded-2xl overflow-hidden transition-all bg-[#101014]/40 hover:bg-[#101014]/70 ${isExpanded ? 'border-white/10 ring-1 ring-white/5' : 'border-white/5'}`}
                  >
                    {/* Summary Bar */}
                    <div className="p-5 flex items-center justify-between select-none">
                      <div 
                        onClick={() => setExpandedIncident(isExpanded ? null : incident.id)}
                        className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 flex-1 cursor-pointer"
                      >
                        <span className="text-xs text-gray-500 font-semibold uppercase tracking-wider">{incident.date}</span>
                        <h4 className="text-sm font-bold text-white tracking-wide">{incident.title}</h4>
                      </div>

                      <div className="flex items-center gap-3">
                        <span className={`text-[10px] font-extrabold uppercase tracking-widest px-2.5 py-1 rounded-md border ${severityColor}`}>
                          {incident.severity}
                        </span>
                        
                        {isAdmin && (
                          <div className="flex gap-1.5">
                            <button
                              onClick={() => {
                                setInlineUpdateIncidentId(inlineUpdateIncidentId === incident.id ? null : incident.id);
                                setExpandedIncident(incident.id); // auto-expand to show inline updates
                              }}
                              className="p-1 text-gray-500 hover:text-white border border-white/5 hover:border-white/20 rounded bg-white/5 transition-all"
                              title="Add incident timeline log entry"
                            >
                              <Edit3 className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => handleDeleteIncident(incident.id)}
                              className="p-1 text-gray-500 hover:text-rose-400 border border-white/5 hover:border-rose-500/20 rounded bg-white/5 transition-all"
                              title="Delete Incident"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        )}
                        
                        <div 
                          onClick={() => setExpandedIncident(isExpanded ? null : incident.id)}
                          className="cursor-pointer p-1"
                        >
                          {isExpanded ? <ChevronUp className="w-4 h-4 text-gray-500" /> : <ChevronDown className="w-4 h-4 text-gray-500" />}
                        </div>
                      </div>
                    </div>

                    {/* Expanded Updates list */}
                    {isExpanded && (
                      <div className="border-t border-white/5 bg-black/30 p-5 space-y-6 animate-in slide-in-from-top-2 duration-300">
                        {/* Inline Update Form for Administrators */}
                        {isAdmin && inlineUpdateIncidentId === incident.id && (
                          <form 
                            onSubmit={(e) => handleAddInlineUpdate(e, incident.id)} 
                            className="bg-white/[0.02] border border-white/5 rounded-xl p-4 space-y-4 animate-in slide-in-from-top-2 duration-300"
                          >
                            <div className="flex justify-between items-center pb-1 border-b border-white/5">
                              <h5 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-1.5">
                                <Edit3 className="w-3.5 h-3.5 text-indigo-400" />
                                Add Timeline Log Entry
                              </h5>
                              <button type="button" onClick={() => setInlineUpdateIncidentId(null)} className="text-gray-500 hover:text-white transition-all">
                                <X className="w-3.5 h-3.5" />
                              </button>
                            </div>

                            <div className="grid sm:grid-cols-3 gap-3">
                              <div className="space-y-1">
                                <label className="text-[10px] font-semibold text-gray-400">Log Action Title</label>
                                <input
                                  type="text"
                                  value={inlineTitle}
                                  onChange={(e) => setInlineTitle(e.target.value)}
                                  className="w-full bg-black/50 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-indigo-500 transition-all"
                                  required
                                />
                              </div>

                              <div className="space-y-1">
                                <label className="text-[10px] font-semibold text-gray-400">Log Entry Type</label>
                                <select
                                  value={inlineType}
                                  onChange={(e) => setInlineType(e.target.value)}
                                  className="w-full bg-black/50 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-indigo-500 transition-all"
                                >
                                  <option value="investigating">investigating</option>
                                  <option value="identified">identified</option>
                                  <option value="monitoring">monitoring</option>
                                  <option value="resolved">resolved</option>
                                  <option value="completed">completed</option>
                                </select>
                              </div>

                              <div className="space-y-1">
                                <label className="text-[10px] font-semibold text-gray-400">Change Severity To (Optional)</label>
                                <select
                                  value={inlineSeverity}
                                  onChange={(e) => setInlineSeverity(e.target.value)}
                                  className="w-full bg-black/50 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-indigo-500 transition-all"
                                >
                                  <option value="">No Change</option>
                                  <option value="minor">minor</option>
                                  <option value="major">major</option>
                                  <option value="maintenance">maintenance</option>
                                  <option value="resolved">resolved</option>
                                </select>
                              </div>
                            </div>

                            <div className="space-y-1">
                              <label className="text-[10px] font-semibold text-gray-400">Message</label>
                              <textarea
                                placeholder="Describe the updates, status updates, or mitigation outcomes..."
                                value={inlineMessage}
                                onChange={(e) => setInlineMessage(e.target.value)}
                                rows={2}
                                className="w-full bg-black/50 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-indigo-500 transition-all resize-none"
                                required
                              />
                            </div>

                            <button
                              type="submit"
                              disabled={updating}
                              className="bg-indigo-600 hover:bg-indigo-500 disabled:bg-indigo-800 text-white font-semibold py-1.5 px-3 rounded-lg text-[10px] uppercase tracking-wider transition-all flex items-center gap-1.5"
                            >
                              {updating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                              Append Entry
                            </button>
                          </form>
                        )}

                        {incident.updates.map((update, idx) => (
                          <div key={idx} className="flex gap-4 relative">
                            {/* Left Line */}
                            {idx !== incident.updates.length - 1 && (
                              <div className="absolute top-6 left-[11px] bottom-0 w-[2px] bg-white/5" />
                            )}
                            
                            {/* Pulse dot */}
                            <div className="mt-1 flex-shrink-0 flex items-center justify-center w-6 h-6 rounded-full bg-white/5 border border-white/10 text-indigo-400">
                              {update.type === 'resolved' || update.type === 'completed' ? (
                                <CheckCircle className="w-3.5 h-3.5 text-emerald-400" />
                              ) : (
                                <Clock className="w-3.5 h-3.5 text-indigo-400 animate-pulse" />
                              )}
                            </div>

                            <div className="space-y-1">
                              <div className="flex items-center gap-2">
                                <span className="text-xs font-extrabold text-white tracking-wide">{update.title}</span>
                                <span className="text-[10px] text-gray-500 font-semibold">— {update.time}</span>
                              </div>
                              <p className="text-xs text-gray-400 leading-relaxed font-medium">{update.message}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Footer Support Info */}
        <footer className="bg-gradient-to-r from-indigo-950/20 via-slate-950/10 to-indigo-950/20 border border-white/5 rounded-2xl p-6 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <HelpCircle className="w-6 h-6 text-indigo-400" />
            <div>
              <h4 className="text-sm font-bold text-white">Need support or believe something is down?</h4>
              <p className="text-xs text-gray-400 mt-0.5">Submit an appeal, open a ticket, or speak directly to a staff member.</p>
            </div>
          </div>
          
          <a 
            href="/support"
            className="bg-indigo-600 hover:bg-indigo-500 text-white font-semibold py-2 px-4 rounded-xl text-xs transition-all tracking-wider uppercase shadow-lg shadow-indigo-950/40"
          >
            Open Ticket
          </a>
        </footer>

      </main>
    </div>
  );
}
