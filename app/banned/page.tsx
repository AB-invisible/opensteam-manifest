import { redirect } from 'next/navigation';
import { prisma } from '@/app/lib/prisma';
import AppealForm from '@/app/banned/appeal-form';

export default async function BannedPage({ searchParams }: { searchParams: { id?: string } }) {
  if (!searchParams.id) {
    redirect('/');
  }

  const user = await prisma.user.findUnique({
    where: { discordId: searchParams.id },
    select: { id: true, username: true, avatar: true, isBanned: true, jailUntil: true }
  });

  if (!user) {
    redirect('/');
  }

  const isJailed = user.jailUntil && new Date() < new Date(user.jailUntil);
  if (!user.isBanned && !isJailed) {
    redirect('/');
  }

  // Fetch latest ban/jail reason
  const latestLog = await prisma.sentinelLog.findFirst({
    where: { 
      userId: user.id,
      action: { in: ['AUTO_JAIL', 'MANUAL_BAN', 'MANUAL_JAIL'] }
    },
    orderBy: { createdAt: 'desc' }
  });

  let reasonText = latestLog?.reason || null;

  if (!reasonText) {
    const banAudit = await prisma.auditLog.findFirst({
      where: { targetId: user.id, action: 'BAN_USER' },
      orderBy: { createdAt: 'desc' },
      select: { details: true },
    });
    const auditDetails = typeof banAudit?.details === 'string' ? banAudit.details : '';
    const reasonMatch = auditDetails.match(/Reason:\s*(.+)$/i);
    reasonText = reasonMatch?.[1]?.trim() || auditDetails || null;
  }

  if (!reasonText) {
    reasonText = 'No specific reason provided by administrators.';
  }

  // Fetch user's appeal history
  const userAppeals = await prisma.sentinelLog.findMany({
    where: {
      userId: user.id,
      action: { in: ['APPEAL_SUBMITTED', 'APPEAL_ACCEPTED', 'APPEAL_DECLINED'] }
    },
    orderBy: { createdAt: 'desc' }
  });

  const serializedAppeals = userAppeals.map(a => {
    let reason = '';
    try {
      if (a.details) {
        const parsed = typeof a.details === 'string' ? JSON.parse(a.details) : (a.details as any);
        reason = parsed?.reason || '';
      }
    } catch (e) {}
    return {
      id: a.id,
      action: a.action as 'APPEAL_SUBMITTED' | 'APPEAL_ACCEPTED' | 'APPEAL_DECLINED',
      createdAt: a.createdAt.toISOString(),
      reason
    };
  });

  return (
    <div className="min-h-screen bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-red-950/20 via-[#09090b] to-black flex flex-col items-center justify-center p-4 font-sans selection:bg-red-500/30 selection:text-white">
      <div className="max-w-md w-full bg-[#18181b]/80 backdrop-blur-xl border border-[#27272a]/80 rounded-2xl shadow-[0_0_50px_rgba(239,68,68,0.05)] p-8 space-y-6 relative overflow-hidden">
        {/* Top decorative gradient bar */}
        <div className="absolute top-0 left-0 w-full h-[3px] bg-gradient-to-r from-red-500 via-orange-500 to-red-500 shadow-md"></div>
        
        <div className="text-center space-y-4">
          <div className="relative mx-auto w-20 h-20 mb-2">
            {user.avatar ? (
              <img 
                src={user.avatar} 
                alt={user.username} 
                className="w-20 h-20 rounded-full border-2 border-red-500/30 shadow-lg shadow-red-500/10 object-cover"
              />
            ) : (
              <div className="w-20 h-20 bg-red-500/10 border-2 border-red-500/30 flex items-center justify-center rounded-full shadow-lg shadow-red-500/10">
                <svg className="w-10 h-10 text-red-500/80" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              </div>
            )}
            
            {/* Glowing active indicator dot */}
            <span className="absolute bottom-0 right-1 block h-4 w-4 rounded-full ring-2 ring-[#18181b] bg-red-500 animate-pulse"></span>
          </div>

          <div className="space-y-1">
            <h1 className="text-2xl font-bold text-white tracking-tight">Access Restricted</h1>
            <p className="text-xs text-[#a1a1aa] font-medium uppercase tracking-wider">
              Account: <span className="text-gray-300 font-semibold">{user.username}</span>
            </p>
          </div>

          <p className="text-[#a1a1aa] text-sm leading-relaxed max-w-sm mx-auto">
            {user.isBanned 
              ? 'Your OpenSteam account has been permanently banned for violating our terms of service.'
              : `Your OpenSteam account is temporarily suspended until ${new Date(user.jailUntil!).toLocaleString()}.`}
          </p>
        </div>

        <div className="bg-red-500/[0.04] border border-red-500/15 rounded-xl p-4 shadow-inner">
          <h3 className="text-red-400 text-xs font-bold mb-1.5 uppercase tracking-wider">Reason for {user.isBanned ? 'Ban' : 'Suspension'}</h3>
          <p className="text-red-200/90 text-sm leading-relaxed font-medium">{reasonText}</p>
        </div>

        <div className="pt-6 border-t border-[#27272a]/60">
          <AppealForm userId={user.id} initialAppeals={serializedAppeals} />
        </div>
      </div>
    </div>
  );
}
