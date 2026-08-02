'use client'

import { ShieldCheck, ArrowLeft, Eye, Fingerprint, Lock, Globe } from 'lucide-react'
import { useRouter } from 'next/navigation'

export default function PrivacyPage() {
  const router = useRouter()

  return (
    <div className="min-h-screen bg-background relative selection:bg-indigo-500/30 text-white">
      <div className="fixed top-[-20%] left-[-10%] w-[50%] h-[50%] rounded-full bg-indigo-500/10 blur-[120px] pointer-events-none" />
      
      <nav className="sticky top-0 z-50 glass border-b-white/5 border-t-0 border-x-0 rounded-none w-full">
        <div className="container mx-auto px-6 py-4 flex justify-between items-center">
          <div className="flex items-center space-x-3 cursor-pointer" onClick={() => router.push('/')}>
            <div className="hover:scale-110 transition-transform">
              <img src="/favicon.ico" alt="OpenSteam" className="h-7 w-7" />
            </div>
            <span className="text-xl font-bold tracking-tight">OpenSteam <span className="text-indigo-400">Privacy</span></span>
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
            <Lock className="h-4 w-4" />
            <span>Data Transparency</span>
          </div>
          <h1 className="text-4xl font-extrabold tracking-tight mb-4">Privacy Policy</h1>
          <p className="text-lg text-muted-foreground italic">Last Updated: July 5, 2026</p>
        </header>

        <section className="space-y-12">
          {/* What we grab */}
          <div className="space-y-6">
            <h2 className="text-2xl font-bold flex items-center space-x-3">
              <Eye className="h-6 w-6 text-indigo-400" />
              <span>1. Comprehensive Data Disclosure</span>
            </h2>
            <p className="text-muted-foreground text-sm leading-relaxed">
              To provide our metadata services and maintain the security of our manifest database, we collect specific identifiers whenever you interact with our Web UI or programmatic API.
            </p>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="glass p-6 rounded-2xl border-white/5">
                <div className="flex items-center space-x-3 mb-3">
                  <Fingerprint className="h-5 w-5 text-indigo-400" />
                  <h3 className="text-sm font-bold text-white uppercase tracking-wider">Device Fingerprinting</h3>
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  We generate a unique cryptographic hash (Fingerprint) based on your hardware and browser configuration. This is used to track "burst" abuse and prevent automated scraping from rotating IPs.
                </p>
              </div>
              
              <div className="glass p-6 rounded-2xl border-white/5">
                <div className="flex items-center space-x-3 mb-3">
                  <Globe className="h-5 w-5 text-indigo-400" />
                  <h3 className="text-sm font-bold text-white uppercase tracking-wider">Network Identifiers</h3>
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  We log your **IP Address** and **User-Agent** for every request. This data is fed into our Smart Firewall to distinguish between legitimate developers and malicious botnets.
                </p>
              </div>
            </div>

            <div className="glass p-6 rounded-2xl border-white/5 space-y-3">
              <h3 className="text-sm font-bold text-white uppercase tracking-wider">Authentication & Integrations Data</h3>
              <p className="text-xs text-muted-foreground leading-relaxed">
                When you log in via Discord, we collect your **Discord ID**, **Username**, and **Avatar URL**. If you link your Telegram account to our bot, we collect your **Telegram ID** and **Telegram Username** to provide cross-platform services. We do not access your passwords or private platform data.
              </p>
            </div>

            <div className="glass p-6 rounded-2xl border-white/5 space-y-3">
              <h3 className="text-sm font-bold text-white uppercase tracking-wider">Discord Server Verification</h3>
              <p className="text-xs text-muted-foreground leading-relaxed">
                To access our Discord community, you complete verification at **opensteam.lol/verify** via a link from our bot. During verification we collect your **IP address**, **country**, **browser fingerprint**, **email** (via Discord OAuth), **linked connections**, **guild list snapshot**, and **account creation date**. We cross-check these signals against existing accounts to flag possible alternate accounts. VPN and proxy connections are blocked during the final verify step.
              </p>
            </div>
          </div>

          {/* Cookies & Tracking */}
          <div className="space-y-6">
            <h2 className="text-2xl font-bold flex items-center space-x-3">
              <Globe className="h-6 w-6 text-blue-400" />
              <span>2. Cookies & Local Storage</span>
            </h2>
            <div className="glass p-6 rounded-2xl border-white/5 text-sm text-muted-foreground leading-relaxed">
              <p>
                We use essential cookies and browser LocalStorage to maintain your session and preferences. These are necessary for the platform to function (e.g., keeping you logged in). We do not use third-party tracking cookies or advertising pixels.
              </p>
            </div>
          </div>

          {/* How we use it */}
          <div className="space-y-6">
            <h2 className="text-2xl font-bold flex items-center space-x-3">
              <ShieldCheck className="h-6 w-6 text-emerald-400" />
              <span>3. Security Enforcement & Usage</span>
            </h2>
            <div className="glass p-8 rounded-[2.5rem] border-emerald-500/20 bg-emerald-500/5">
              <p className="text-sm text-emerald-100/80 leading-relaxed mb-4">
                The data collected is utilized primarily for the **OpenSteam Smart Firewall** and internal service optimization.
              </p>
              <ul className="text-xs space-y-3 text-muted-foreground list-disc pl-5">
                <li><strong className="text-white">Abuse Scoring</strong>: We calculate an abuse score for every IP and account. High-frequency AppID variations (scraping patterns) trigger an automatic 24-hour IP jail.</li>
                <li><strong className="text-white">Fraud Prevention</strong>: Multiple accounts tied to the same hardware fingerprint or payment method will be flagged for investigation.</li>
                <li><strong className="text-white">Internal Audit</strong>: Administrative actions (bans, plan changes) are recorded internally for security compliance and troubleshooting.</li>
              </ul>
            </div>
          </div>

          {/* Data Sharing */}
          <div className="space-y-6">
            <h2 className="text-2xl font-bold flex items-center space-x-3">
              <Lock className="h-6 w-6 text-purple-400" />
              <span>4. Data Retention & Sharing</span>
            </h2>
            <div className="glass p-6 rounded-2xl border-white/5 text-sm text-muted-foreground leading-relaxed">
              <p>
                We do not sell your personal information or API usage data to third parties. Data is retained only as long as necessary for platform security and billing reconciliation. 
                <br/><br/>
                API usage logs (request history) are automatically purged after 90 days. Basic account records (Discord ID, Plan status, and hash-based ban lists) are maintained as long as the account remains active or for the duration required by legal obligations.
              </p>
            </div>
          </div>

          {/* Your Rights */}
          <div className="space-y-6">
            <h2 className="text-2xl font-bold flex items-center space-x-3">
              <Fingerprint className="h-6 w-6 text-amber-400" />
              <span>5. User Privacy Rights (GDPR/CCPA)</span>
            </h2>
            <div className="glass p-6 rounded-2xl border-white/5 text-sm text-muted-foreground leading-relaxed space-y-4">
              <p>
                Depending on your residency, you possess rights regarding your personal data. These include:
              </p>
              <ul className="list-disc pl-5 space-y-2 text-xs">
                <li><strong className="text-white">The Right to Access</strong>: Request copies of your personal data.</li>
                <li><strong className="text-white">The Right to Rectification</strong>: Request correction of inaccurate information.</li>
                <li><strong className="text-white">The Right to Erasure</strong>: Request deletion of data, subject to security constraints (e.g., ban persistence).</li>
                <li><strong className="text-white">The Right to Portability</strong>: Request transfer of your data to another service.</li>
              </ul>
              <p>
                To exercise these rights, please contact us via Discord. We will respond to your request within 30 days.
              </p>
            </div>
          </div>

          {/* Third Party Services */}
          <div className="space-y-6">
            <h2 className="text-2xl font-bold flex items-center space-x-3">
              <ShieldCheck className="h-6 w-6 text-cyan-400" />
              <span>6. Third-Party Partners (Pandabase, Discord & Telegram)</span>
            </h2>
            <div className="glass p-6 rounded-2xl border-white/5 space-y-4 text-sm text-muted-foreground leading-relaxed">
              <p>
                We utilize <strong className="text-white">Discord Inc.</strong> and <strong className="text-white">Telegram</strong> for authentication and bot services, and <strong className="text-white">Pandabase</strong> (https://pandabase.io) for payment processing and checkout services. When using these services, you are also subject to their respective Privacy Policies and Terms of Service.
              </p>
              <p>
                <strong className="text-white">Pandabase Payment Information</strong>: We do not store your credit card details, billing addresses, or detailed transaction records on our own servers. This data is handled exclusively by Pandabase. 
              </p>
              <p className="border-l-2 border-indigo-500/30 pl-4 py-1 italic">
                <strong className="text-white uppercase tracking-tighter">Limitation of Liability</strong>: OpenSteam and its operators are not responsible for any security incidents, data leaks, or unauthorized access that occurs within the infrastructure of our third-party partners (including Discord, Telegram, and Pandabase).
              </p>
            </div>
          </div>

          {/* Children's Privacy */}
          <div className="space-y-6">
            <h2 className="text-2xl font-bold flex items-center space-x-3">
              <Lock className="h-6 w-6 text-rose-400" />
              <span>7. Children&apos;s Privacy</span>
            </h2>
            <div className="glass p-6 rounded-2xl border-white/5 text-sm text-muted-foreground leading-relaxed">
              <p>
                Our services are not intended for children under the age of 13. We do not knowingly collect personal information from children. If we become aware that a child under 13 has provided us with personal information, we will take steps to delete such information immediately.
              </p>
            </div>
          </div>
 
          {/* Data Security Section */}
          <div className="space-y-6">
            <h2 className="text-2xl font-bold flex items-center space-x-3">
              <ShieldCheck className="h-6 w-6 text-indigo-400" />
              <span>8. Data Security & Protection</span>
            </h2>
            <div className="glass p-6 rounded-2xl border-white/5 text-sm text-muted-foreground leading-relaxed space-y-4">
              <p>
                We implement industry-standard security measures to protect your data, including **TLS/SSL encryption** for all data in transit and hardware-level isolation for our primary databases.
              </p>
              <p>
                While we strive to use commercially acceptable means to protect your personal information, no method of transmission over the Internet, or method of electronic storage is 100% secure.
              </p>
            </div>
          </div>

          {/* Board of Directors */}
          <div className="space-y-6">
            <h2 className="text-2xl font-bold flex items-center space-x-3">
              <ShieldCheck className="h-6 w-6 text-red-400" />
              <span className="text-red-400">9. Board of Directors & Corporate Liability</span>
            </h2>
            <div className="glass p-6 rounded-2xl border-red-500/30 bg-red-500/10 text-sm leading-relaxed space-y-4">
              <p className="text-red-100 font-bold">
                Upon reaching the rank of Board of Directors (or equivalent executive/owner rank), you officially belong under the company. As such, you hold the responsibility as-is and fall under everything regarding company liabilities, operations, decisions, and obligations.
              </p>
            </div>
          </div>

          <div className="pt-8 text-center border-t border-white/5">
            <p className="text-xs text-muted-foreground italic">
              By using our platform after July 5, 2026, you consent to the storage and processing of the data mentioned above.
              Concerns? <a href="https://discord.gg/4RdMhcYws" target="_blank" rel="noopener noreferrer" className="text-indigo-400 hover:underline">Contact us on Discord</a>.
            </p>
          </div>
        </section>

        <footer className="mt-24 py-12 border-t border-white/5">
          <div className="container mx-auto px-6 flex flex-col items-center justify-center space-y-4">
            <div className="flex space-x-6">
              <a href="https://discord.gg/4RdMhcYws" target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-indigo-400 transition-colors text-sm font-medium">Join Discord</a>
            </div>
            <div className="flex items-center space-x-2 text-white/40 text-sm font-medium">
              <img src="/favicon.ico" alt="OpenSteam" className="w-5 h-5 opacity-40 grayscale" />
              <span>© 2026 OpenSteam Platform. Powered by OpenSteam.</span>
            </div>
          </div>
        </footer>
      </main>
    </div>
  )
}
