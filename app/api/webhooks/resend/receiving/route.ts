import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/app/lib/prisma';
import { sendBrandedEmail } from '@/app/lib/email';
import { runSupportAgent } from '@/app/lib/support-agent';
import { sendWebhook } from '@/app/lib/webhooks';
import { getRuntimeSecret } from '@/app/lib/runtime-secrets';
import {
  fetchInboundEmailContent,
  isEmailReceivedEvent,
  stripHtmlTags,
  stripInboundEmailQuotes,
  verifyResendWebhookRequest,
} from '@/app/lib/resend-webhook';

export async function POST(request: NextRequest) {
  try {
    const verification = await verifyResendWebhookRequest(request);
    if (!verification.ok) {
      return verification.response;
    }

    const { event } = verification;
    if (!isEmailReceivedEvent(event)) {
      return NextResponse.json({ success: true, message: 'Ignored event type' });
    }

    const { from, to, subject, email_id: emailId } = event.data;
    let text = '';
    let html = '';

    if (emailId) {
      const fetched = await fetchInboundEmailContent(emailId);
      text = fetched.text;
      html = fetched.html;
    }

    const headers: Record<string, string> = {};
    const rawSubject = (subject || '').toString();

    const fromRaw = from;
    const fromEmail = fromRaw?.includes('<')
      ? fromRaw.split('<')[1].split('>')[0].trim()
      : (fromRaw ?? '').trim();
    const fromName = fromRaw?.includes('<')
      ? fromRaw.split('<')[0].trim().replace(/^"|"$/g, '')
      : null;

    const toAddresses: string[] = Array.isArray(to) ? to : [to].filter(Boolean);

    if (!fromEmail) {
      return NextResponse.json({ error: 'Missing sender address' }, { status: 400 });
    }

    if (
      fromEmail.toLowerCase().includes('dmarc') ||
      fromEmail.toLowerCase().includes('postmaster') ||
      fromEmail.toLowerCase().includes('bounce') ||
      rawSubject.toLowerCase().includes('dmarc report') ||
      rawSubject.toLowerCase().includes('report domain:')
    ) {
      console.log(`[Resend Receiving] Ignored automated/DMARC email from ${fromEmail}`);
      return NextResponse.json({ success: true, message: 'Ignored automated email' });
    }

    const user = await prisma.user.findFirst({ where: { email: fromEmail } });

    const extractTicketNumber = (value?: string | string[] | null): string | null => {
      if (!value) return null;
      const textValue = Array.isArray(value) ? value.join(' ') : value.toString();
      const ticketMatch = textValue.match(/GG-\d{6}/i);
      return ticketMatch ? ticketMatch[0].toUpperCase() : null;
    };

    const parseTicketFromMessageId = (value?: string | string[] | null): string | null => {
      if (!value) return null;
      const textValue = Array.isArray(value) ? value.join(' ') : value.toString();
      const ticketMatch = textValue.match(/ticket-(GG-\d{6})/i) || textValue.match(/GG-\d{6}/i);
      return ticketMatch ? ticketMatch[1]?.toUpperCase() || ticketMatch[0].toUpperCase() : null;
    };

    const normalizeHeader = (key: string) => {
      const headerKey = Object.keys(headers).find((h) => h.toLowerCase() === key.toLowerCase());
      return headerKey ? headers[headerKey] : undefined;
    };

    const ticketNumberFromSubject = extractTicketNumber(rawSubject);
    const ticketNumberFromInReplyTo = parseTicketFromMessageId(normalizeHeader('in-reply-to'));
    const ticketNumberFromReferences = parseTicketFromMessageId(normalizeHeader('references'));
    const ticketNumberFromMessageId = parseTicketFromMessageId(normalizeHeader('message-id'));

    let existingTicket = null;
    const resolvedTicketNumber =
      ticketNumberFromSubject ||
      ticketNumberFromInReplyTo ||
      ticketNumberFromReferences ||
      ticketNumberFromMessageId;
    if (resolvedTicketNumber) {
      existingTicket = await prisma.supportTicket.findUnique({
        where: { ticketNumber: resolvedTicketNumber },
      });
    }

    if (!existingTicket && user) {
      const activeTickets = await prisma.supportTicket.findMany({
        where: { fromEmail, status: { in: ['OPEN', 'PENDING'] } },
        orderBy: { updatedAt: 'desc' },
      });
      if (activeTickets.length === 1) {
        existingTicket = activeTickets[0];
      }
    }

    if (existingTicket) {
      const plainText = (text && text.trim()) || stripHtmlTags(html || '') || '';
      let cleanMessage = stripInboundEmailQuotes(plainText);
      if (!cleanMessage) cleanMessage = '(No text content found)';

      const userReply = await prisma.supportTicketReply.create({
        data: {
          ticketId: existingTicket.id,
          senderName: existingTicket.fromName || fromName || fromEmail,
          senderRole: 'User',
          message: cleanMessage,
        },
      });

      await prisma.supportTicket.update({
        where: { id: existingTicket.id },
        data: { status: 'OPEN' },
      });

      const adminEmail =
        (await getRuntimeSecret('SUPPORT_RECIPIENT')) || 'pokemgo300@gmail.com';

      await sendBrandedEmail(
        adminEmail,
        `[${existingTicket.ticketNumber}] Inbound Reply: ${existingTicket.subject}`,
        'Support Reply Received',
        `<strong>Ticket Number:</strong> ${existingTicket.ticketNumber}<br><strong>From:</strong> ${from}<br><br><strong>Message:</strong><br>${cleanMessage.replace(/\n/g, '<br>')}`,
        '#6366f1',
        existingTicket.resendId
          ? {
              'In-Reply-To': existingTicket.resendId,
              References: existingTicket.resendId,
            }
          : undefined
      );

      const agentResult = await runSupportAgent(
        existingTicket.id,
        fromEmail,
        subject || existingTicket.subject || '',
        cleanMessage
      );
      if (agentResult?.reply) {
        const responseBody = [
          '<p style="margin:0 0 16px;">Our support agent reviewed your latest reply and provided this update:</p>',
          '<div style="background:rgba(255,255,255,0.05);padding:15px;border-radius:10px;border-left:4px solid #8b5cf6;">',
          agentResult.reply.replace(/\n/g, '<br>'),
          '</div>',
          agentResult.resolved
            ? '<div style="margin-top:20px;padding:12px 16px;background:rgba(34,197,94,0.08);border-left:4px solid #22c55e;border-radius:6px;color:#d1fae5;font-size:14px;"><strong>Your request has been completed.</strong></div>'
            : '<p style="margin-top:20px;color:#94a3b8;font-size:14px;">A member of our team will follow up if further assistance is needed.</p>',
        ].join('');

        await sendBrandedEmail(
          fromEmail,
          'Re: [' + existingTicket.ticketNumber + '] ' + existingTicket.subject,
          'Support Update',
          responseBody,
          '#6366f1',
          existingTicket.resendId
            ? { 'In-Reply-To': existingTicket.resendId, References: existingTicket.resendId }
            : undefined
        ).catch(() => {});
      }

      sendWebhook('ADMIN_ACTION', {
        action: 'SUPPORT_REPLY_RECEIVED',
        details: `Received email reply from ${fromEmail} for ticket ${existingTicket.ticketNumber}`,
        userId: user?.id || 'GUEST',
      });

      return NextResponse.json({
        success: true,
        message: 'Inbound reply processed.',
        ticketId: existingTicket.id,
        replyId: userReply.id,
      });
    }

    const ticketNumber = `GG-${Math.floor(100000 + Math.random() * 900000)}`;

    const ticket = await prisma.supportTicket.create({
      data: {
        ticketNumber,
        fromEmail,
        fromName,
        subject: subject || '(No Subject)',
        message: text || html || '',
        resendId: emailId,
        userId: user?.id,
        status: 'OPEN',
      },
    });

    const adminEmail =
      (await getRuntimeSecret('SUPPORT_RECIPIENT')) || 'pokemgo300@gmail.com';

    await sendBrandedEmail(
      adminEmail,
      `[${ticketNumber}] Inbound Mail: ${subject || '(No Subject)'}`,
      'New Inbound Support Mail',
      `<strong>Ticket:</strong> ${ticketNumber}<br><strong>From:</strong> ${from}<br><strong>To:</strong> ${toAddresses.join(', ')}<br><br><strong>Subject:</strong> ${subject || '(No Subject)'}<br><br><strong>Message:</strong><br>${(text || 'No text content').replace(/\n/g, '<br>')}`,
      '#8b5cf6'
    );

    const inboundAddress =
      (await getRuntimeSecret('RESEND_INBOUND_ADDRESS')) || 'support@opensteam.local';

    await sendBrandedEmail(
      fromEmail,
      `[${ticketNumber}] We've received your message`,
      'Request Received',
      `Hello ${fromName || 'there'},<br><br>We've received your email regarding "<strong>${subject || '(No Subject)'}</strong>" and created a support ticket for you.<br><br><strong>Ticket Number:</strong> ${ticketNumber}<br><br>Our team will review it and get back to you as soon as possible. You can reply directly to this email to add more information to your ticket.`,
      '#10b981',
      { 'Reply-To': inboundAddress }
    );

    sendWebhook('ADMIN_ACTION', {
      action: 'SUPPORT_TICKET_RECEIVED',
      details: `New inbound email from ${fromEmail}. Ticket: ${ticketNumber}`,
      userId: user?.id || 'GUEST',
    });

    return NextResponse.json({ success: true, ticketId: ticket.id, ticketNumber });
  } catch (error) {
    console.error('[Resend Receiving Webhook Error]:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
