'use client';
import { useState } from 'react';
import { PandabaseCheckoutEmbed } from "@/app/components/PandabaseCheckout";
import { X, Sparkles } from 'lucide-react';

interface Appeal {
  id: string;
  action: 'APPEAL_SUBMITTED' | 'APPEAL_ACCEPTED' | 'APPEAL_DECLINED';
  createdAt: string;
  reason: string;
}

export default function AppealForm({ userId, initialAppeals = [] }: { userId: string; initialAppeals?: Appeal[] }) {
  const [appeals, setAppeals] = useState<Appeal[]>(initialAppeals);
  const [loading, setLoading] = useState(false);
  const [reactivating, setReactivating] = useState(false);
  const [status, setStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [reactivateError, setReactivateError] = useState<string | null>(null);

  // Paid Unban states
  const [checkoutSessionId, setCheckoutSessionId] = useState<string | null>(null);
  const [checkoutStoreId, setCheckoutStoreId] = useState<string | null>(null);
  const [purchasing, setPurchasing] = useState(false);
  const [purchaseError, setPurchaseError] = useState<string | null>(null);

  // Latest appeal is the first in the desc sorted list
  const latestAppeal = appeals[0];
  const hasPending = latestAppeal?.action === 'APPEAL_SUBMITTED';
  const hasAccepted = latestAppeal?.action === 'APPEAL_ACCEPTED';

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setStatus('idle');
    const formData = new FormData(e.currentTarget);
    const reason = formData.get('reason') as string;

    try {
      const res = await fetch('/api/appeals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, reason })
      });
      if (res.ok) {
        setStatus('success');
        // Update local appeal state to reflect submission immediately
        const newAppeal: Appeal = {
          id: Math.random().toString(),
          action: 'APPEAL_SUBMITTED',
          createdAt: new Date().toISOString(),
          reason
        };
        setAppeals([newAppeal, ...appeals]);
        e.currentTarget.reset();
      } else {
        setStatus('error');
      }
    } catch {
      setStatus('error');
    }
    setLoading(false);
  }

  async function handleBuyUnban() {
    setPurchasing(true);
    setPurchaseError(null);
    try {
      const res = await fetch('/api/pandabase/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planName: 'UNBAN' })
      });
      const data = await res.json();
      if (res.ok && data.sessionId && data.storeId) {
        setCheckoutStoreId(data.storeId);
        setCheckoutSessionId(data.sessionId);
      } else {
        setPurchaseError(data.error || 'Failed to initiate checkout.');
      }
    } catch {
      setPurchaseError('Network error. Please try again.');
    } finally {
      setPurchasing(false);
    }
  }

  async function handleReactivate() {
    setReactivating(true);
    setReactivateError(null);
    try {
      const res = await fetch('/api/appeals/reactivate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId })
      });
      if (res.ok) {
        // Redirect to homepage/dashboard since the ban & IP lock are cleared!
        window.location.href = '/';
      } else {
        const data = await res.json();
        setReactivateError(data.error || 'Failed to reactivate account.');
      }
    } catch {
      setReactivateError('Network error. Please try again.');
    }
    setReactivating(false);
  }

  const getBadgeStyle = (action: Appeal['action']) => {
    switch (action) {
      case 'APPEAL_SUBMITTED':
        return 'bg-amber-500/10 text-amber-400 border-amber-500/20';
      case 'APPEAL_ACCEPTED':
        return 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20';
      case 'APPEAL_DECLINED':
        return 'bg-rose-500/10 text-rose-400 border-rose-500/20';
    }
  };

  const getStatusLabel = (action: Appeal['action']) => {
    switch (action) {
      case 'APPEAL_SUBMITTED':
        return 'Pending';
      case 'APPEAL_ACCEPTED':
        return 'Accepted';
      case 'APPEAL_DECLINED':
        return 'Declined';
    }
  };

  return (
    <div className="space-y-6">
      {/* 1. Active State Block */}
      {hasPending && (
        <div className="bg-[#241c15] border border-amber-500/20 rounded-xl p-5 space-y-3">
          <div className="flex items-center gap-2 text-amber-400 font-semibold text-sm">
            <svg className="w-5 h-5 animate-pulse" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span>Appeal Sent & Under Review</span>
          </div>
          <p className="text-gray-300 text-sm italic leading-relaxed">
            "{latestAppeal.reason}"
          </p>
          <div className="text-xs text-[#a1a1aa] flex justify-between pt-1">
            <span>Submitted on {new Date(latestAppeal.createdAt).toLocaleString()}</span>
            <span className="font-semibold text-amber-500">Pending Response</span>
          </div>
        </div>
      )}

      {hasAccepted && (
        <div className="bg-[#14291f] border border-emerald-500/20 rounded-xl p-5 space-y-4">
          <div className="flex items-center gap-2 text-emerald-400 font-semibold text-sm">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span>Your Appeal was Accepted!</span>
          </div>
          <p className="text-gray-300 text-sm leading-relaxed">
            Your appeal was reviewed and approved by administrators. You are now free to reactivate your account and clear all IP locks.
          </p>
          
          <button
            onClick={handleReactivate}
            disabled={reactivating}
            className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-semibold py-3 px-4 rounded-xl transition-all shadow-lg shadow-emerald-900/20 hover:shadow-emerald-950/40 flex items-center justify-center gap-2 text-sm"
          >
            {reactivating ? (
              <>
                <svg className="animate-spin h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                Reactivating...
              </>
            ) : (
              'Reactivate My Account'
            )}
          </button>

          {reactivateError && (
            <p className="text-red-400 text-xs text-center font-medium mt-1">{reactivateError}</p>
          )}
        </div>
      )}

      {/* 2. Instant Paid Unban Option */}
      {!hasPending && !hasAccepted && (
        <div className="bg-gradient-to-r from-red-950/40 via-orange-950/30 to-red-950/40 border border-orange-500/25 rounded-2xl p-6 space-y-4 shadow-[0_0_50px_rgba(249,115,22,0.05)] relative overflow-hidden group">
          <div className="absolute top-0 left-0 w-full h-[3px] bg-gradient-to-r from-orange-500 via-red-500 to-orange-500 shadow-md"></div>
          
          <div className="flex items-center gap-2.5 text-orange-400 font-bold text-sm tracking-wide uppercase">
            <Sparkles className="w-5 h-5 text-orange-400 animate-pulse" />
            <span>⚡ Instant Paid Unban Option</span>
          </div>
          
          <p className="text-gray-300 text-sm leading-relaxed">
            Don't want to wait for manual staff review? Pay a small **$5.00** processing fee to instantly reactivate your account, restore API access, and clear all local IP firewalls.
          </p>
          
          <button
            type="button"
            onClick={handleBuyUnban}
            disabled={purchasing}
            className="w-full bg-gradient-to-r from-orange-500 via-red-600 to-orange-600 hover:from-orange-400 hover:to-red-500 text-white font-black py-3.5 px-4 rounded-xl transition-all shadow-lg shadow-orange-950/20 active:scale-[0.97] flex items-center justify-center gap-2 text-xs uppercase tracking-widest disabled:opacity-50"
          >
            {purchasing ? (
              <>
                <svg className="animate-spin h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                Initiating Checkout...
              </>
            ) : (
              '⚡ Buy Instant Unban ($5.00)'
            )}
          </button>
          
          {purchaseError && (
            <p className="text-red-400 text-xs text-center font-semibold mt-1">{purchaseError}</p>
          )}
        </div>
      )}

      {/* 3. Interactive Appeal Form */}
      {!hasPending && !hasAccepted && (
        <div className="space-y-4">
          <h2 className="text-lg font-semibold text-white mb-1">Submit an Appeal</h2>
          <p className="text-sm text-[#a1a1aa] mb-4">
            If you believe this restriction was made in error or your account was compromised, please explain why it should be reinstated below.
          </p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <textarea
                name="reason"
                required
                rows={4}
                placeholder="Explain the circumstances and why your account should be reinstated..."
                className="w-full bg-[#09090b] border border-[#27272a] rounded-xl p-3 text-sm text-gray-200 placeholder-[#71717a] focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all resize-none"
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-semibold py-2.5 px-4 rounded-xl transition-all disabled:opacity-50 flex items-center justify-center gap-2 text-sm shadow-md"
            >
              {loading ? (
                <>
                  <svg className="animate-spin h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  Submitting...
                </>
              ) : (
                'Submit Appeal'
              )}
            </button>
            {status === 'error' && (
              <p className="text-red-400 text-xs text-center font-medium">There was an error submitting your appeal. Please try again.</p>
            )}
          </form>
        </div>
      )}

      {/* 3. History Display */}
      {appeals.length > 0 && (
        <div className="pt-6 border-t border-[#27272a] space-y-4">
          <h3 className="text-sm font-semibold text-white uppercase tracking-wider">Appeal History</h3>
          <div className="space-y-3">
            {appeals.map((appeal) => (
              <div key={appeal.id} className="bg-[#18181b] border border-[#27272a] rounded-xl p-4 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-[#a1a1aa]">{new Date(appeal.createdAt).toLocaleDateString()}</span>
                  <span className={`px-2 py-0.5 rounded border text-[10px] font-semibold tracking-wide uppercase ${getBadgeStyle(appeal.action)}`}>
                    {getStatusLabel(appeal.action)}
                  </span>
                </div>
                <p className="text-gray-300 text-xs leading-relaxed italic">
                  "{appeal.reason}"
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Pandabase Checkout Modal Overlay */}
      {checkoutSessionId && checkoutStoreId && (
        <div 
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-md p-4 animate-in fade-in"
          onClick={() => { setCheckoutSessionId(null); setCheckoutStoreId(null); }}
        >
          <div 
            className="relative w-full max-w-lg max-h-[90vh] overflow-y-auto bg-[#0c0c0e] rounded-[2rem] border border-white/5 shadow-2xl ring-1 ring-white/10 flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header Area */}
            <div className="flex justify-between items-center p-6 pb-2">
              <div className="flex items-center space-x-2">
                <Sparkles className="h-5 w-5 text-indigo-400" />
                <h3 className="text-white font-bold text-lg">Complete Checkout</h3>
              </div>
              <button
                onClick={() => { setCheckoutSessionId(null); setCheckoutStoreId(null); }}
                className="p-2 text-white/50 hover:text-white hover:bg-white/10 rounded-full transition-all"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            
            {/* Embed Area */}
            <div className="w-full">
              <PandabaseCheckoutEmbed
                storeId={checkoutStoreId}
                sessionId={checkoutSessionId}
                theme="dark"
                returnUrl={typeof window !== 'undefined' ? `${window.location.origin}/` : 'http://127.0.0.1:3000/'}
                onComplete={async (orderId) => {
                  console.log("Paid:", orderId);
                  setCheckoutSessionId(null);
                  setCheckoutStoreId(null);
                  // Refresh page to trigger active ban status lookup
                  window.location.href = '/';
                }}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
