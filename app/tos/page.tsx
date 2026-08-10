'use client'

import { ShieldAlert, ArrowLeft, Scale, Ban, AlertTriangle, Coins } from 'lucide-react'
import { useRouter } from 'next/navigation'

export default function TOSPage() {
  const router = useRouter()

  return (
    <div className="min-h-screen bg-background relative selection:bg-indigo-500/30 text-white">
      <div className="fixed top-[-20%] left-[-10%] w-[50%] h-[50%] rounded-full bg-indigo-500/10 blur-[120px] pointer-events-none" />
      
      <nav className="sticky top-0 z-50 glass border-b-white/5 border-t-0 border-x-0 rounded-none w-full">
        <div className="container mx-auto px-6 py-4 flex justify-between items-center">
          <div className="flex items-center space-x-3 cursor-pointer" onClick={() => router.push('/')}>
            <div className="hover:scale-110 transition-transform">
              <img src="/opensteam.png?v=20260810" alt="OpenSteam" className="h-7 w-7" />
            </div>
            <span className="text-xl font-bold tracking-tight">OpenSteam <span className="text-indigo-400">TOS</span></span>
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
            <Scale className="h-4 w-4" />
            <span>Legal Agreement</span>
          </div>
          <h1 className="text-4xl font-extrabold tracking-tight mb-4">Terms of Service</h1>
          <p className="text-lg text-muted-foreground italic">Last Updated: July 5, 2026</p>
        </header>

        <section className="space-y-10">
          {/* Strict Enforcement */}
          <div className="glass p-8 rounded-[2.5rem] border-red-500/20 bg-red-500/5">
            <h2 className="text-xl font-black flex items-center space-x-3 text-red-400 mb-6 uppercase tracking-tight">
              <Ban className="h-6 w-6" />
              <span>Zero-Tolerance Anti-Abuse Policy</span>
            </h2>
            <div className="space-y-4 text-sm leading-relaxed text-red-100/80">
              <p>
                OpenSteam employs a sophisticated security engine to protect our infrastructure. Any attempt to <strong className="text-white">scrape, crawl, or mass-download our database</strong> is strictly prohibited.
              </p>
              <ul className="list-disc pl-5 space-y-2">
                <li>Automated scripts used outside of the documented API rate limits will be flagged.</li>
                <li>Attempts to bypass hardware-id (HWID) or IP-based rate limiting will result in an immediate system-wide ban.</li>
                <li><strong className="text-white uppercase tracking-tighter bg-red-500 px-1.5 rounded">Permanent Ban</strong>: Violation of these terms results in permanent termination of your account, API keys, and access across all services.</li>
                <li><strong className="text-white underline">No Warnings</strong>: We do not issue warnings for scraping, malicious database pulling, or brute-force attempts. Access is revoked instantly.</li>
              </ul>
            </div>
          </div>

          {/* Refund Policy & Payment Provider */}
          <div className="glass p-8 rounded-[2.5rem] border-amber-500/20 bg-amber-500/5">
            <h2 className="text-xl font-black flex items-center space-x-3 text-amber-400 mb-6 uppercase tracking-tight">
              <Coins className="h-6 w-6" />
              <span>Payment Processing & Refund Policy</span>
            </h2>
            <div className="space-y-4 text-sm leading-relaxed text-amber-100/80">
              <p>
                OpenSteam utilizes <strong className="text-white text-gradient font-black">Pandabase</strong> (https://pandabase.io) as our primary third-party payment processor and merchant of record. By using our checkout system, you agree to Pandabase's respective Terms of Service and Privacy Policy.
              </p>
              <p>
                <strong className="text-white uppercase">Liability Disclaimer</strong>: While we select trusted partners, OpenSteam is not liable for any data breaches, infrastructure leaks, or security compromises that occur on Pandabase's platform. Your billing data and payment information are handled by Pandabase; any disputes or issues regarding payment security must be directed to them.
              </p>
              <p>
                <strong className="text-white font-bold uppercase">Negative Refund Policy</strong>: Due to the nature of digital metadata and automated provisioning, <strong className="text-white uppercase underline">all sales are final</strong>. We do not offer refunds, even in cases of account termination due to system abuse.
              </p>
              <p>
                <strong className="text-red-400 font-bold uppercase">Forced Refunds & Chargebacks</strong>: Any attempt to forcibly refund a payment, including initiating a chargeback or dispute through your payment provider, will result in the immediate termination of your account and you will be banned from our platform indefinitely.
              </p>
            </div>
          </div>

          {/* Eligibility */}
          <div className="space-y-6">
            <h2 className="text-2xl font-bold flex items-center space-x-3">
              <Scale className="h-6 w-6 text-indigo-400" />
              <span>1. Eligibility and Account</span>
            </h2>
            <div className="glass p-6 rounded-2xl border-white/5 space-y-4 text-muted-foreground text-sm leading-relaxed">
              <p>
                By using OpenSteam, you represent that you are at least 13 years of age. If you are under the legal age of majority in your jurisdiction, you must have permission from a parent or legal guardian to use the service. You are responsible for maintaining the confidentiality of your account and for all activities that occur under your account.
              </p>
              <p>
                One account per individual/entity is permitted. Multiple accounts created to bypass rate limits or free-tier restrictions will be merged or terminated without notice.
              </p>
            </div>
          </div>

          {/* Service Usage */}
          <div className="space-y-6">
            <h2 className="text-2xl font-bold flex items-center space-x-3">
              <ShieldAlert className="h-6 w-6 text-indigo-400" />
              <span>2. Service Provisioning & Use</span>
            </h2>
            <div className="glass p-6 rounded-2xl border-white/5 space-y-4 text-muted-foreground text-sm leading-relaxed">
              <p>
                OpenSteam provides automated Steam manifest metadata extraction services. We do not host or distribute copyrighted game binaries. We provide programmatic access to metadata that is publicly queryable but computationally expensive to process in real-time.
              </p>
              <p>
                As a developer, you are responsible for how you use the data provided by our API. OpenSteam is not liable for any third-party service interruptions or bans on external platforms resulting from your use of our manifests.
              </p>
              <p className="text-white font-bold">
                Prohibited Activities include:
              </p>
              <ul className="list-disc pl-5 space-y-1">
                <li>Reverse engineering the Platform's API or authentication protocols.</li>
                <li>Conducting denial-of-service (DDoS) attacks or similar disruptive activities.</li>
                <li>Impersonating OpenSteam staff or branding.</li>
                <li>Reselling access to the API without an authorized Business/Reseller plan.</li>
              </ul>
            </div>

            <h2 className="text-2xl font-bold flex items-center space-x-3">
              <AlertTriangle className="h-6 w-6 text-indigo-400" />
              <span>3. API Key Security & Availability</span>
            </h2>
            <div className="glass p-6 rounded-2xl border-white/5 space-y-4 text-muted-foreground text-sm leading-relaxed">
              <p>
                You are solely responsible for the security of your API Key. Sharing your key or embedding it in client-side code where it can be extracted and used by others is a violation of these terms. If our system detects simultaneous usage from multiple geographic locations on a low-tier plan, the key will be automatically disabled for your protection and investigated for abuse.
              </p>
              <p>
                <strong className="text-white underline">Service Continuity</strong>: While we strive for 99.9% uptime, OpenSteam is provided "as is". We reserve the right to modify, suspend, or discontinue any part of the service at any time with or without notice. We are not liable for any losses incurred during maintenance windows or unforeseen network outages.
              </p>
            </div>

            {/* Intellectual Property */}
            <h2 className="text-2xl font-bold flex items-center space-x-3">
              <Scale className="h-6 w-6 text-indigo-400" />
              <span>4. Intellectual Property & Digital Rights</span>
            </h2>
            <div className="glass p-6 rounded-2xl border-white/5 space-y-4 text-muted-foreground text-sm leading-relaxed">
              <p>
                OpenSteam, including its name, trademark, visual identity, code, and platform architecture, is our exclusive property. Any unauthorized use of our name, branding, or digital assets is strictly prohibited.
              </p>
              <p>
                <strong className="text-white uppercase tracking-wider">DMCA Notice</strong>: We actively monitor for unauthorized clones or brand impersonation. Taking our name, source code, or proprietary UI/UX elements will result in an immediate **DMCA Notice** and legal enforcement against the infringing party.
              </p>
              <p>
                Metadata retrieved through the service remains the property of its respective owners. You are granted a limited, non-exclusive license to use the metadata for your own development purposes subject to these terms.
              </p>
            </div>

            {/* Termination */}
            <h2 className="text-2xl font-bold flex items-center space-x-3">
              <Ban className="h-6 w-6 text-indigo-400" />
              <span>5. Termination of Service</span>
            </h2>
            <div className="glass p-6 rounded-2xl border-white/5 space-y-4 text-muted-foreground text-sm leading-relaxed">
              <p>
                We reserve the right to terminate or suspend your access to OpenSteam immediately, without prior notice or liability, for any reason, including without limitation if you breach the Terms. Upon termination, your right to use the service will cease immediately, and any remaining subscription time will be forfeited without refund.
              </p>
            </div>
 
            <h2 className="text-2xl font-bold flex items-center space-x-3">
              <Scale className="h-6 w-6 text-indigo-400" />
              <span>6. Limitation of Liability</span>
            </h2>
            <div className="glass p-6 rounded-2xl border-white/5 space-y-4 text-muted-foreground text-sm leading-relaxed">
              <p>
                TO THE MAXIMUM EXTENT PERMITTED BY APPLICABLE LAW, OPENSTEAM AND ITS OPERATORS SHALL NOT BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL OR PUNITIVE DAMAGES, OR ANY LOSS OF PROFITS OR REVENUES, WHETHER INCURRED DIRECTLY OR INDIRECTLY, OR ANY LOSS OF DATA, USE, GOODWILL, OR OTHER INTANGIBLE LOSSES.
              </p>
              <p>
                This includes but is not limited to: account bans on third-party platforms (such as Steam) resulting from your use of manifests provided by our platform, or hardware damage resulting from high-intensity manifest processing.
              </p>
            </div>

            {/* Indemnification */}
            <h2 className="text-2xl font-bold flex items-center space-x-3">
              <ShieldAlert className="h-6 w-6 text-indigo-400" />
              <span>7. Indemnification</span>
            </h2>
            <div className="glass p-6 rounded-2xl border-white/5 space-y-4 text-muted-foreground text-sm leading-relaxed">
              <p>
                You agree to defend, indemnify, and hold harmless OpenSteam and its employees, contractors, and agents from and against any and all claims, damages, obligations, losses, liabilities, costs, or debt, and expenses (including but not limited to attorney's fees) resulting from or arising out of your use and access of the service, or a breach of these Terms.
              </p>
            </div>

            {/* Governing Law */}
            <h2 className="text-2xl font-bold flex items-center space-x-3">
              <Scale className="h-6 w-6 text-indigo-400" />
              <span>8. Governing Law & Modifications</span>
            </h2>
            <div className="glass p-6 rounded-2xl border-white/5 space-y-4 text-muted-foreground text-sm leading-relaxed">
              <p>
                These Terms shall be governed and construed in accordance with the laws of the jurisdiction in which OpenSteam operates, without regard to its conflict of law provisions. We reserve the right, at our sole discretion, to modify or replace these Terms at any time. If a revision is material, we will provide at least 30 days' notice on our Discord server prior to any new terms taking effect.
              </p>
            </div>
          </div>
 
          <div className="pt-8 text-center border-t border-white/5">
            <p className="text-xs text-muted-foreground italic">
              Continuing to use OpenSteam after July 5, 2026, constitutes acceptance of these terms. 
              Questions? <a href="https://discord.gg/4RdMhcYws" target="_blank" rel="noopener noreferrer" className="text-indigo-400 hover:underline">Join our Discord</a>.
            </p>
          </div>
        </section>

        <footer className="mt-24 py-12 border-t border-white/5">
          <div className="container mx-auto px-6 flex flex-col items-center justify-center space-y-4">
            <div className="flex space-x-6">
              <a href="https://discord.gg/4RdMhcYws" target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-indigo-400 transition-colors text-sm font-medium">Join Discord</a>
            </div>
            <div className="flex items-center space-x-2 text-white/40 text-sm font-medium">
              <img src="/opensteam.png?v=20260810" alt="OpenSteam" className="w-5 h-5 opacity-40 grayscale" />
              <span>© 2026 OpenSteam Platform. All Rights Reserved.</span>
            </div>
          </div>
        </footer>
      </main>
    </div>
  )
}
