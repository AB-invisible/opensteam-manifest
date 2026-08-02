import { NextRequest, NextResponse } from 'next/server';
import { sendBrandedEmail, sendEmail } from '@/app/lib/email';
import { prisma } from '@/app/lib/prisma';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/lib/auth-options';
import { runSupportAgent } from '@/app/lib/support-agent';
import { canAccessSupportTicket } from '@/app/lib/route-guards';
import { renderSupportSignature } from '@/app/lib/support-rank-styles';

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const tickets = await prisma.supportTicket.findMany({
      where: { fromEmail: session.user.email as string },
      include: { replies: { orderBy: { createdAt: 'asc' } } },
      orderBy: { createdAt: 'desc' }
    });

    return NextResponse.json({ tickets });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to fetch tickets' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { ticketId, reply, name, email, subject, message } = body;

    // Handle user follow-up reply
    if (ticketId && reply) {
      const session = await getServerSession(authOptions);
      if (!session?.user?.email) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }

      const ticket = await prisma.supportTicket.findUnique({ where: { id: ticketId } });
      if (!ticket) return NextResponse.json({ error: 'Ticket not found.' }, { status: 404 });

      if (!canAccessSupportTicket(session.user as { email?: string | null; role?: string }, ticket)) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }

      await prisma.supportTicket.update({
        where: { id: ticketId },
        data: { status: 'OPEN' }
      });

      const userReply = await prisma.supportTicketReply.create({
        data: {
          ticketId,
          senderName: ticket.fromName || 'User',
          senderRole: 'User',
          message: reply
        }
      });

      const adminEmailConfig = await prisma.systemConfig.findUnique({ where: { key: 'SUPPORT_RECIPIENT' } });
      const adminEmail = adminEmailConfig?.value || 'pokemgo300@gmail.com';
      await sendBrandedEmail(
        adminEmail,
        '[' + ticket.ticketNumber + '] User Follow-Up: ' + ticket.subject,
        'Support Follow-Up Received',
        '<strong>Ticket:</strong> ' + ticket.ticketNumber + '<br><strong>From:</strong> ' + ticket.fromName + ' (' + ticket.fromEmail + ')<br><br><strong>New Message:</strong><br>' + reply.replace(/\n/g, '<br>'),
        '#6366f1'
      );

      const agentResult = await runSupportAgent(ticketId, ticket.fromEmail, ticket.subject || '', reply);
      if (agentResult?.reply) {
        const messageId = `<ticket-${ticket.ticketNumber}@opensteam.lol>`;
        await sendBrandedEmail(
          ticket.fromEmail,
          'Re: [' + ticket.ticketNumber + '] ' + ticket.subject,
          'Support Update',
          '<p style="margin:0 0 16px;">Our support agent reviewed your latest message and provided this update:</p>' +
          '<div style="background:rgba(255,255,255,0.05);padding:15px;border-radius:10px;border-left:4px solid #8b5cf6;">' +
          agentResult.reply.replace(/\n/g, '<br>') +
          '</div>' +
          (agentResult.resolved
            ? '<div style="margin-top:20px;padding:12px 16px;background:rgba(34,197,94,0.08);border-left:4px solid #22c55e;border-radius:6px;color:#d1fae5;font-size:14px;"><strong>Your request has been completed.</strong></div>'
            : '<p style="margin-top:20px;color:#94a3b8;font-size:14px;">A member of our team will follow up if further assistance is needed.</p>'),
          '#6366f1',
          { 'Message-ID': messageId }
        ).catch(() => {});
      }

      return NextResponse.json({ success: true, reply: userReply });
    }

    if (!name || !email || !subject || !message) {
      return NextResponse.json({ error: 'All fields are required.' }, { status: 400 });
    }

    const ticketNumber = 'GG-' + Math.floor(100000 + Math.random() * 900000);

    const user = await prisma.user.findFirst({ where: { email } });
    const ticket = await prisma.supportTicket.create({
      data: { ticketNumber, fromEmail: email, fromName: name, subject, message, userId: user?.id, status: 'OPEN' }
    });

    const adminEmailConfig = await prisma.systemConfig.findUnique({ where: { key: 'SUPPORT_RECIPIENT' } });
    const adminEmail = adminEmailConfig?.value || 'pokemgo300@gmail.com';

    await sendBrandedEmail(
      adminEmail,
      '[' + ticketNumber + '] Support Request: ' + subject,
      'New Support Request',
      '<strong>Ticket:</strong> ' + ticketNumber + '<br><strong>From:</strong> ' + name + ' (' + email + ')<br><br><strong>Subject:</strong> ' + subject + '<br><br><strong>Message:</strong><br>' + message.replace(/\n/g, '<br>'),
      '#6366f1'
    );

    const inboundAddress =
      process.env.RESEND_INBOUND_ADDRESS ||
      (await prisma.systemConfig.findUnique({ where: { key: 'RESEND_INBOUND_ADDRESS' } }))?.value ||
      'support@opensteam.local';

    const confirmSig = renderSupportSignature('OpenSteam', 'Support Team');
    const confirmBody = [
      'Hello ' + name + ',<br><br>',
      'We have received your support request regarding "<strong>' + subject + '</strong>". ',
      'Our team will review it and get back to you as soon as possible.<br><br>',
      '<strong>Ticket Number:</strong> <code>' + ticketNumber + '</code><br><br>',
      'You can reply directly to this email to add more information.<br><br>',
      'Your message:<br>',
      '<div style="background:rgba(255,255,255,0.04);padding:12px 16px;border-radius:8px;border-left:3px solid rgba(255,255,255,0.12);margin-top:8px;">',
      '<em style="color:#94a3b8;">' + message.replace(/\n/g, '<br>') + '</em>',
      '</div>',
      confirmSig,
    ].join('');

    const messageId = `<ticket-${ticketNumber}@opensteam.lol>`;
    await sendBrandedEmail(
      email,
      '[' + ticketNumber + '] Request Received - OpenSteam',
      'Request Received',
      confirmBody,
      '#10b981',
      { 'Reply-To': inboundAddress, 'Message-ID': messageId }
    );

    // Fire AI agent in background
    runSupportAgent(ticket.id, email, subject, message).then(async (agentResult) => {
      if (!agentResult) return;

      const { reply: aiReply, resolved } = agentResult;

      const closedNotice = resolved
        ? '<div style="margin-top:20px;padding:12px 16px;background:rgba(239,68,68,0.08);border-left:4px solid #ef4444;border-radius:6px;color:#f87171;font-size:14px;"><strong>This ticket has been closed.</strong> If you need further assistance, please open a new support ticket.</div>'
        : '<p style="margin-top:20px;color:#94a3b8;font-size:14px;">A member of our team will follow up if further assistance is needed.</p>';

      const aiSig = renderSupportSignature('OpenSteam', 'AI Support Agent');

      const aiBody = [
        'Hello ' + name + ',<br><br>',
        'Our support agent has reviewed your request and provided the following response.<br><br>',
        '<div style="background:rgba(255,255,255,0.05);padding:15px;border-radius:10px;border-left:4px solid #8b5cf6;">',
        aiReply.replace(/\n/g, '<br>'),
        '</div>',
        closedNotice,
        aiSig,
      ].join('');

      await sendBrandedEmail(
        email,
        'Re: [' + ticketNumber + '] ' + subject,
        'Support Response',
        aiBody,
        '#6366f1',
        { 'Reply-To': inboundAddress },
        { buttonText: 'View Support Ticket', buttonUrl: 'http://127.0.0.1:3000/support' }
      ).catch((e: any) => console.error('[SupportAgent Email Error]', e));
    }).catch(() => {});

    return NextResponse.json({ success: true, message: 'Support request sent successfully.', ticketNumber });
  } catch (error) {
    console.error('[Support API Error]:', error);
    return NextResponse.json({ error: 'Failed to send support request.' }, { status: 500 });
  }
}
