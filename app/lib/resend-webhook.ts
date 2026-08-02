import { NextRequest, NextResponse } from 'next/server';
import { Resend, type EmailReceivedEvent, type WebhookEventPayload } from 'resend';
import { getRuntimeSecret, requireRuntimeSecretInProduction } from '@/app/lib/runtime-secrets';

export type VerifiedResendEvent = WebhookEventPayload;

function stripHtmlTags(html: string): string {
  return html
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/tr>/gi, '\n')
    .replace(/<\/td>/gi, '  ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#[0-9]+;/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function stripInboundEmailQuotes(plainText: string): string {
  let cleanMessage = plainText.trim();
  const quoteSplitters = [
    /On\s+.{10,60}\s+wrote:/i,
    /From:\s+.{5,50}\s*<.*@.*>/i,
    /_-{3,}\s*Original Message\s*-{3,}_/i,
    /-{3,}\s*Forwarded message\s*-{3,}/i,
  ];

  for (const splitter of quoteSplitters) {
    const parts = cleanMessage.split(splitter);
    if (parts.length > 1) {
      cleanMessage = parts[0].trim();
    }
  }

  return cleanMessage
    .split('\n')
    .filter((line) => !line.trim().startsWith('>'))
    .join('\n')
    .trim();
}

export async function fetchInboundEmailContent(emailId: string): Promise<{ text: string; html: string }> {
  if (!emailId) return { text: '', html: '' };

  const apiKey = await getRuntimeSecret('RESEND_API_KEY');
  if (!apiKey) return { text: '', html: '' };

  const resend = new Resend(apiKey);
  const result = await resend.emails.receiving.get(emailId);
  if (result.error || !result.data) {
    return { text: '', html: '' };
  }

  return {
    text: result.data.text || '',
    html: result.data.html || '',
  };
}

export async function verifyResendWebhookRequest(
  request: NextRequest
): Promise<{ ok: true; event: VerifiedResendEvent; rawBody: string } | { ok: false; response: NextResponse }> {
  const rawBody = await request.text();
  const webhookSecret = await getRuntimeSecret('RESEND_WEBHOOK_SECRET');

  const missingSecretResponse = requireRuntimeSecretInProduction(
    webhookSecret,
    'RESEND_WEBHOOK_SECRET',
    'Resend Receiving'
  );
  if (missingSecretResponse) {
    return { ok: false, response: missingSecretResponse };
  }

  if (webhookSecret) {
    const svixId = request.headers.get('svix-id') ?? '';
    const svixTimestamp = request.headers.get('svix-timestamp') ?? '';
    const svixSignature = request.headers.get('svix-signature') ?? '';

    if (!svixId || !svixTimestamp || !svixSignature) {
      console.warn('[Resend Receiving] Missing Svix headers');
      return {
        ok: false,
        response: NextResponse.json({ error: 'Missing webhook signature headers' }, { status: 401 }),
      };
    }

    try {
      const resend = new Resend();
      const event = resend.webhooks.verify({
        payload: rawBody,
        headers: {
          id: svixId,
          timestamp: svixTimestamp,
          signature: svixSignature,
        },
        webhookSecret,
      });

      return { ok: true, event, rawBody };
    } catch {
      console.error('[Resend Receiving] Invalid webhook signature');
      return {
        ok: false,
        response: NextResponse.json({ error: 'Invalid webhook signature' }, { status: 401 }),
      };
    }
  }

  const event = JSON.parse(rawBody) as VerifiedResendEvent;
  return { ok: true, event, rawBody };
}

export function isEmailReceivedEvent(event: VerifiedResendEvent): event is EmailReceivedEvent {
  return event.type === 'email.received';
}

export { stripHtmlTags };
