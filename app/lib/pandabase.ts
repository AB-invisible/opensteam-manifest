/**
 * Pandabase billing integration.
 *
 * Server-side helpers for creating checkout sessions and verifying webhooks.
 * Replaces the previous Whop integration.
 *
 * Docs: https://docs.pandabase.io/
 */
import { Webhook } from 'standardwebhooks'

const API_BASE = 'https://api.pandabase.io/v2'

export function getPandabaseStoreId(): string {
  const storeId = process.env.PANDABASE_STORE_ID?.trim()
  if (!storeId) throw new Error('PANDABASE_STORE_ID is not configured')
  return storeId
}

function getApiToken(): string {
  const token = process.env.PANDABASE_API_TOKEN?.trim()
  if (!token) throw new Error('PANDABASE_API_TOKEN is not configured')
  return token
}

export type CheckoutItem =
  | { product_id: string; variant_id?: string; quantity?: number }
  | { name: string; amount: number; quantity?: number }

export interface CreateCheckoutInput {
  items: CheckoutItem[]
  metadata?: Record<string, string>
  returnUrl?: string
  cancelUrl?: string
  title?: string
  description?: string
}

export interface CreatedCheckoutSession {
  sessionId: string
  storeId: string
  checkoutUrl: string
}

/**
 * Create a Pandabase checkout session and return the identifiers the client
 * SDK needs to render the embedded checkout.
 */
export async function createCheckoutSession(
  input: CreateCheckoutInput
): Promise<CreatedCheckoutSession> {
  const storeId = getPandabaseStoreId()

  const res = await fetch(`${API_BASE}/stores/${storeId}/checkouts`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${getApiToken()}`,
    },
    body: JSON.stringify({
      items: input.items,
      ...(input.title ? { title: input.title } : {}),
      ...(input.description ? { description: input.description } : {}),
      ...(input.metadata ? { metadata: input.metadata } : {}),
      ...(input.returnUrl ? { return_url: input.returnUrl } : {}),
      ...(input.cancelUrl ? { cancel_url: input.cancelUrl } : {}),
    }),
  })

  const json = await res.json().catch(() => null)

  if (!res.ok || !json?.data) {
    const message = json?.error || `Pandabase checkout failed (${res.status})`
    throw new Error(message)
  }

  const sessionId: string = json.data.id ?? json.data.session_id
  if (!sessionId) {
    throw new Error('Pandabase checkout response missing session id')
  }

  return {
    sessionId,
    storeId,
    checkoutUrl: json.data.checkout_url,
  }
}

let cachedWebhook: Webhook | null = null

/**
 * Verify and parse a Pandabase webhook (Standard Webhooks v2).
 * Throws if the signature is invalid. Returns the parsed event payload.
 */
export function verifyPandabaseWebhook(
  rawBody: string,
  headers: Record<string, string>
): PandabaseWebhookEvent {
  const secret = process.env.PANDABASE_WEBHOOK_SECRET
  if (!secret) throw new Error('PANDABASE_WEBHOOK_SECRET is not configured')

  if (!cachedWebhook) {
    cachedWebhook = new Webhook(secret)
  }

  return cachedWebhook.verify(rawBody, headers) as PandabaseWebhookEvent
}

export type PandabaseEventType =
  | 'PAYMENT_PENDING'
  | 'PAYMENT_COMPLETED'
  | 'PAYMENT_FAILED'
  | 'PAYMENT_REFUNDED'
  | 'PAYMENT_DISPUTED'
  | 'PAYMENT_DISPUTE_WON'
  | 'PAYMENT_DISPUTE_LOST'
  | 'PAYMENT_DISPUTE_PREVENTED'
  | 'SUBSCRIPTION_CREATED'
  | 'SUBSCRIPTION_RENEWED'
  | 'SUBSCRIPTION_PAST_DUE'
  | 'SUBSCRIPTION_CANCELLED'
  | 'SUBSCRIPTION_PAUSED'
  | 'SUBSCRIPTION_RESUMED'
  | 'SUBSCRIPTION_UPDATED'
  | 'SUBSCRIPTION_TRIAL_ENDING'
  | 'SUBSCRIPTION_RENEWING'

export interface PandabaseOrder {
  id: string
  orderNumber?: string
  status?: string
  amount?: number
  currency?: string
  customFields?: Record<string, string> | null
  metadata?: Record<string, string> | null
  items?: Array<{ productId: string | null; name: string; quantity: number; amount: number }>
}

export interface PandabaseSubscription {
  id: string
  status: 'TRIALING' | 'ACTIVE' | 'PAST_DUE' | 'PAUSED' | 'CANCELLED'
  billingInterval: 'WEEKLY' | 'MONTHLY' | 'YEARLY'
  amount: number
  currency: string
  currentPeriodStart: string
  currentPeriodEnd: string
  nextChargeAt: string | null
  trialEnd: string | null
  cancelledAt: string | null
}

export interface PandabaseWebhookEvent {
  event: PandabaseEventType
  id: string
  timestamp: string
  data: {
    order: PandabaseOrder
    customer?: { id?: string; email?: string } | null
    geo?: unknown
    subscription?: PandabaseSubscription
  }
}
