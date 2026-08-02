'use client'

import { ArrowLeft, Code, ShieldCheck, Zap, MessageSquare, Copy, ExternalLink, Cpu, Globe, Database, Key, Terminal, Server } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'

export default function DocsPage() {
  const router = useRouter()
  const [apiKey, setApiKey] = useState('')
  const [appId, setAppId] = useState('730')
  const [bulkAppIds, setBulkAppIds] = useState('730, 570')
  const [fixName, setFixName] = useState('palworld')
  const [testResults, setTestResults] = useState<Record<string, any>>({})
  const [loading, setLoading] = useState<Record<string, boolean>>({})

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text)
    alert('Copied to clipboard!')
  }

  const handleTest = async (endpoint: string, url: string, method: string = 'GET', body?: any) => {
    if (!apiKey) {
      alert("Please enter an API Key first in the Playground section!")
      return
    }
    setLoading(prev => ({ ...prev, [endpoint]: true }))
    try {
      const headers: Record<string, string> = { 'Authorization': `Bearer ${apiKey}` }
      if (body) headers['Content-Type'] = 'application/json'
      
      const res = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined })
      const data = await res.json()
      setTestResults(prev => ({ ...prev, [endpoint]: { status: res.status, body: data } }))
    } catch (e: any) {
      setTestResults(prev => ({ ...prev, [endpoint]: { status: 500, error: e.message } }))
    } finally {
      setLoading(prev => ({ ...prev, [endpoint]: false }))
    }
  }

  return (
    <div className="min-h-screen bg-background relative selection:bg-indigo-500/30 text-white overflow-x-hidden">
      {/* Background Orbs */}
      <div className="fixed top-[-20%] left-[-10%] w-[50%] h-[50%] rounded-full bg-indigo-500/10 blur-[120px] pointer-events-none" />
      <div className="fixed bottom-[-20%] right-[-10%] w-[40%] h-[40%] rounded-full bg-purple-500/10 blur-[120px] pointer-events-none" />
      
      <nav className="sticky top-0 z-50 glass border-b-white/5 border-t-0 border-x-0 rounded-none w-full backdrop-blur-md">
        <div className="container mx-auto px-6 py-4 flex justify-between items-center">
          <div className="flex items-center space-x-3 cursor-pointer" onClick={() => router.push('/')}>
            <div className="hover:scale-110 transition-transform duration-300">
              <img src="/favicon.ico" alt="OpenSteam" className="h-8 w-8" />
            </div>
            <span className="text-xl font-bold tracking-tight">OpenSteam <span className="text-indigo-400">Developer</span></span>
          </div>
          <button 
            onClick={() => router.push('/')}
            className="flex items-center space-x-2 text-sm text-muted-foreground hover:text-white transition-colors py-2 px-4 hover:bg-white/5 rounded-xl border border-transparent hover:border-white/10"
          >
            <ArrowLeft className="h-4 w-4" />
            <span>Back to Home</span>
          </button>
        </div>
      </nav>

      <main className="container mx-auto px-6 py-16 max-w-5xl relative z-10">
        <header className="mb-20 text-center md:text-left flex flex-col md:flex-row md:items-end justify-between gap-6">
          <div className="max-w-2xl">
            <div className="inline-flex items-center space-x-2 px-3 py-1 bg-indigo-500/10 border border-indigo-500/20 rounded-full mb-4">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-indigo-500"></span>
              </span>
              <span className="text-[10px] font-bold uppercase tracking-wider text-indigo-400 leading-none">v2.0 Developer API</span>
            </div>
            <h1 className="text-5xl md:text-6xl font-black tracking-tighter mb-6 bg-gradient-to-r from-white via-white to-white/40 bg-clip-text text-transparent">
              Integrate <span className="text-indigo-400">Automation</span>.
            </h1>
            <p className="text-xl text-muted-foreground leading-relaxed">
              Everything you need to integrate OpenSteam manifest automation into your application or workflow. Simple, path-based, and lightning-fast.
            </p>
          </div>
          <div className="hidden lg:block">
             <div className="glass p-4 rounded-2xl border-white/5 rotate-3 hover:rotate-0 transition-transform duration-500 scale-90 opacity-60">
                <Code className="h-12 w-12 text-indigo-500/40" />
             </div>
          </div>
        </header>

        {/* PREREQUISITES SECTION */}
        <div className="mb-16 space-y-8">
          <div className="flex items-center space-x-4">
            <div className="p-3 bg-amber-500/20 rounded-2xl">
              <Key className="h-7 w-7 text-amber-400" />
            </div>
            <h2 className="text-3xl font-extrabold tracking-tight">Prerequisites & Setup</h2>
          </div>
          <div className="glass p-8 rounded-3xl border-white/5 space-y-6 text-muted-foreground">
            <p className="leading-relaxed">Before you start hitting the API, please ensure you meet the following requirements to avoid instant HTTP 403 or 400 errors.</p>
            <ul className="space-y-4 list-none p-0 m-0">
              <li className="flex items-start gap-4">
                <div className="mt-1 p-1 bg-white/10 rounded-md"><Globe className="h-4 w-4 text-white" /></div>
                <div>
                  <strong className="text-white block mb-1">Valid API Key required</strong>
                  You must create an API key via your <a href="/dashboard" className="text-indigo-400 hover:underline">Developer Dashboard</a>. The key must be passed via the <code className="text-emerald-400 bg-white/5 px-1 py-0.5 rounded">Authorization: Bearer YOUR_KEY</code> header on every request.
                </div>
              </li>
              <li className="flex items-start gap-4">
                <div className="mt-1 p-1 bg-white/10 rounded-md"><Server className="h-4 w-4 text-white" /></div>
                <div>
                  <strong className="text-white block mb-1">Base Steam App IDs ONLY</strong>
                  Our engine explicitly blocks requests for DLCs, soundtracks, and invalid App IDs. You must provide the base game's numeric App ID (e.g., <code className="text-white">730</code> for CS:GO).
                </div>
              </li>
              <li className="flex items-start gap-4">
                <div className="mt-1 p-1 bg-white/10 rounded-md"><ShieldCheck className="h-4 w-4 text-white" /></div>
                <div>
                  <strong className="text-white block mb-1">Active Quota</strong>
                  Depending on your plan, you have a daily request limit (15/day for Free). Generating an existing manifest uses 1 credit, missing upstream requests use 2 credits. Monitor your usage via the <code className="text-indigo-400">/api/&#123;apiKey&#125;/stats</code> endpoint.
                </div>
              </li>
            </ul>
          </div>
        </div>

        <div className="mb-20 glass p-8 rounded-3xl border-indigo-500/30 relative overflow-hidden">
          <div className="absolute top-0 right-0 p-4 opacity-5 pointer-events-none">
            <Zap className="h-48 w-48 text-indigo-400" />
          </div>
          <h2 className="text-2xl font-bold mb-6 flex items-center space-x-3 relative z-10">
            <Terminal className="h-6 w-6 text-indigo-400" />
            <span>Interactive Setup</span>
          </h2>
          <p className="text-sm text-indigo-200 mb-6 relative z-10">Set your credentials here to make the "Run Test" buttons below actually execute against your account.</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 relative z-10">
            <div>
              <label className="block text-sm font-bold text-white/60 mb-2 uppercase tracking-widest">Your API Key</label>
              <input 
                type="password" 
                value={apiKey} 
                onChange={e => setApiKey(e.target.value)}
                placeholder="gg_live_..."
                className="w-full bg-black/50 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-indigo-500 font-mono transition-colors"
              />
            </div>
            <div>
              <label className="block text-sm font-bold text-white/60 mb-2 uppercase tracking-widest">Test App ID</label>
              <input 
                type="text" 
                value={appId} 
                onChange={e => setAppId(e.target.value)}
                className="w-full bg-black/50 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-indigo-500 font-mono transition-colors"
              />
            </div>
          </div>
        </div>

        <section className="space-y-24">
          
          {/* API Endpoints */}
          <div className="space-y-8">
            <div className="flex items-center space-x-4">
              <div className="p-3 bg-purple-500/20 rounded-2xl">
                <Code className="h-7 w-7 text-purple-400" />
              </div>
              <h2 className="text-3xl font-extrabold tracking-tight">Standard Endpoints</h2>
            </div>
            
            <div className="space-y-16">
              {/* Endpoint: Generate */}
              <div className="glass group rounded-[2.5rem] border-white/5 overflow-hidden flex flex-col">
                <div className="p-8 md:p-10 border-b border-white/5">
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
                    <div className="flex items-center space-x-4">
                      <span className="px-4 py-1.5 bg-emerald-500/20 text-emerald-400 rounded-xl text-xs font-black font-mono tracking-widest">GET</span>
                      <h3 className="text-2xl font-bold tracking-tight">Fast Generate</h3>
                    </div>
                    <div className="flex items-center bg-black/40 px-4 py-2 rounded-2xl border border-white/5 text-xs font-mono text-indigo-300">
                      /api/v2/generate/&#123;appId&#125;
                    </div>
                  </div>
                  <p className="text-muted-foreground leading-relaxed">
                    The primary engine for fetching game manifests. This checks our high-speed cache first. If missing, it immediately attempts upstream providers (like Ryuu or Morrenus).
                  </p>
                  
                  <div className="mt-6 bg-black/40 border border-white/5 rounded-xl p-4 overflow-x-auto">
                    <code className="text-sm font-mono text-emerald-400">curl</code>
                    <code className="text-sm font-mono text-white/80"> -H "Authorization: Bearer YOUR_API_KEY" "http://127.0.0.1:3000/api/v2/generate/730"</code>
                  </div>
                  
                  <div className="mt-8 grid grid-cols-1 md:grid-cols-2 gap-8">
                    <div>
                      <h4 className="text-xs font-black uppercase tracking-widest text-white/40 mb-4">Request Parameters</h4>
                      <ul className="space-y-3 text-sm text-white/80">
                        <li className="flex justify-between border-b border-white/5 pb-2">
                          <code className="text-indigo-300">appId</code> <span className="text-xs text-muted-foreground">Required (Path) - Steam App ID</span>
                        </li>
                        <li className="flex justify-between border-b border-white/5 pb-2">
                          <code className="text-indigo-300">format</code> <span className="text-xs text-muted-foreground">Optional (Query) - 'json' or 'zip'</span>
                        </li>
                      </ul>
                    </div>
                    <div>
                       <h4 className="text-xs font-black uppercase tracking-widest text-white/40 mb-4">Expected Responses</h4>
                       <ul className="space-y-3 text-sm text-white/80">
                        <li className="flex items-center gap-2">
                          <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                          <code>200 OK</code> - Returns the manifest JSON payload.
                        </li>
                        <li className="flex items-center gap-2">
                          <span className="w-2 h-2 rounded-full bg-rose-500"></span>
                          <code>404 Not Found</code> - Game missing and upstream failed.
                        </li>
                        <li className="flex items-center gap-2">
                          <span className="w-2 h-2 rounded-full bg-amber-500"></span>
                          <code>429 Too Many Requests</code> - Out of quota.
                        </li>
                      </ul>
                    </div>
                  </div>
                </div>
                
                <div className="bg-black/60 p-6 flex flex-col md:flex-row gap-6 relative">
                    <div className="flex-1">
                      <div className="flex items-center justify-between mb-4">
                        <span className="text-[10px] uppercase font-bold tracking-widest text-white/40">Live Response</span>
                        <button 
                          onClick={() => handleTest('generate', `/api/v2/generate/${appId}`)}
                          disabled={loading['generate']}
                          className="bg-indigo-500 hover:bg-indigo-600 text-white text-xs font-bold py-1 px-3 rounded-lg transition-colors disabled:opacity-50 z-10"
                        >
                          {loading['generate'] ? 'Testing...' : 'Run Test'}
                        </button>
                      </div>
                      <pre className="text-xs text-indigo-200 overflow-x-auto bg-black/40 p-4 rounded-xl border border-white/5 min-h-[100px]">
                        {testResults['generate'] ? JSON.stringify(testResults['generate'], null, 2) : 'Click Run Test to execute request.'}
                      </pre>
                    </div>
                </div>
              </div>

              {/* Endpoint: Request */}
              <div className="glass group rounded-[2.5rem] border-white/5 overflow-hidden flex flex-col">
                <div className="p-8 md:p-10 border-b border-white/5">
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
                    <div className="flex items-center space-x-4">
                      <span className="px-4 py-1.5 bg-blue-500/20 text-blue-400 rounded-xl text-xs font-black font-mono tracking-widest">POST</span>
                      <h3 className="text-2xl font-bold tracking-tight">Formal Request</h3>
                    </div>
                    <div className="flex items-center bg-black/40 px-4 py-2 rounded-2xl border border-white/5 text-xs font-mono text-blue-300">
                      /api/v2/request/&#123;appId&#125;
                    </div>
                  </div>
                  <p className="text-muted-foreground leading-relaxed">
                    Programmatically request that a game be queued into our passive generation pipeline. If the game is not immediately available, it enters our background async processing queue.
                  </p>
                  
                  <div className="mt-6 bg-black/40 border border-white/5 rounded-xl p-4 overflow-x-auto">
                    <code className="text-sm font-mono text-blue-400">curl</code>
                    <code className="text-sm font-mono text-white/80"> -X POST -H "Authorization: Bearer YOUR_API_KEY" -H "Content-Type: application/json" -d '{`{"reason":"test"}`}' "http://127.0.0.1:3000/api/v2/request/730"</code>
                  </div>
                  
                  <div className="mt-8 grid grid-cols-1 md:grid-cols-2 gap-8">
                    <div>
                      <h4 className="text-xs font-black uppercase tracking-widest text-white/40 mb-4">JSON Body Parameters</h4>
                      <ul className="space-y-3 text-sm text-white/80">
                        <li className="flex justify-between border-b border-white/5 pb-2">
                          <code className="text-blue-300">reason</code> <span className="text-xs text-muted-foreground">Optional (string) - Context for request</span>
                        </li>
                      </ul>
                    </div>
                    <div>
                       <h4 className="text-xs font-black uppercase tracking-widest text-white/40 mb-4">Expected Responses</h4>
                       <ul className="space-y-3 text-sm text-white/80">
                        <li className="flex items-center gap-2">
                          <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                          <code>200 OK</code> - <code>{`{"status": "sent", "appId": "..."}`}</code>
                        </li>
                        <li className="flex items-center gap-2">
                          <span className="w-2 h-2 rounded-full bg-amber-500"></span>
                          <code>400 Bad Request</code> - Requesting a DLC or invalid ID.
                        </li>
                      </ul>
                    </div>
                  </div>
                </div>
                
                <div className="bg-black/60 p-6 flex flex-col md:flex-row gap-6 relative">
                    <div className="flex-1">
                      <div className="flex items-center justify-between mb-4">
                        <span className="text-[10px] uppercase font-bold tracking-widest text-white/40">Live Response</span>
                        <button 
                          onClick={() => handleTest('request', `/api/v2/request/${appId}`, 'POST', { reason: "API Test Request" })}
                          disabled={loading['request']}
                          className="bg-blue-500 hover:bg-blue-600 text-white text-xs font-bold py-1 px-3 rounded-lg transition-colors disabled:opacity-50 z-10"
                        >
                          {loading['request'] ? 'Testing...' : 'Run Test'}
                        </button>
                      </div>
                      <pre className="text-xs text-blue-200 overflow-x-auto bg-black/40 p-4 rounded-xl border border-white/5 min-h-[100px]">
                        {testResults['request'] ? JSON.stringify(testResults['request'], null, 2) : 'Click Run Test to execute request.'}
                      </pre>
                    </div>
                </div>
              </div>

              {/* Bulk Generation */}
              <div className="glass group rounded-[2.5rem] border-white/5 overflow-hidden flex flex-col">
                <div className="p-8 md:p-10 border-b border-white/5">
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
                    <div className="flex items-center space-x-4">
                      <span className="px-4 py-1.5 bg-purple-500/20 text-purple-400 rounded-xl text-xs font-black font-mono tracking-widest">POST</span>
                      <h3 className="text-2xl font-bold tracking-tight">Bulk Generate</h3>
                    </div>
                    <div className="flex items-center bg-black/40 px-4 py-2 rounded-2xl border border-white/5 text-xs font-mono text-purple-300">
                      /api/v2/bulk/generate
                    </div>
                  </div>
                  <p className="text-muted-foreground leading-relaxed">
                    Queue up to 25 App IDs in one synchronous request. Only available for Reseller plans and higher.
                  </p>
                  <div className="mt-6 bg-black/40 border border-white/5 rounded-xl p-4 overflow-x-auto whitespace-nowrap">
                    <code className="text-sm font-mono text-purple-400">curl</code>
                    <code className="text-sm font-mono text-white/80"> -X POST -H "Authorization: Bearer YOUR_API_KEY" -H "Content-Type: application/json" -d '{`{"appIds":["730","570"]}`}' "http://127.0.0.1:3000/api/v2/bulk/generate"</code>
                  </div>
                  <div className="mt-6">
                      <h4 className="text-xs font-black uppercase tracking-widest text-white/40 mb-4">JSON Body</h4>
                      <code className="text-[10px] bg-black/40 p-3 rounded-xl text-white/70 block">{`{ "appIds": ["730", "570"] }`}</code>
                  </div>
                </div>
                <div className="bg-black/60 p-6 flex flex-col md:flex-row gap-6 relative">
                    <div className="flex-1">
                      <div className="flex items-center justify-between mb-4">
                        <input 
                          type="text"
                          value={bulkAppIds}
                          onChange={e => setBulkAppIds(e.target.value)}
                          placeholder="730, 570"
                          className="bg-black/50 border border-white/10 rounded px-2 py-1 text-xs text-white"
                        />
                        <button 
                          onClick={() => handleTest('bulk', `/api/v2/bulk/generate`, 'POST', { appIds: bulkAppIds.split(',').map(s=>s.trim()) })}
                          disabled={loading['bulk']}
                          className="bg-purple-500 hover:bg-purple-600 text-white text-xs font-bold py-1 px-3 rounded-lg transition-colors disabled:opacity-50 z-10"
                        >
                          {loading['bulk'] ? 'Testing...' : 'Run Bulk Test'}
                        </button>
                      </div>
                      <pre className="text-xs text-purple-200 overflow-x-auto bg-black/40 p-4 rounded-xl border border-white/5 min-h-[100px]">
                        {testResults['bulk'] ? JSON.stringify(testResults['bulk'], null, 2) : 'Click Run Test to execute request.'}
                      </pre>
                    </div>
                </div>
              </div>

              {/* OnlineFix List */}
              <div className="glass group rounded-[2.5rem] border-white/5 overflow-hidden flex flex-col">
                <div className="p-8 md:p-10 border-b border-white/5">
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
                    <div className="flex items-center space-x-4">
                      <span className="px-4 py-1.5 bg-indigo-500/20 text-indigo-400 rounded-xl text-xs font-black font-mono tracking-widest">GET</span>
                      <h3 className="text-2xl font-bold tracking-tight">OnlineFix List</h3>
                    </div>
                    <div className="flex items-center bg-black/40 px-4 py-2 rounded-2xl border border-white/5 text-xs font-mono text-indigo-300">
                      /api/v2/onlinefix/list
                    </div>
                  </div>
                  <p className="text-muted-foreground leading-relaxed">
                    Retrieve a complete list of all currently indexed OnlineFix games, including their filenames and metadata.
                  </p>
                  <div className="mt-6 bg-black/40 border border-white/5 rounded-xl p-4 overflow-x-auto whitespace-nowrap">
                    <code className="text-sm font-mono text-indigo-400">curl</code>
                    <code className="text-sm font-mono text-white/80"> -H "Authorization: Bearer YOUR_API_KEY" "http://127.0.0.1:3000/api/v2/onlinefix/list"</code>
                  </div>
                </div>
                <div className="bg-black/60 p-6 flex flex-col md:flex-row gap-6 relative">
                    <div className="flex-1">
                      <div className="flex items-center justify-between mb-4">
                        <span className="text-[10px] uppercase font-bold tracking-widest text-indigo-400/40">Live Response</span>
                        <button 
                          onClick={() => handleTest('onlinefixList', `/api/v2/onlinefix/list`, 'GET')}
                          disabled={loading['onlinefixList']}
                          className="bg-indigo-500 hover:bg-indigo-600 text-white text-xs font-bold py-1 px-3 rounded-lg transition-colors disabled:opacity-50 z-10"
                        >
                          {loading['onlinefixList'] ? 'Testing...' : 'Run Test'}
                        </button>
                      </div>
                      <pre className="text-xs text-indigo-200 overflow-x-auto bg-black/40 p-4 rounded-xl border border-white/5 min-h-[100px]">
                        {testResults['onlinefixList'] ? JSON.stringify(testResults['onlinefixList'], null, 2) : 'Click Run Test to execute request.'}
                      </pre>
                    </div>
                </div>
              </div>

              {/* OnlineFix Download */}
              <div className="glass group rounded-[2.5rem] border-white/5 overflow-hidden flex flex-col">
                <div className="p-8 md:p-10 border-b border-white/5">
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
                    <div className="flex items-center space-x-4">
                      <span className="px-4 py-1.5 bg-rose-500/20 text-rose-400 rounded-xl text-xs font-black font-mono tracking-widest">GET</span>
                      <h3 className="text-2xl font-bold tracking-tight">OnlineFix Download</h3>
                    </div>
                    <div className="flex items-center bg-black/40 px-4 py-2 rounded-2xl border border-white/5 text-xs font-mono text-rose-300">
                      /api/v2/onlinefix/download/&#123;name&#125;
                    </div>
                  </div>
                  <p className="text-muted-foreground leading-relaxed">
                    Search and directly download multiplayer fixes from the OnlineFix database by game name. This endpoint will redirect you to the direct file URL.
                  </p>
                  <div className="mt-6 bg-black/40 border border-white/5 rounded-xl p-4 overflow-x-auto whitespace-nowrap">
                    <code className="text-sm font-mono text-rose-400">curl</code>
                    <code className="text-sm font-mono text-white/80"> -L -H "Authorization: Bearer YOUR_API_KEY" "http://127.0.0.1:3000/api/v2/onlinefix/download/palworld" -o fix.zip</code>
                  </div>
                </div>
                <div className="bg-black/60 p-6 flex flex-col md:flex-row gap-6 relative">
                    <div className="flex-1">
                      <div className="flex items-center justify-between mb-4">
                        <input 
                          type="text"
                          value={fixName}
                          onChange={e => setFixName(e.target.value)}
                          placeholder="palworld"
                          className="bg-black/50 border border-white/10 rounded px-2 py-1 text-xs text-white"
                        />
                        <button 
                          onClick={() => handleTest('onlinefixDownload', `/api/v2/onlinefix/download/${encodeURIComponent(fixName)}`, 'GET')}
                          disabled={loading['onlinefixDownload']}
                          className="bg-rose-500 hover:bg-rose-600 text-white text-xs font-bold py-1 px-3 rounded-lg transition-colors disabled:opacity-50 z-10"
                        >
                          {loading['onlinefixDownload'] ? 'Testing...' : 'Test Search'}
                        </button>
                      </div>
                      <pre className="text-xs text-rose-200 overflow-x-auto bg-black/40 p-4 rounded-xl border border-white/5 min-h-[100px]">
                        {testResults['onlinefixDownload'] ? JSON.stringify(testResults['onlinefixDownload'], null, 2) : 'Note: Real requests will 302 redirect to the ZIP file. The test block will show the JSON response or network error.'}
                      </pre>
                    </div>
                </div>
              </div>

              {/* Legacy API Notice */}
              <div className="glass group rounded-[2.5rem] border-amber-500/20 overflow-hidden flex flex-col mt-16">
                <div className="p-8 md:p-10 border-b border-amber-500/10 bg-amber-500/5">
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
                    <div className="flex items-center space-x-4">
                      <span className="px-4 py-1.5 bg-amber-500/20 text-amber-400 rounded-xl text-xs font-black font-mono tracking-widest">DEPRECATED</span>
                      <h3 className="text-2xl font-bold tracking-tight text-amber-100">Legacy Endpoints (v1)</h3>
                    </div>
                  </div>
                  <p className="text-amber-200/80 leading-relaxed">
                    The old <code className="bg-black/30 px-2 py-0.5 rounded text-amber-300">/api/[apiKey]/...</code> generate and request endpoints have been deprecated in favor of our new v2 header-based authentication API. 
                    <br/><br/>
                    <strong>Important Notice:</strong> API Keys created from today (July 5th, 2026) onwards <strong>cannot</strong> use these legacy generate and request endpoints (they will return an HTTP 666 error). 
                    However, the legacy <strong>stats</strong> and <strong>usage</strong> endpoints remain fully supported and unblocked for all API keys, including newly created ones.
                  </p>
                </div>
              </div>

              {/* Legacy Endpoint: Generate */}
              <div className="glass group rounded-[2.5rem] border-amber-500/20 overflow-hidden flex flex-col mt-4">
                <div className="p-8 md:p-10 border-b border-amber-500/10 bg-black/20">
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
                    <div className="flex items-center space-x-4">
                      <span className="px-4 py-1.5 bg-emerald-500/20 text-emerald-400 rounded-xl text-xs font-black font-mono tracking-widest">GET</span>
                      <h3 className="text-xl font-bold tracking-tight text-amber-100">Legacy Generate</h3>
                    </div>
                    <div className="flex items-center bg-black/40 px-4 py-2 rounded-2xl border border-amber-500/10 text-xs font-mono text-amber-300">
                      /api/&#123;apiKey&#125;/generate/&#123;appId&#125;
                    </div>
                  </div>
                  <div className="mt-4 bg-black/40 border border-amber-500/10 rounded-xl p-4 overflow-x-auto">
                    <code className="text-sm font-mono text-emerald-400">curl</code>
                    <code className="text-sm font-mono text-white/80"> "http://127.0.0.1:3000/api/YOUR_API_KEY/generate/730"</code>
                  </div>
                </div>
                <div className="bg-black/60 p-6 flex flex-col md:flex-row gap-6 relative">
                    <div className="flex-1">
                      <div className="flex items-center justify-between mb-4">
                        <span className="text-[10px] uppercase font-bold tracking-widest text-amber-400/40">Live Response</span>
                        <button 
                          onClick={() => handleTest('legacyGenerate', `/api/${apiKey}/generate/${appId}`)}
                          disabled={loading['legacyGenerate']}
                          className="bg-amber-500/20 hover:bg-amber-500/40 text-amber-300 text-xs font-bold py-1 px-3 rounded-lg transition-colors disabled:opacity-50 z-10"
                        >
                          {loading['legacyGenerate'] ? 'Testing...' : 'Run Test'}
                        </button>
                      </div>
                      <pre className="text-xs text-amber-200 overflow-x-auto bg-black/40 p-4 rounded-xl border border-amber-500/10 min-h-[100px]">
                        {testResults['legacyGenerate'] ? JSON.stringify(testResults['legacyGenerate'], null, 2) : 'Click Run Test to execute request.'}
                      </pre>
                    </div>
                </div>
              </div>

              {/* Legacy Endpoint: Request */}
              <div className="glass group rounded-[2.5rem] border-amber-500/20 overflow-hidden flex flex-col mt-4">
                <div className="p-8 md:p-10 border-b border-amber-500/10 bg-black/20">
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
                    <div className="flex items-center space-x-4">
                      <span className="px-4 py-1.5 bg-blue-500/20 text-blue-400 rounded-xl text-xs font-black font-mono tracking-widest">POST</span>
                      <h3 className="text-xl font-bold tracking-tight text-amber-100">Legacy Request</h3>
                    </div>
                    <div className="flex items-center bg-black/40 px-4 py-2 rounded-2xl border border-amber-500/10 text-xs font-mono text-amber-300">
                      /api/&#123;apiKey&#125;/request/&#123;appId&#125;
                    </div>
                  </div>
                  <div className="mt-4 bg-black/40 border border-amber-500/10 rounded-xl p-4 overflow-x-auto">
                    <code className="text-sm font-mono text-blue-400">curl</code>
                    <code className="text-sm font-mono text-white/80"> -X POST -H "Content-Type: application/json" -d '{`{"reason":"test"}`}' "http://127.0.0.1:3000/api/YOUR_API_KEY/request/730"</code>
                  </div>
                </div>
                <div className="bg-black/60 p-6 flex flex-col md:flex-row gap-6 relative">
                    <div className="flex-1">
                      <div className="flex items-center justify-between mb-4">
                        <span className="text-[10px] uppercase font-bold tracking-widest text-amber-400/40">Live Response</span>
                        <button 
                          onClick={() => handleTest('legacyRequest', `/api/${apiKey}/request/${appId}`, 'POST', { reason: "API Test Request" })}
                          disabled={loading['legacyRequest']}
                          className="bg-amber-500/20 hover:bg-amber-500/40 text-amber-300 text-xs font-bold py-1 px-3 rounded-lg transition-colors disabled:opacity-50 z-10"
                        >
                          {loading['legacyRequest'] ? 'Testing...' : 'Run Test'}
                        </button>
                      </div>
                      <pre className="text-xs text-amber-200 overflow-x-auto bg-black/40 p-4 rounded-xl border border-amber-500/10 min-h-[100px]">
                        {testResults['legacyRequest'] ? JSON.stringify(testResults['legacyRequest'], null, 2) : 'Click Run Test to execute request.'}
                      </pre>
                    </div>
                </div>
              </div>

              {/* Legacy Stats & Usage */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mt-4">
                <div className="glass p-8 rounded-3xl border-amber-500/20 bg-black/20">
                  <div className="flex items-center justify-between mb-4">
                    <h4 className="text-sm font-black uppercase tracking-widest flex items-center space-x-2 text-amber-100">
                      <Cpu className="h-4 w-4 text-amber-400" />
                      <span>GET /api/&#123;apiKey&#125;/stats</span>
                    </h4>
                    <button 
                      onClick={() => handleTest('legacyStats', `/api/${apiKey}/stats`)}
                      disabled={loading['legacyStats']}
                      className="bg-amber-500/20 hover:bg-amber-500/40 text-amber-300 text-[10px] font-bold py-1 px-2 rounded transition-colors"
                    >
                      {loading['legacyStats'] ? '...' : 'Run'}
                    </button>
                  </div>
                  <div className="mb-4 bg-black/40 border border-amber-500/10 rounded-xl p-3 overflow-x-auto">
                    <code className="text-[10px] font-mono text-amber-400">curl</code>
                    <code className="text-[10px] font-mono text-white/80"> "http://127.0.0.1:3000/api/YOUR_API_KEY/stats"</code>
                  </div>
                  <pre className="text-[10px] bg-black/40 p-3 rounded-xl text-amber-300 font-mono overflow-x-auto min-h-[80px] border border-amber-500/10">
                    {testResults['legacyStats'] ? JSON.stringify(testResults['legacyStats'], null, 2) : '{ "quota": ... }'}
                  </pre>
                </div>
                
                <div className="glass p-8 rounded-3xl border-amber-500/20 bg-black/20">
                  <div className="flex items-center justify-between mb-4">
                    <h4 className="text-sm font-black uppercase tracking-widest flex items-center space-x-2 text-amber-100">
                      <Database className="h-4 w-4 text-amber-400" />
                      <span>GET /api/&#123;apiKey&#125;/usage</span>
                    </h4>
                    <button 
                      onClick={() => handleTest('legacyUsage', `/api/${apiKey}/usage`)}
                      disabled={loading['legacyUsage']}
                      className="bg-amber-500/20 hover:bg-amber-500/40 text-amber-300 text-[10px] font-bold py-1 px-2 rounded transition-colors"
                    >
                      {loading['legacyUsage'] ? '...' : 'Run'}
                    </button>
                  </div>
                  <div className="mb-4 bg-black/40 border border-amber-500/10 rounded-xl p-3 overflow-x-auto">
                    <code className="text-[10px] font-mono text-amber-400">curl</code>
                    <code className="text-[10px] font-mono text-white/80"> "http://127.0.0.1:3000/api/YOUR_API_KEY/usage"</code>
                  </div>
                  <pre className="text-[10px] bg-black/40 p-3 rounded-xl text-amber-300 font-mono overflow-x-auto min-h-[80px] border border-amber-500/10">
                    {testResults['legacyUsage'] ? JSON.stringify(testResults['legacyUsage'], null, 2) : '[ { "endpoint": ... } ]'}
                  </pre>
                </div>
              </div>

              {/* Legacy Bulk Generation */}
              <div className="glass group rounded-[2.5rem] border-amber-500/20 overflow-hidden flex flex-col mt-4">
                <div className="p-8 md:p-10 border-b border-amber-500/10 bg-black/20">
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
                    <div className="flex items-center space-x-4">
                      <span className="px-4 py-1.5 bg-purple-500/20 text-purple-400 rounded-xl text-xs font-black font-mono tracking-widest">POST</span>
                      <h3 className="text-xl font-bold tracking-tight text-amber-100">Legacy Bulk Generate</h3>
                    </div>
                    <div className="flex items-center bg-black/40 px-4 py-2 rounded-2xl border border-amber-500/10 text-xs font-mono text-amber-300">
                      /api/&#123;apiKey&#125;/bulk/generate
                    </div>
                  </div>
                  <div className="mt-4 bg-black/40 border border-amber-500/10 rounded-xl p-4 overflow-x-auto whitespace-nowrap">
                    <code className="text-sm font-mono text-purple-400">curl</code>
                    <code className="text-sm font-mono text-white/80"> -X POST -H "Content-Type: application/json" -d '{`{"appIds":["730","570"]}`}' "http://127.0.0.1:3000/api/YOUR_API_KEY/bulk/generate"</code>
                  </div>
                </div>
                <div className="bg-black/60 p-6 flex flex-col md:flex-row gap-6 relative">
                    <div className="flex-1">
                      <div className="flex items-center justify-between mb-4">
                        <input 
                          type="text"
                          value={bulkAppIds}
                          onChange={e => setBulkAppIds(e.target.value)}
                          placeholder="730, 570"
                          className="bg-black/50 border border-amber-500/10 rounded px-2 py-1 text-xs text-white"
                        />
                        <button 
                          onClick={() => handleTest('legacyBulk', `/api/${apiKey}/bulk/generate`, 'POST', { appIds: bulkAppIds.split(',').map(s=>s.trim()) })}
                          disabled={loading['legacyBulk']}
                          className="bg-amber-500/20 hover:bg-amber-500/40 text-amber-300 text-xs font-bold py-1 px-3 rounded-lg transition-colors disabled:opacity-50 z-10"
                        >
                          {loading['legacyBulk'] ? 'Testing...' : 'Run Bulk Test'}
                        </button>
                      </div>
                      <pre className="text-xs text-amber-200 overflow-x-auto bg-black/40 p-4 rounded-xl border border-amber-500/10 min-h-[100px]">
                        {testResults['legacyBulk'] ? JSON.stringify(testResults['legacyBulk'], null, 2) : 'Click Run Bulk Test to execute request.'}
                      </pre>
                    </div>
                </div>
              </div>

            </div>
          </div>
          
          <div className="space-y-12">
            <div className="flex items-center space-x-4">
              <div className="p-3 bg-red-500/20 rounded-2xl">
                <ShieldCheck className="h-7 w-7 text-red-100" />
              </div>
              <h2 className="text-3xl font-extrabold tracking-tight">Sentinel Firewall & Limits</h2>
            </div>

            <div className="glass rounded-[2rem] border-white/5 overflow-hidden">
               <div className="overflow-x-auto scrollbar-none">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-white/5 bg-white/5 text-[10px] font-black uppercase tracking-[0.2em] text-white/40">
                        <th className="px-8 py-6">Plan Tier</th>
                        <th className="px-8 py-6">Daily Quota</th>
                        <th className="px-8 py-6">Burst Limit</th>
                        <th className="px-8 py-6">Ryuu / Morrenus</th>
                        <th className="px-8 py-6">SLA Support</th>
                      </tr>
                    </thead>
                    <tbody className="text-sm">
                      <tr className="border-b border-white/5 hover:bg-white/5 transition-colors">
                        <td className="px-8 py-6 font-bold">Free</td>
                        <td className="px-8 py-6 text-indigo-300">15 / Day</td>
                        <td className="px-8 py-6 text-white/60">5 req / 5s</td>
                        <td className="px-8 py-6 text-emerald-400">✅ Default</td>
                        <td className="px-8 py-6 text-white/40">Best Effort</td>
                      </tr>
                      <tr className="border-b border-white/5 hover:bg-white/5 transition-colors">
                        <td className="px-8 py-6 font-bold">Regular</td>
                        <td className="px-8 py-6 text-indigo-300">500 / Day</td>
                        <td className="px-8 py-6 text-white/60">30 req / 5s</td>
                        <td className="px-8 py-6 text-amber-300/80">Off*</td>
                        <td className="px-8 py-6 text-white/40">Community</td>
                      </tr>
                      <tr className="border-b border-indigo-500/20 bg-indigo-500/5 hover:bg-indigo-500/10 transition-colors">
                        <td className="px-8 py-6 font-bold flex items-center space-x-2">
                           <span>Premium</span>
                           <span className="text-[10px] bg-indigo-500/30 text-indigo-200 px-2 py-0.5 rounded-full uppercase tracking-tighter">Popular</span>
                        </td>
                        <td className="px-8 py-6 text-indigo-300">1,500 / Day</td>
                        <td className="px-8 py-6 text-white/60">50 req / 5s</td>
                        <td className="px-8 py-6 text-amber-300/80">Off*</td>
                        <td className="px-8 py-6 text-emerald-400">Standard</td>
                      </tr>
                      <tr className="border-b border-white/5 hover:bg-white/5 transition-colors">
                        <td className="px-8 py-6 font-bold">Reseller</td>
                        <td className="px-8 py-6 text-indigo-300">30,000 / Day</td>
                        <td className="px-8 py-6 text-white/60">75 req / 5s</td>
                        <td className="px-8 py-6 text-amber-300/80">Off*</td>
                        <td className="px-8 py-6 text-amber-400">Priority</td>
                      </tr>
                      <tr className="border-b border-white/5 hover:bg-white/5 transition-colors">
                        <td className="px-8 py-6 font-bold">Business</td>
                        <td className="px-8 py-6 text-indigo-300">100,000 / Day</td>
                        <td className="px-8 py-6 text-white/60">100 req / 5s</td>
                        <td className="px-8 py-6 text-amber-300/80">Off*</td>
                        <td className="px-8 py-6 text-amber-400">Enterprise</td>
                      </tr>
                    </tbody>
                  </table>
               </div>
               <p className="text-[10px] text-white/35 font-medium px-2 mt-3 max-w-3xl leading-relaxed">
                 * Paid tiers ship with upstream off by default; staff can enable Ryuu and Morrenus per account (plan overrides). Free includes both by default.
               </p>
            </div>

            <div className="p-8 bg-red-500/5 border border-red-500/20 rounded-[2rem] flex flex-col md:flex-row items-start gap-6 relative overflow-hidden group">
              <div className="absolute top-0 right-0 p-6 opacity-5 group-hover:rotate-12 transition-transform duration-700">
                <ShieldCheck className="h-32 w-32" />
              </div>
              <div className="shrink-0 p-4 bg-red-500/10 rounded-2xl relative z-10">
                <ShieldCheck className="h-8 w-8 text-red-400" />
              </div>
              <div className="space-y-2 relative z-10">
                <h4 className="text-lg font-bold text-red-100 uppercase tracking-tight">Sentinel Guard Activated</h4>
                <p className="text-sm text-red-200/60 leading-relaxed max-w-3xl">
                  Automated scraping patterns, high AppID variance, or malicious request payloads will result in a <span className="text-white font-bold underline decoration-red-500 underline-offset-2 uppercase tracking-widest text-[10px]">24-Hour IP Jail</span>. Multiple violations will result in permanent hardware and API key revocation.
                </p>
              </div>
            </div>
          </div>

          {/* Support CTA */}
          <div className="glass p-12 md:p-16 rounded-[3rem] border-indigo-500/30 text-center space-y-8 relative overflow-hidden">
            <div className="absolute top-0 left-0 w-full h-full bg-indigo-500/[0.03] animate-pulse" />
            <div className="relative z-10 space-y-4">
              <div className="inline-flex p-5 bg-indigo-500/20 rounded-3xl mb-4">
                <MessageSquare className="h-10 w-10 text-indigo-400" />
              </div>
              <h3 className="text-3xl md:text-4xl font-black tracking-tight">Custom Implementation?</h3>
              <p className="text-muted-foreground text-lg max-w-xl mx-auto leading-relaxed">
                Need specific endpoints, bulk-order discounts, or integration assistance? Our architects are available on Discord.
              </p>
            </div>
            <div className="relative z-10 pt-4 flex flex-col sm:flex-row items-center justify-center gap-4">
              <a 
                href="https://discord.gg/4RdMhcYws" 
                target="_blank"
                className="w-full sm:w-auto inline-flex items-center justify-center space-x-3 px-10 py-5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-[1.5rem] font-black transition-all duration-300 hover:scale-105 active:scale-95 shadow-xl shadow-indigo-600/20"
              >
                <div className="p-1 bg-white/20 rounded-md">
                   <img src="/favicon.ico" alt="" className="h-4 w-4" />
                </div>
                <span>Developer Discord</span>
              </a>
              <a 
                href="/pricing" 
                className="w-full sm:w-auto inline-flex items-center justify-center space-x-2 px-10 py-5 bg-white/5 hover:bg-white/10 text-white border border-white/10 rounded-[1.5rem] font-bold transition-all"
              >
                <span>View All Plans</span>
                <ExternalLink className="h-4 w-4 opacity-40 ml-1" />
              </a>
            </div>
          </div>
        </section>

        <footer className="mt-32 py-16 border-t border-white/5 flex flex-col items-center space-y-10 relative overflow-hidden">
          <div className="flex flex-wrap justify-center gap-x-12 gap-y-4 text-xs font-black uppercase tracking-[0.2em]">
            <a href="/tos" className="text-muted-foreground hover:text-indigo-400 transition-colors">Compliance</a>
            <a href="/privacy" className="text-muted-foreground hover:text-indigo-400 transition-colors">Privacy Data</a>
            <a href="/credits" className="text-muted-foreground hover:text-indigo-400 transition-colors">Credits</a>
            <a href="/pricing" className="text-indigo-400 hover:text-white transition-colors">Upgrade API</a>
            <a href="https://discord.gg/4RdMhcYws" target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-[#5865F2] transition-colors">API Support</a>
          </div>
          <div className="text-center space-y-2 relative z-10">
            <div className="flex justify-center items-center space-x-2 opacity-50 mb-4">
              <img src="/favicon.ico" alt="" className="h-6 w-6 filter grayscale" />
            </div>
            <p className="text-muted-foreground text-xs">&copy; {new Date().getFullYear()} OpenSteam API Platform. Not affiliated with Valve Corp.</p>
            <p className="text-[#3b82f6]/40 text-[10px] uppercase tracking-widest font-black pt-2">Automated Digital Delivery Systems</p>
          </div>
        </footer>
      </main>
    </div>
  )
}
