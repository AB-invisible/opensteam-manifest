'use client';

import { useState, useEffect } from 'react';
import { Send, MessageSquare, ShieldCheck, Zap, ArrowLeft, Loader2, Clock, CheckCircle2, XCircle } from 'lucide-react';
import Link from 'next/link';
import { useSession } from 'next-auth/react';

export default function SupportPage() {
  const { data: session } = useSession();
  const [formData, setFormData] = useState({
    discordUsername: '',
    discordId: '',
    email: '',
    subject: '',
    message: ''
  });
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [ticketId, setTicketId] = useState('');
  const [error, setError] = useState('');
  const [tickets, setTickets] = useState<any[]>([]);
  const [fetchingTickets, setFetchingTickets] = useState(false);
  const [selectedUserTicket, setSelectedUserTicket] = useState<any | null>(null);
  const [userReplyText, setUserReplyText] = useState('');
  const [userReplying, setUserReplying] = useState(false);

  const handleUserReply = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedUserTicket || !userReplyText.trim()) return;
    setUserReplying(true);
    setError('');

    try {
      const res = await fetch('/api/support', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ticketId: selectedUserTicket.id,
          reply: userReplyText
        })
      });

      const data = await res.json();
      if (res.ok) {
        const newReply = data.reply;
        const updatedTicket = {
          ...selectedUserTicket,
          status: 'OPEN',
          replies: [...(selectedUserTicket.replies || []), newReply]
        };
        setSelectedUserTicket(updatedTicket);
        setTickets(prev => prev.map(t => t.id === selectedUserTicket.id ? updatedTicket : t));
        setUserReplyText('');
      } else {
        setError(data.error || 'Failed to send reply.');
      }
    } catch (err) {
      setError('An error occurred. Please try again.');
    } finally {
      setUserReplying(false);
    }
  };

  useEffect(() => {
    if (session?.user) {
      setFormData(prev => ({
        ...prev,
        discordUsername: session.user?.name || '',
        discordId: (session.user as any)?.discordId || '',
        email: session.user?.email || ''
      }));
      fetchTickets();
    }
  }, [session]);

  const fetchTickets = async () => {
    if (!session?.user) return;
    setFetchingTickets(true);
    try {
      const res = await fetch('/api/support');
      if (res.ok) {
        const data = await res.json();
        setTickets(data.tickets);
      }
    } catch (e) {} finally {
      setFetchingTickets(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    
    try {
      const res = await fetch('/api/support', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: `${formData.discordUsername} (${formData.discordId})`,
          email: formData.email,
          subject: formData.subject,
          message: formData.message
        })
      });

      const data = await res.json();
      if (res.ok) {
        setSuccess(true);
        // We'll need to update the API to return the ticketNumber
        setTicketId(data.ticketNumber || '');
        setFormData({ ...formData, subject: '', message: '' });
        fetchTickets();
      } else {
        setError(data.error || 'Failed to send request.');
      }
    } catch (err) {
      setError('An error occurred. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#050505] text-white font-sans selection:bg-indigo-500/30">
      {/* Background Orbs */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-indigo-500/10 blur-[120px] rounded-full animate-pulse" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-blue-500/10 blur-[120px] rounded-full animate-pulse" style={{ animationDelay: '2s' }} />
      </div>

      <div className="relative z-10 max-w-5xl mx-auto px-6 py-20">
        <Link href="/" className="inline-flex items-center space-x-2 text-zinc-500 hover:text-white transition-colors mb-12 group">
          <ArrowLeft className="h-4 w-4 transform group-hover:-translate-x-1 transition-transform" />
          <span className="text-xs font-black uppercase tracking-widest">Back to Home</span>
        </Link>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-start">
          {/* Left Side: Content & History */}
          <div className="space-y-12">
            <div className="space-y-4">
              <div className="inline-block px-3 py-1 bg-indigo-500/10 border border-indigo-500/20 rounded-full">
                <span className="text-[10px] font-black uppercase tracking-[0.2em] text-indigo-400">Support Center</span>
              </div>
              <h1 className="text-5xl lg:text-6xl font-black tracking-tighter leading-[0.9] bg-gradient-to-br from-white via-white to-zinc-500 bg-clip-text text-transparent">
                How can we <br /> help you?
              </h1>
              <p className="text-zinc-400 text-lg leading-relaxed max-w-md">
                Our infrastructure team is ready to assist you with technical integration, billing inquiries, or system access.
              </p>
            </div>

            {/* Ticket History for Logged-in Users */}
            {session && (
              <div className="space-y-6">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-black uppercase tracking-widest text-zinc-500">Your Ticket History</h3>
                  {fetchingTickets && <Loader2 className="h-4 w-4 animate-spin text-zinc-500" />}
                </div>
                
                <div className="space-y-3 max-h-[400px] overflow-y-auto pr-2 custom-scrollbar">
                  {tickets.length > 0 ? tickets.map((ticket: any) => (
                    <div 
                      key={ticket.id} 
                      onClick={() => setSelectedUserTicket(ticket)}
                      className={`p-4 bg-white/[0.02] border rounded-2xl space-y-2 hover:border-white/10 transition-colors group cursor-pointer ${
                        selectedUserTicket?.id === ticket.id ? 'border-indigo-500 bg-indigo-500/5' : 'border-white/5'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-mono text-indigo-400 font-bold tracking-tighter">{ticket.ticketNumber}</span>
                        <div className={`flex items-center space-x-1 px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-widest ${
                          ticket.status === 'OPEN' ? 'bg-indigo-500/10 text-indigo-400' : 'bg-green-500/10 text-green-400'
                        }`}>
                          {ticket.status === 'OPEN' ? <Clock className="h-2 w-2" /> : <CheckCircle2 className="h-2 w-2" />}
                          <span>{ticket.status}</span>
                        </div>
                      </div>
                      <h4 className="text-sm font-bold group-hover:text-indigo-300 transition-colors">{ticket.subject}</h4>
                      <p className="text-[10px] text-zinc-500">{new Date(ticket.createdAt).toLocaleString()}</p>
                    </div>
                  )) : !fetchingTickets && (
                    <div className="py-8 text-center bg-white/[0.01] border border-dashed border-white/5 rounded-2xl">
                      <p className="text-xs text-zinc-600">No previous support tickets found.</p>
                    </div>
                  )}
                </div>
              </div>
            )}

            {!session && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="p-6 bg-white/[0.02] border border-white/10 rounded-[2rem] space-y-3">
                  <ShieldCheck className="h-6 w-6 text-indigo-400" />
                  <h3 className="font-bold">Security</h3>
                  <p className="text-xs text-zinc-500 leading-relaxed">Report vulnerabilities or suspicious account activity.</p>
                </div>
                <div className="p-6 bg-white/[0.02] border border-white/10 rounded-[2rem] space-y-3">
                  <Zap className="h-6 w-6 text-blue-400" />
                  <h3 className="font-bold">Technical</h3>
                  <p className="text-xs text-zinc-500 leading-relaxed">Assistance with API implementation and manifest generation.</p>
                </div>
              </div>
            )}
          </div>

          {/* Right Side: Form */}
          <div className="relative group">
            <div className="absolute -inset-1 bg-gradient-to-r from-indigo-500/20 to-blue-500/20 rounded-[2.5rem] blur-xl opacity-50 group-hover:opacity-100 transition duration-1000" />
            <div className="relative bg-[#0f0f10] border border-white/10 rounded-[2.5rem] p-8 lg:p-10 shadow-2xl">
              {selectedUserTicket ? (
                <div className="space-y-6">
                  <div className="flex items-center justify-between border-b border-white/5 pb-4">
                    <div className="flex items-center space-x-2">
                      <button 
                        onClick={() => setSelectedUserTicket(null)} 
                        className="p-2 hover:bg-white/5 rounded-xl transition-all text-zinc-500 hover:text-white"
                      >
                        <ArrowLeft className="h-4 w-4" />
                      </button>
                      <div>
                        <span className="text-[10px] font-mono text-indigo-400 font-bold tracking-tighter block">{selectedUserTicket.ticketNumber}</span>
                        <h3 className="text-sm font-bold text-white leading-tight max-w-[200px] truncate">{selectedUserTicket.subject}</h3>
                      </div>
                    </div>
                    <div className={`flex items-center space-x-1 px-2.5 py-1 rounded-full text-[9px] font-black uppercase tracking-widest ${
                      selectedUserTicket.status === 'OPEN' ? 'bg-indigo-500/10 text-indigo-400' : 'bg-green-500/10 text-green-400'
                    }`}>
                      {selectedUserTicket.status === 'OPEN' ? <Clock className="h-2.5 w-2.5" /> : <CheckCircle2 className="h-2.5 w-2.5" />}
                      <span>{selectedUserTicket.status}</span>
                    </div>
                  </div>

                  {/* Chat message viewport */}
                  <div className="space-y-4 max-h-[350px] overflow-y-auto pr-2 custom-scrollbar flex flex-col">
                    {/* Message 1 (User's original inquiry) */}
                    <div className="flex flex-col space-y-1 items-end self-end w-full">
                      <div className="bg-indigo-500/10 border border-indigo-500/20 text-white rounded-2xl rounded-tr-none py-3 px-4 max-w-[85%]">
                        <p className="text-[10px] font-black text-indigo-400 uppercase tracking-widest mb-1">You</p>
                        <p className="text-xs leading-relaxed whitespace-pre-wrap">
                          {selectedUserTicket.message || <span className="italic opacity-50">No message content provided.</span>}
                        </p>
                      </div>
                      <span className="text-[9px] text-zinc-600 mr-2">{new Date(selectedUserTicket.createdAt).toLocaleString()}</span>
                    </div>

                    {/* AI Reply (if it exists) */}
                    {selectedUserTicket.aiReply && (
                      <div className="flex flex-col space-y-1 items-start self-start w-full">
                        <div className="bg-zinc-900 border border-white/5 text-white rounded-2xl rounded-tl-none py-3 px-4 max-w-[85%]">
                          <p className="text-[10px] font-black text-purple-400 uppercase tracking-widest flex items-center space-x-1 mb-1">
                            <Zap className="h-3 w-3 inline" /> <span>OpenSteam AI Agent</span>
                          </p>
                          <p className="text-xs leading-relaxed whitespace-pre-wrap">{selectedUserTicket.aiReply}</p>
                        </div>
                        <span className="text-[9px] text-zinc-600 ml-2">
                          {selectedUserTicket.aiRepliedAt ? new Date(selectedUserTicket.aiRepliedAt).toLocaleString() : new Date(selectedUserTicket.createdAt).toLocaleString()}
                        </span>
                      </div>
                    )}

                    {/* Staff Replies */}
                    {selectedUserTicket.replies?.map((rep: any) => {
                      const isUser = rep.senderRole === 'User';
                      return (
                        <div key={rep.id} className={`flex flex-col space-y-1 w-full ${isUser ? 'items-end self-end' : 'items-start self-start'}`}>
                          <div className={`py-3 px-4 rounded-2xl max-w-[85%] ${
                            isUser 
                              ? 'bg-indigo-500/10 border border-indigo-500/20 text-white rounded-tr-none' 
                              : 'bg-zinc-900 border border-white/5 text-white rounded-tl-none'
                          }`}>
                            <p className={`text-[10px] font-black mb-1 flex items-center space-x-1.5 ${
                              isUser ? 'text-indigo-400' : 'text-emerald-400'
                            }`}>
                              {!isUser && <ShieldCheck className="h-3.5 w-3.5" />}
                              <span>{rep.senderName}</span>
                              {!isUser && rep.senderRole && (
                                <span className="text-[8px] px-1.5 py-0.5 bg-emerald-500/10 border border-emerald-500/20 rounded text-emerald-400 uppercase font-black tracking-wider">
                                  {rep.senderRole}
                                </span>
                              )}
                            </p>
                            <p className="text-xs leading-relaxed whitespace-pre-wrap">
                              {rep.message || <span className="italic opacity-50">No message content provided.</span>}
                            </p>
                          </div>
                          <span className={`text-[9px] text-zinc-600 ${isUser ? 'mr-2' : 'ml-2'}`}>
                            {new Date(rep.createdAt).toLocaleString()}
                          </span>
                        </div>
                      );
                    })}
                  </div>

                  {/* Reply Input Form */}
                  {selectedUserTicket.status !== 'CLOSED' ? (
                    <form onSubmit={handleUserReply} className="pt-4 border-t border-white/5 flex gap-2">
                      <input 
                        type="text"
                        required
                        value={userReplyText}
                        onChange={(e) => setUserReplyText(e.target.value)}
                        placeholder="Type a follow-up message..."
                        className="flex-1 bg-black/40 border border-white/5 rounded-2xl py-3 px-4 text-xs text-white placeholder:text-zinc-700 focus:border-indigo-500/50 focus:ring-4 focus:ring-indigo-500/10 outline-none transition-all"
                      />
                      <button 
                        type="submit"
                        disabled={userReplying}
                        className="px-5 bg-indigo-500 hover:bg-indigo-600 disabled:opacity-50 text-white rounded-2xl transition-all flex items-center justify-center animate-pulse"
                      >
                        {userReplying ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                      </button>
                    </form>
                  ) : (
                    <div className="pt-4 border-t border-white/5 text-center py-3 bg-red-500/5 border border-red-500/10 rounded-2xl">
                      <p className="text-[10px] text-red-400 font-black uppercase tracking-widest flex items-center justify-center space-x-1">
                        <XCircle className="h-4 w-4" /> <span>This Ticket is Closed</span>
                      </p>
                    </div>
                  )}
                  {error && (
                    <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-2xl">
                      <p className="text-xs text-red-400 font-bold">{error}</p>
                    </div>
                  )}
                </div>
              ) : success ? (
                <div className="text-center py-12 space-y-6">
                  <div className="w-20 h-20 bg-green-500/10 border border-green-500/20 rounded-full flex items-center justify-center mx-auto mb-6">
                    <CheckCircle2 className="h-10 w-10 text-green-400" />
                  </div>
                  <div className="space-y-2">
                    <h2 className="text-2xl font-black tracking-tight">Request Logged</h2>
                    <p className="text-indigo-400 font-mono text-sm font-bold tracking-widest">{ticketId}</p>
                  </div>
                  <p className="text-zinc-400 text-sm">
                    Your support ticket has been received. We've sent a confirmation email to <b>{formData.email}</b>.
                  </p>
                  <button 
                    onClick={() => setSuccess(false)}
                    className="px-8 py-3 bg-white text-black text-xs font-black uppercase tracking-widest rounded-xl hover:bg-zinc-200 transition-all"
                  >
                    Send Another
                  </button>
                </div>
              ) : (
                <form onSubmit={handleSubmit} className="space-y-6">
                  <div className="space-y-4">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <label className="text-[10px] font-black uppercase tracking-widest text-zinc-500 ml-1">Discord Username</label>
                        <input 
                          required
                          type="text"
                          readOnly={!!session}
                          value={formData.discordUsername}
                          onChange={(e) => setFormData({...formData, discordUsername: e.target.value})}
                          placeholder="username"
                          className={`w-full bg-black/40 border border-white/5 rounded-2xl py-4 px-6 text-sm text-white placeholder:text-zinc-700 focus:border-indigo-500/50 focus:ring-4 focus:ring-indigo-500/10 outline-none transition-all ${session ? 'opacity-50 cursor-not-allowed' : ''}`}
                        />
                      </div>
                      <div className="space-y-2">
                        <label className="text-[10px] font-black uppercase tracking-widest text-zinc-500 ml-1">Discord ID</label>
                        <input 
                          required
                          type="text"
                          readOnly={!!session}
                          value={formData.discordId}
                          onChange={(e) => setFormData({...formData, discordId: e.target.value})}
                          placeholder="123456789012345678"
                          className={`w-full bg-black/40 border border-white/5 rounded-2xl py-4 px-6 text-sm text-white placeholder:text-zinc-700 focus:border-indigo-500/50 focus:ring-4 focus:ring-indigo-500/10 outline-none transition-all ${session ? 'opacity-50 cursor-not-allowed' : ''}`}
                        />
                      </div>
                    </div>

                    <div className="space-y-2">
                      <label className="text-[10px] font-black uppercase tracking-widest text-zinc-500 ml-1">Email Address</label>
                      <input 
                        required
                        type="email"
                        readOnly={!!session}
                        value={formData.email}
                        onChange={(e) => setFormData({...formData, email: e.target.value})}
                        placeholder="john@example.com"
                        className={`w-full bg-black/40 border border-white/5 rounded-2xl py-4 px-6 text-sm text-white placeholder:text-zinc-700 focus:border-indigo-500/50 focus:ring-4 focus:ring-indigo-500/10 outline-none transition-all ${session ? 'opacity-50 cursor-not-allowed' : ''}`}
                      />
                    </div>

                    <div className="space-y-2">
                      <label className="text-[10px] font-black uppercase tracking-widest text-zinc-500 ml-1">Subject</label>
                      <input 
                        required
                        type="text"
                        value={formData.subject}
                        onChange={(e) => setFormData({...formData, subject: e.target.value})}
                        placeholder="How can we help?"
                        className="w-full bg-black/40 border border-white/5 rounded-2xl py-4 px-6 text-sm text-white placeholder:text-zinc-700 focus:border-indigo-500/50 focus:ring-4 focus:ring-indigo-500/10 outline-none transition-all"
                      />
                    </div>

                    <div className="space-y-2">
                      <label className="text-[10px] font-black uppercase tracking-widest text-zinc-500 ml-1">Message</label>
                      <textarea 
                        required
                        value={formData.message}
                        onChange={(e) => setFormData({...formData, message: e.target.value})}
                        placeholder="Tell us about your issue..."
                        className="w-full bg-black/40 border border-white/5 rounded-2xl py-4 px-6 text-sm text-white placeholder:text-zinc-700 focus:border-indigo-500/50 focus:ring-4 focus:ring-indigo-500/10 outline-none transition-all h-40 resize-none"
                      />
                    </div>
                  </div>

                  {error && (
                    <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-2xl">
                      <p className="text-xs text-red-400 font-bold">{error}</p>
                    </div>
                  )}

                  <button 
                    type="submit"
                    disabled={loading}
                    className="w-full py-5 bg-indigo-500 hover:bg-indigo-600 disabled:opacity-50 text-white text-xs font-black uppercase tracking-[0.2em] rounded-2xl shadow-xl shadow-indigo-500/20 transition-all flex items-center justify-center space-x-3"
                  >
                    {loading ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <>
                        <Send className="h-4 w-4" />
                        <span>Transmit Request</span>
                      </>
                    )}
                  </button>

                  <p className="text-center text-[10px] text-zinc-600 font-medium">
                    By submitting, you agree to our Terms and Privacy Policy.
                  </p>
                </form>
              )}
            </div>
          </div>
        </div>
      </div>

      <footer className="relative z-10 py-10 border-t border-white/5 text-center">
        <p className="text-[10px] text-zinc-700 font-black uppercase tracking-[0.3em]">
          &copy; 2026 OpenSteam Infrastructure. All Rights Reserved.
        </p>
      </footer>
    </div>
  );
}
