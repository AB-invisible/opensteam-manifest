import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/app/lib/auth-options'
import { prisma } from '@/app/lib/prisma'
import {
  buildBotInviteUrl,
  getBrandedBotConfig,
  getBrandedOAuthRedirectUrl,
  syncEligibleHostedBotInstances,
} from '@/app/lib/hosted-bot'
import { execSync, spawn } from 'child_process'
import fs from 'fs'
import path from 'path'

async function requireOwner() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.discordId) return null
  const user = await prisma.user.findUnique({ where: { discordId: session.user.discordId as string } })
  if (!user || user.role !== 'OWNER') return null
  return user
}

async function saveConfig(key: string, value: string, isSecret = false) {
  await prisma.systemConfig.upsert({
    where: { key },
    update: { value, isSecret },
    create: { key, value, isSecret },
  })
}

function killHostedBrandedBot() {
  if (process.platform === 'win32') {
    try { execSync('taskkill /F /FI "WINDOWTITLE eq OpenSteam-Hosted-Branded-Bot*" /T', { stdio: 'ignore' }) } catch {}
    try { execSync('wmic process where "CommandLine like \'%hosted-branded-bot.js%\'" delete', { stdio: 'ignore' }) } catch {}
  } else {
    try { execSync('pkill -f hosted-branded-bot.js', { stdio: 'ignore' }) } catch {}
  }
}

function killHostedCustomManager() {
  if (process.platform === 'win32') {
    try { execSync('taskkill /F /FI "WINDOWTITLE eq OpenSteam-Hosted-Custom-Manager*" /T', { stdio: 'ignore' }) } catch {}
    try { execSync('wmic process where "CommandLine like \'%hosted-custom-bot-manager.js%\'" delete', { stdio: 'ignore' }) } catch {}
  } else {
    try { execSync('pkill -f hosted-custom-bot-manager.js', { stdio: 'ignore' }) } catch {}
  }
}

function spawnHostedScript(scriptName: string, processTitle: string, logFileName: string) {
  const scriptPath = path.join(process.cwd(), 'scripts', scriptName)
  if (!fs.existsSync(scriptPath)) throw new Error(`${scriptName} not found`)

  const logDir = path.join(process.cwd(), 'data', 'logs')
  if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true })
  const logFile = path.join(logDir, logFileName)
  const out = fs.openSync(logFile, 'a')
  const err = fs.openSync(logFile, 'a')

  const child = spawn('node', [scriptPath], {
    detached: true,
    stdio: ['ignore', out, err],
    cwd: process.cwd(),
    env: { ...process.env, HOSTED_BOT_PROCESS_TITLE: processTitle },
  })
  child.unref()
}

export async function GET() {
  const owner = await requireOwner()
  if (!owner) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  await syncEligibleHostedBotInstances()

  const config = await getBrandedBotConfig()
  const customEnabled = await prisma.systemConfig.findUnique({
    where: { key: 'HOSTED_CUSTOM_MANAGER_ENABLED' },
  })

  const brandedInstances = await prisma.hostedBotInstance.findMany({
    where: { type: 'BRANDED' },
    include: { user: { select: { id: true, username: true, plan: true, discordId: true } } },
    orderBy: { updatedAt: 'desc' },
  })

  return NextResponse.json({
    config: {
      clientId: config.clientId,
      hasClientSecret: config.hasClientSecret,
      hasBotToken: config.hasBotToken,
      enabled: config.enabled,
      oauthRedirectUrl: getBrandedOAuthRedirectUrl(),
      inviteUrl: config.clientId ? buildBotInviteUrl(config.clientId) : null,
    },
    customManagerEnabled: customEnabled?.value === 'true',
    brandedInstances,
  })
}

export async function POST(req: NextRequest) {
  const owner = await requireOwner()
  if (!owner) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const { action } = body

  if (action === 'SAVE_CONFIG') {
    const { clientId, clientSecret, botToken } = body
    if (clientId) await saveConfig('HOSTED_BRANDED_CLIENT_ID', String(clientId), false)
    if (clientSecret) await saveConfig('HOSTED_BRANDED_CLIENT_SECRET', String(clientSecret), true)
    if (botToken) await saveConfig('HOSTED_BRANDED_BOT_TOKEN', String(botToken), true)
    return NextResponse.json({ success: true })
  }

  if (action === 'BRANDED_DAEMON') {
    const status = String(body.status || '').toUpperCase()
    if (status === 'RUNNING') {
      killHostedBrandedBot()
      spawnHostedScript('hosted-branded-bot.js', 'OpenSteam-Hosted-Branded-Bot', 'hosted-branded-bot.log')
      await saveConfig('HOSTED_BRANDED_ENABLED', 'true', false)
      return NextResponse.json({ success: true, status: 'RUNNING' })
    }
    if (status === 'IDLE') {
      killHostedBrandedBot()
      await saveConfig('HOSTED_BRANDED_ENABLED', 'false', false)
      return NextResponse.json({ success: true, status: 'IDLE' })
    }
    if (status === 'RESTART') {
      killHostedBrandedBot()
      spawnHostedScript('hosted-branded-bot.js', 'OpenSteam-Hosted-Branded-Bot', 'hosted-branded-bot.log')
      await saveConfig('HOSTED_BRANDED_ENABLED', 'true', false)
      return NextResponse.json({ success: true, status: 'RUNNING' })
    }
    return NextResponse.json({ error: 'status must be RUNNING, IDLE, or RESTART' }, { status: 400 })
  }

  if (action === 'CUSTOM_MANAGER') {
    const status = String(body.status || '').toUpperCase()
    if (status === 'RUNNING' || status === 'RESTART') {
      killHostedCustomManager()
      spawnHostedScript('hosted-custom-bot-manager.js', 'OpenSteam-Hosted-Custom-Manager', 'hosted-custom-bot.log')
      await saveConfig('HOSTED_CUSTOM_MANAGER_ENABLED', 'true', false)
      return NextResponse.json({ success: true, status: 'RUNNING' })
    }
    if (status === 'IDLE') {
      killHostedCustomManager()
      await saveConfig('HOSTED_CUSTOM_MANAGER_ENABLED', 'false', false)
      return NextResponse.json({ success: true, status: 'IDLE' })
    }
    return NextResponse.json({ error: 'status must be RUNNING, IDLE, or RESTART' }, { status: 400 })
  }

  if (action === 'LOCK_ALL_BRANDED') {
    const locked = body.locked !== false
    const brandedInstances = await prisma.hostedBotInstance.findMany({ where: { type: 'BRANDED' } })
    for (const inst of brandedInstances) {
      await prisma.hostedBotInstance.update({
        where: { id: inst.id },
        data: locked
          ? {
              lockedByOwner: true,
              lockedReason: String(body.reason || 'Locked by platform owner'),
              status: 'LOCKED',
            }
          : {
              lockedByOwner: false,
              lockedReason: null,
              status: inst.guildId ? 'ACTIVE' : 'PENDING',
            },
      })
    }
    await prisma.auditLog.create({
      data: {
        userId: owner.id,
        action: locked ? 'HOSTED_BOT_LOCK_ALL_BRANDED' : 'HOSTED_BOT_UNLOCK_ALL_BRANDED',
        details: JSON.stringify({ reason: body.reason || null }),
      },
    })
    return NextResponse.json({ success: true, locked })
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}
