'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { 
  Rocket, 
  LayoutDashboard, 
  Terminal, 
  ShieldAlert, 
  MessageSquare, 
  ArrowRight, 
  ArrowLeft, 
  Check, 
  Zap, 
  Shield, 
  CheckCircle,
  Code,
  UserCheck
} from 'lucide-react';

interface Step {
  id: number;
  title: string;
  subtitle: string;
  icon: any;
  accent: string;
}

export default function WelcomePage() {
  const router = useRouter();
  const [currentStep, setCurrentStep] = useState(0);

  const steps: Step[] = [
    {
      id: 0,
      title: 'Welcome to OpenSteam',
      subtitle: 'Your ultimate hub for game manifests',
      icon: Rocket,
      accent: 'from-indigo-500 to-purple-600 shadow-indigo-500/20',
    },
    {
      id: 1,
      title: 'The User Dashboard',
      subtitle: 'Instant search and manifest generations',
      icon: LayoutDashboard,
      accent: 'from-cyan-500 to-blue-600 shadow-cyan-500/20',
    },
    {
      id: 2,
      title: 'Developer APIs & Integration',
      subtitle: 'Programmatic manifest updates for your pipeline',
      icon: Terminal,
      accent: 'from-purple-500 to-pink-600 shadow-purple-500/20',
    },
    {
      id: 3,
      title: 'Sentinel Security Shield',
      subtitle: 'Advanced rate limiting and threat protection',
      icon: ShieldAlert,
      accent: 'from-rose-500 to-orange-600 shadow-rose-500/20',
    },
    {
      id: 4,
      title: 'Discord Guild Verification',
      subtitle: 'Required before accessing the platform',
      icon: UserCheck,
      accent: 'from-violet-500 to-indigo-600 shadow-violet-500/20',
    },
    {
      id: 5,
      title: 'Discord Bot Integration',
      subtitle: 'Generate Steam manifests directly in Discord',
      icon: MessageSquare,
      accent: 'from-emerald-500 to-teal-600 shadow-emerald-500/20',
    },
  ];

  const handleNext = () => {
    if (currentStep < steps.length - 1) {
      setCurrentStep(currentStep + 1);
    } else {
      // Mark onboarding as completed in local storage
      localStorage.setItem('gamegen_seen_welcome', 'true');
      router.push('/');
    }
  };

  const handleBack = () => {
    if (currentStep > 0) {
      setCurrentStep(currentStep - 1);
    }
  };

  const CurrentIcon = steps[currentStep].icon;

  return (
    <div className="min-h-screen bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-slate-950 via-[#09090b] to-black text-gray-200 font-sans antialiased selection:bg-indigo-500/30 selection:text-white flex flex-col justify-between p-6">
      
      {/* Top Header */}
      <header className="max-w-4xl w-full mx-auto flex items-center justify-between py-4">
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-indigo-500 animate-pulse"></span>
          <span className="text-xs font-extrabold uppercase tracking-wider text-gray-400">OpenSteam Onboarding</span>
        </div>
        <button 
          onClick={() => {
            localStorage.setItem('gamegen_seen_welcome', 'true');
            router.push('/');
          }}
          className="text-xs font-semibold text-gray-500 hover:text-white transition-all uppercase tracking-wider bg-white/5 hover:bg-white/10 px-3 py-1.5 rounded-lg border border-white/5"
        >
          Skip Tour
        </button>
      </header>

      {/* Main Core Carousel */}
      <main className="max-w-3xl w-full mx-auto bg-[#101014]/60 border border-white/5 rounded-3xl p-8 md:p-12 shadow-[0_0_50px_rgba(99,102,241,0.02)] relative overflow-hidden flex flex-col md:flex-row gap-10 items-center justify-center min-h-[480px]">
        {/* Glow behind */}
        <div className="absolute top-0 right-0 w-[300px] h-[300px] bg-indigo-600/5 rounded-full blur-[100px] -z-10" />

        {/* Slide illustrations */}
        <div className="w-full md:w-1/3 flex flex-col items-center justify-center text-center space-y-4">
          <div className={`w-24 h-24 rounded-3xl bg-gradient-to-br ${steps[currentStep].accent} flex items-center justify-center border border-white/10 shadow-lg text-white`}>
            <CurrentIcon className="w-10 h-10 animate-pulse" />
          </div>
          
          <div className="space-y-1">
            <span className="text-[10px] uppercase font-bold text-gray-500 tracking-wider">Step {currentStep + 1} of {steps.length}</span>
            <h2 className="text-lg font-bold text-white tracking-wide leading-snug">{steps[currentStep].title}</h2>
          </div>
        </div>

        {/* Dynamic step descriptions and layout maps */}
        <div className="flex-1 w-full space-y-6">
          {currentStep === 0 && (
            <div className="space-y-4">
              <h3 className="text-xl font-extrabold text-white tracking-tight">Step into the Network</h3>
              <p className="text-sm text-gray-400 leading-relaxed font-medium">
                OpenSteam manifests is a specialized high-performance repository serving encrypted Steam game manifests. This walkthrough will guide you through our base interface tools, securing keys, and triggering programmatic automation.
              </p>
              
              <div className="bg-indigo-500/[0.03] border border-indigo-500/10 rounded-2xl p-4 flex gap-3.5">
                <Zap className="w-5 h-5 text-indigo-400 flex-shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <h4 className="text-xs font-bold text-white">Direct CDN Access</h4>
                  <p className="text-xs text-gray-400 leading-relaxed">Instantly obtain decryption keys, drops, and manifest files cached directly from high-speed storage.</p>
                </div>
              </div>
            </div>
          )}

          {currentStep === 1 && (
            <div className="space-y-4">
              <h3 className="text-xl font-extrabold text-white tracking-tight">Navigating the Dashboard</h3>
              <p className="text-sm text-gray-400 leading-relaxed font-medium">
                The **User Dashboard** is your primary generation zone. It provides simple interface wrappers to query any Steam Game by ID.
              </p>
              
              <div className="space-y-3 bg-black/40 border border-white/5 rounded-2xl p-4">
                <div className="flex items-center gap-2 text-xs font-bold text-white border-b border-white/5 pb-2">
                  <LayoutDashboard className="w-4 h-4 text-cyan-400" />
                  Core Dashboard Components
                </div>
                <ul className="space-y-2.5 text-xs text-gray-400 font-medium">
                  <li className="flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-cyan-400" />
                    <strong>App ID Generator</strong>: Enter the Steam App ID to instantly generate its manifest.
                  </li>
                  <li className="flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-cyan-400" />
                    <strong>Cache Hit (Zero Quota)</strong>: If a manifest is already generated, downloads are completely free and don't count towards limits!
                  </li>
                  <li className="flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-cyan-400" />
                    <strong>Daily Web Limit</strong>: Monitors your quota. If exhausted, you can trade API quota directly to generate more.
                  </li>
                </ul>
              </div>
            </div>
          )}

          {currentStep === 2 && (
            <div className="space-y-4">
              <h3 className="text-xl font-extrabold text-white tracking-tight">Programmatic API Keys</h3>
              <p className="text-sm text-gray-400 leading-relaxed font-medium">
                Automate your custom installers, scripts, and download pipelines using our developer-first API tokens.
              </p>

              <div className="space-y-3 bg-black/50 border border-white/5 rounded-2xl p-4">
                <div className="flex items-center justify-between text-xs font-mono text-gray-400 border-b border-white/5 pb-2">
                  <span className="flex items-center gap-2 font-bold text-white font-sans">
                    <Code className="w-4 h-4 text-purple-400" />
                    Developer endpoint
                  </span>
                  <span>GET /api/manifests/[appId]</span>
                </div>
                <div className="font-mono text-[10px] text-purple-300 leading-relaxed bg-black/60 p-2.5 rounded-lg border border-white/5 overflow-x-auto">
                  curl -H "Authorization: Bearer your_api_key_here" \<br />
                  &nbsp;&nbsp;&nbsp;&nbsp;"http://127.0.0.1:3000/api/manifests/730"
                </div>
                <div className="text-[11px] text-gray-400 font-medium leading-relaxed">
                  Generate tokens inside the <strong>Developer Settings</strong> page. Configure rate limits and webhook alerts to monitor remote executions dynamically.
                </div>
              </div>
            </div>
          )}

          {currentStep === 3 && (
            <div className="space-y-4">
              <h3 className="text-xl font-extrabold text-white tracking-tight">Sentinel Firewall Threat Engine</h3>
              <p className="text-sm text-gray-400 leading-relaxed font-medium">
                Our active system-wide threat detection layer protects OpenSteam endpoints from abuse, credential leaks, and scraping.
              </p>

              <div className="grid grid-cols-2 gap-3">
                <div className="bg-rose-950/10 border border-rose-500/10 rounded-xl p-3.5 space-y-1">
                  <h4 className="text-xs font-bold text-rose-400">Risk Score & Jail</h4>
                  <p className="text-[10px] text-gray-400 leading-relaxed">Abusive behaviors increase your risk score. Excess risk triggers automatic jail suspension.</p>
                </div>
                <div className="bg-indigo-950/10 border border-indigo-500/10 rounded-xl p-3.5 space-y-1">
                  <h4 className="text-xs font-bold text-indigo-400">Sentinel Shields</h4>
                  <p className="text-[10px] text-gray-400 leading-relaxed">Purchase unban shields in the shop to completely block scans and auto-jail flags.</p>
                </div>
              </div>
            </div>
          )}

          {currentStep === 4 && (
            <div className="space-y-4">
              <h3 className="text-xl font-extrabold text-white tracking-tight">Discord Verification</h3>
              <p className="text-sm text-gray-400 leading-relaxed font-medium">
                After signing in with Discord, you must verify in the OpenSteam Discord server before using the web dashboard or API.
              </p>
              
              <div className="space-y-3 bg-black/40 border border-white/5 rounded-2xl p-4">
                <div className="flex items-center gap-2 text-xs font-bold text-white border-b border-white/5 pb-2">
                  <UserCheck className="w-4 h-4 text-violet-400" />
                  Verification steps
                </div>
                <ul className="space-y-2 text-xs text-gray-400 font-medium">
                  <li className="flex items-center gap-2">
                    <CheckCircle className="w-4 h-4 text-violet-400 flex-shrink-0" />
                    Join the OpenSteam Discord server and click the <strong>Verify</strong> button.
                  </li>
                  <li className="flex items-center gap-2">
                    <CheckCircle className="w-4 h-4 text-violet-400 flex-shrink-0" />
                    Complete OAuth and security checks on the verification page.
                  </li>
                  <li className="flex items-center gap-2">
                    <CheckCircle className="w-4 h-4 text-violet-400 flex-shrink-0" />
                    If you leave the server, you will need to re-verify to restore access.
                  </li>
                </ul>
              </div>
            </div>
          )}

          {currentStep === 5 && (
            <div className="space-y-4">
              <h3 className="text-xl font-extrabold text-white tracking-tight">Discord Guild Operations</h3>
              <p className="text-sm text-gray-400 leading-relaxed font-medium">
                Integrate OpenSteam directly into your server. Verified users can invoke automated manifest creation from Discord channels.
              </p>
              
              <div className="space-y-3 bg-black/40 border border-white/5 rounded-2xl p-4">
                <div className="flex items-center gap-2 text-xs font-bold text-white border-b border-white/5 pb-2">
                  <MessageSquare className="w-4 h-4 text-emerald-400" />
                  Discord Bot Capabilities
                </div>
                <ul className="space-y-2 text-xs text-gray-400 font-medium">
                  <li className="flex items-center gap-2">
                    <CheckCircle className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                    Slash Command: <code className="text-emerald-300">/gen 730</code> — numeric Steam App ID only.
                  </li>
                  <li className="flex items-center gap-2">
                    <CheckCircle className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                    <strong>Private ZIP dispatch</strong>: Manifest download embeds show in-channel for everyone, while the generated ZIP drops directly inside your private DMs!
                  </li>
                </ul>
              </div>
            </div>
          )}
        </div>
      </main>

      {/* Bottom Progress Navigation */}
      <footer className="max-w-3xl w-full mx-auto flex items-center justify-between py-6">
        <button
          onClick={handleBack}
          disabled={currentStep === 0}
          className="flex items-center gap-2 text-xs font-semibold text-gray-400 hover:text-white disabled:opacity-30 disabled:pointer-events-none transition-all uppercase tracking-wider"
        >
          <ArrowLeft className="w-4 h-4" />
          Back
        </button>

        {/* Step dots */}
        <div className="flex gap-2.5">
          {steps.map((step) => (
            <div
              key={step.id}
              onClick={() => setCurrentStep(step.id)}
              className={`h-2.5 rounded-full transition-all cursor-pointer ${
                currentStep === step.id ? 'w-8 bg-indigo-500 shadow-md shadow-indigo-500/20' : 'w-2.5 bg-white/10 hover:bg-white/20'
              }`}
            />
          ))}
        </div>

        <button
          onClick={handleNext}
          className="flex items-center gap-2 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-500 px-5 py-2.5 rounded-xl border border-indigo-500/20 shadow-lg shadow-indigo-950/40 transition-all uppercase tracking-wider"
        >
          {currentStep === steps.length - 1 ? 'Finish Tour' : 'Next'}
          {currentStep === steps.length - 1 ? <Check className="w-4 h-4" /> : <ArrowRight className="w-4 h-4" />}
        </button>
      </footer>

    </div>
  );
}
