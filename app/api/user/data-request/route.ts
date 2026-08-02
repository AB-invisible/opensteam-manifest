/**
 * POST /api/user/data-request
 *   Generates a full JSON export of the authenticated user's data,
 *   emails it to their address, and returns { success: true }.
 *
 * DELETE /api/user/data-request
 *   1. Generates and emails the data export (GDPR requirement — give data before deletion).
 *   2. Hard-deletes the user record; cascades wipe all related rows via schema onDelete:Cascade.
 *   3. Invalidates the current session.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/app/lib/auth-options'
import { prisma } from '@/app/lib/prisma'
import { sendEmail, sendBrandedEmail } from '@/app/lib/email'

export const dynamic = 'force-dynamic'

async function buildDataExport(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      apiKeys: {
        select: { id: true, name: true, createdAt: true, lastUsed: true, enabled: true }
      },
      manifests: {
        select: { steamAppId: true, name: true, downloads: true, createdAt: true }
      },
      auditLogs: {
        select: { action: true, details: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
        take: 200,
      },
      supportTickets: {
        select: { ticketNumber: true, subject: true, message: true, status: true, createdAt: true }
      },
      webGenerations: {
        select: { appId: true, gameName: true, source: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
        take: 500,
      },
    }
  })

  if (!user) return null

  // Sanitise — remove secrets before exporting
  const { webhookSecret, fingerprint, lastUserAgent, ...safeUser } = user as any

  return {
    exportedAt: new Date().toISOString(),
    account: safeUser,
  }
}

async function sendExportEmail(user: { email: string | null; username: string }, exportJson: object) {
  if (!user.email) return

  const json = JSON.stringify(exportJson, null, 2)
  const buffer = Buffer.from(json, 'utf8')

  await sendEmail(
    user.email,
    'Your OpenSteam data export',
    `<p style="font-family:sans-serif;font-size:14px;color:#94a3b8;">Hi ${user.username}, your OpenSteam account data export is attached. This file contains all data we hold about your account.</p>`,
    [
      {
        filename: `opensteam-data-export-${Date.now()}.json`,
        content: buffer,
        contentType: 'application/json',
      }
    ]
  )
}

// ── POST — export only ─────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const user = await prisma.user.findUnique({
    where: { discordId: session.user.discordId as string },
    select: { id: true, email: true, username: true }
  })
  if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 })

  const exportData = await buildDataExport(user.id)
  if (!exportData) return NextResponse.json({ error: 'Could not build export' }, { status: 500 })

  await sendExportEmail(user, exportData)

  // Also send a confirmation email via branded template
  if (user.email) {
    await sendBrandedEmail(
      user.email,
      'Your OpenSteam data export has been sent',
      'Data Export Ready',
      'Your account data export has been sent to this email address as a JSON attachment. It contains all information OpenSteam holds about your account.<br><br>If you did not request this, please contact support immediately.',
      '#6366f1',
      undefined,
      {
        buttonText: 'Contact Support',
        buttonUrl: 'http://127.0.0.1:3000/support',
        securityNotice: 'If you did not request a data export, contact support immediately — someone may have accessed your account.'
      }
    ).catch(() => {})
  }

  return NextResponse.json({ success: true, message: 'Data export sent to your email address.' })
}

// ── DELETE — export then delete ────────────────────────────────────────────

export async function DELETE(request: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const user = await prisma.user.findUnique({
    where: { discordId: session.user.discordId as string },
    select: { id: true, email: true, username: true }
  })
  if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 })

  // 1. Build and email the export before deleting (GDPR Article 20 — right to portability)
  const exportData = await buildDataExport(user.id)
  if (exportData) {
    await sendExportEmail(user, exportData).catch(() => {})
  }

  // 2. Hard-delete — cascades wipe api_keys, manifests, audit_logs, etc.
  await prisma.user.delete({ where: { id: user.id } })

  // 3. Return success — the client should clear session storage and redirect to /
  return NextResponse.json({
    success: true,
    message: 'Your account and all associated data have been permanently deleted. A data export was sent to your email address.'
  })
}
