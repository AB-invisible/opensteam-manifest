'use client'

import { ArrowLeft, ExternalLink, HeartHandshake } from 'lucide-react'
import { useRouter } from 'next/navigation'

const CREDITS = [
  {
    name: 'OpenSteam',
    role: 'Platform, manifest registry, and community tooling',
    url: 'https://manifest-web-ylio.onrender.com',
    note: 'Manifest archives are cleaned and re-credited before storage and delivery.',
  },
  {
    name: 'Valve / Steam',
    role: 'Game metadata, App IDs, and store imagery',
    url: 'https://store.steampowered.com',
    note: 'Steam is a trademark of Valve Corporation. OpenSteam is not affiliated with Valve.',
  },
  {
    name: 'Ryuu',
    role: 'Optional upstream manifest source',
    url: 'https://generator.ryuu.lol',
    note: 'Used when configured for generation, probe import, request-queue autogen, and passive daily autogen.',
  },
  {
    name: 'Morrenus / Hubcap Manifest',
    role: 'Optional upstream manifest source',
    url: 'https://hubcapmanifest.com',
    note: 'Used when configured for generation, probe import, request-queue autogen, and passive daily autogen.',
  },
  {
    name: 'DepotBox',
    role: 'Optional upstream manifest source',
    url: 'https://depotbox.org',
    note: 'Used when configured for generation, probe import, request-queue autogen, and passive daily autogen. Historically the sole provider for daily background scans.',
  },
]

export default function CreditsPage() {
  const router = useRouter()

  return (
    <div className="min-h-screen bg-background relative selection:bg-indigo-500/30 text-white">
      <div className="fixed top-[-20%] right-[-10%] w-[50%] h-[50%] rounded-full bg-indigo-500/10 blur-[120px] pointer-events-none" />

      <nav className="sticky top-0 z-50 glass border-b-white/5 border-t-0 border-x-0 rounded-none w-full">
        <div className="container mx-auto px-6 py-4 flex justify-between items-center">
          <div className="flex items-center space-x-3 cursor-pointer" onClick={() => router.push('/')}>
            <img src="/favicon.ico" alt="OpenSteam" className="h-7 w-7" />
            <span className="text-xl font-bold tracking-tight">
              OpenSteam <span className="text-indigo-400">Credits</span>
            </span>
          </div>
          <button
            onClick={() => router.back()}
            className="flex items-center space-x-2 text-sm text-muted-foreground hover:text-white transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            <span>Go Back</span>
          </button>
        </div>
      </nav>

      <main className="container mx-auto px-6 py-12 max-w-4xl relative z-10">
        <header className="mb-12 text-center">
          <div className="inline-flex items-center space-x-2 px-3 py-1.5 rounded-full border border-indigo-500/30 bg-indigo-500/10 text-xs font-bold text-indigo-300 uppercase tracking-widest mb-4">
            <HeartHandshake className="h-4 w-4" />
            <span>Attribution</span>
          </div>
          <h1 className="text-4xl font-extrabold tracking-tight mb-4">Credits & Upstream Services</h1>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            OpenSteam combines our own infrastructure with optional third-party manifest providers. This page documents
            those services and how they are used.
          </p>
        </header>

        <div className="space-y-4">
          {CREDITS.map((entry) => (
            <section
              key={entry.name}
              className="rounded-2xl border border-white/10 bg-white/5 p-6 space-y-3"
            >
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                <h2 className="text-xl font-bold">{entry.name}</h2>
                <a
                  href={entry.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 text-sm text-indigo-300 hover:text-indigo-200 transition-colors"
                >
                  <span>{entry.url.replace(/^https?:\/\//, '')}</span>
                  <ExternalLink className="h-4 w-4" />
                </a>
              </div>
              <p className="text-sm text-indigo-200/80 font-medium">{entry.role}</p>
              <p className="text-sm text-muted-foreground leading-relaxed">{entry.note}</p>
            </section>
          ))}
        </div>

        <section className="mt-10 rounded-2xl border border-white/10 bg-black/30 p-6 space-y-3">
          <h2 className="text-lg font-bold">Manifest cleaning</h2>
          <p className="text-sm text-muted-foreground leading-relaxed">
            Upstream attribution lines are removed from delivered `.lua` manifests and replaced with a OpenSteam credit
            header before archives are stored or sent to users. Provider-specific promo lines (Ryuu, Morrenus/Hubcap,
            DepotBox, and others) are stripped during that process.
          </p>
        </section>
      </main>
    </div>
  )
}
