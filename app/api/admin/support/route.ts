import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/app/lib/prisma';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/lib/auth-options';
import { sendBrandedEmail } from '@/app/lib/email';
import { renderSupportSignature } from '@/app/lib/support-rank-styles';

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    const role = (session?.user as any)?.role;
    if (role !== 'ADMIN' && role !== 'MODERATOR' && role !== 'SENIOR_MODERATOR' && role !== 'OWNER') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const ticketId = searchParams.get('id');

    if (ticketId) {
      const ticket = await prisma.supportTicket.findUnique({
        where: { id: ticketId },
        include: { replies: { orderBy: { createdAt: 'asc' } } }
      });
      if (!ticket) return NextResponse.json({ error: 'Ticket not found' }, { status: 404 });

      if (ticket.resendId && searchParams.get('refresh') === 'true') {
        const resendRes = await fetch('https://api.resend.com/emails/' + ticket.resendId, {
          headers: { 'Authorization': 'Bearer ' + process.env.RESEND_API_KEY }
        });
        if (resendRes.ok) {
          const resendData = await resendRes.json();
          return NextResponse.json({ ticket, resendStatus: resendData.status });
        }
      }
      return NextResponse.json({ ticket });
    }

    const tickets = await prisma.supportTicket.findMany({
      orderBy: { createdAt: 'desc' },
      include: { user: true, replies: { orderBy: { createdAt: 'asc' } } }
    });

    return NextResponse.json({ tickets });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to fetch tickets' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if ((session?.user as any)?.role !== 'ADMIN' && (session?.user as any)?.role !== 'OWNER' && (session?.user as any)?.role !== 'SENIOR_MODERATOR') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { ticketId, reply, close } = await request.json();

    const ticket = await prisma.supportTicket.findUnique({ where: { id: ticketId } });
    if (!ticket) {
      return NextResponse.json({ error: 'Ticket not found' }, { status: 404 });
    }

    // 1. Resolve replier's Discord rank
    let rank = 'Support Staff';
    const replierDiscordId = (session?.user as any)?.discordId;

    if (replierDiscordId) {
      const [guildConfig, botTokenConfig] = await Promise.all([
        prisma.systemConfig.findUnique({ where: { key: 'DISCORD_GUILD_ID' } }),
        prisma.systemConfig.findUnique({ where: { key: 'DISCORD_BOT_TOKEN' } })
      ]);

      if (guildConfig?.value && botTokenConfig?.value) {
        try {
          const discordRes = await fetch(
            'https://discord.com/api/v10/guilds/' + guildConfig.value + '/members/' + replierDiscordId,
            { headers: { Authorization: 'Bot ' + botTokenConfig.value } }
          );
          if (discordRes.ok) {
            const member = await discordRes.json();
            const roles: string[] = member.roles || [];
            if (roles.includes('1475601030212223158'))      rank = 'Chief Executive Officer';
            else if (roles.includes('1520809961964441712')) rank = 'Chief Operation Officer';
            else if (roles.includes('1465042800293974293')) rank = 'Board of Directors';
            else if (roles.includes('1477659165232201819')) rank = 'Executive Officer';
            else if (roles.includes('1500445455635710174')) rank = 'Personal Assistant of Director';
            else if (roles.includes('1484966440376467687')) rank = 'Support Staff';
          }
        } catch (e) {
          console.error('[Discord Guild Role Check Error]:', e);
        }
      }
    }

    // 2. Save reply to DB
    await prisma.supportTicketReply.create({
      data: {
        ticketId,
        senderName: session?.user?.name || 'Staff Member',
        senderRole: rank,
        message: reply
      }
    });

    // 3. Build and send email
    const replierName = session?.user?.name || 'Staff Member';

    const closedNotice = close
      ? '<div style="margin-top:20px;padding:12px 16px;background:rgba(239,68,68,0.08);border-left:4px solid #ef4444;border-radius:6px;color:#f87171;font-size:14px;"><strong>This ticket has been closed.</strong> If you need further assistance, please open a new support ticket.</div>'
      : '<p style="margin-top:20px;color:#94a3b8;font-size:14px;">If you have further questions, you can reply directly to this email.</p>';

    const sig = renderSupportSignature(replierName, rank);

    const emailBody = [
      'Hello ' + (ticket.fromName || 'there') + ',<br><br>',
      'Our support team has responded to your inquiry:<br><br>',
      '<div style="background:rgba(255,255,255,0.05);padding:15px;border-radius:10px;border-left:4px solid #8b5cf6;">',
      reply.replace(/\n/g, '<br>'),
      '</div>',
      closedNotice,
      sig,
    ].join('');

    const messageId = `<ticket-${ticket.ticketNumber}@opensteam.lol>`;
    const emailRes = await sendBrandedEmail(
      ticket.fromEmail,
      'Re: [' + ticket.ticketNumber + '] ' + ticket.subject,
      'Support Response',
      emailBody,
      '#8b5cf6',
      {
        'Message-ID': messageId,
        ...(ticket.resendId ? { 'In-Reply-To': ticket.resendId, 'References': ticket.resendId } : {})
      }
    );

    // 4. Update ticket status
    await prisma.supportTicket.update({
      where: { id: ticketId },
      data: { status: close ? 'CLOSED' : 'PENDING' }
    });

    return NextResponse.json({ success: true, emailId: (emailRes as any)?.id });
  } catch (error) {
    console.error('[Admin Support Reply Error]:', error);
    return NextResponse.json({ error: 'Failed to send reply' }, { status: 500 });
  }
}
