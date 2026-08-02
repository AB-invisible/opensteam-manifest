import { NextRequest, NextResponse } from 'next/server'
import * as crypto from 'crypto'
import * as fs from 'fs'
import * as path from 'path'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/app/lib/auth-options'
import {
  getSystemStatsEmbed,
  banUserViaBot,
  checkManifestStatus,
  createDonation,
  approveDonation,
  rejectDonation,
  executeAccountDrop,
} from '@/app/lib/bot-admin'

// Discord Interaction Types
const PING = 1
const APPLICATION_COMMAND = 2
const MESSAGE_COMPONENT = 3
const APPLICATION_COMMAND_AUTOCOMPLETE = 4

// Discord Interaction Response Types
const PONG = 1
const CHANNEL_MESSAGE_WITH_SOURCE = 4
const DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE = 5
const DEFERRED_UPDATE_MESSAGE = 6
const UPDATE_MESSAGE = 7
const APPLICATION_COMMAND_AUTOCOMPLETE_RESULT = 8

/**
 * Verifies a Discord interaction signature using Node.js crypto.
 */
function verifySignature(body: string, signature: string, timestamp: string, publicKey: string): boolean {
  try {
    if (!publicKey || !signature || !timestamp) return false;
    const publicKeyBuffer = Buffer.concat([
      Buffer.from([0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00]),
      Buffer.from(publicKey, 'hex')
    ]);
    const key = crypto.createPublicKey({
      key: publicKeyBuffer,
      format: 'der',
      type: 'spki',
    });
    return crypto.verify(
      undefined,
      Buffer.from(timestamp + body),
      key,
      Buffer.from(signature, 'hex')
    );
  } catch (e) {
    return false;
  }
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const action = searchParams.get('action')

  if (action === 'get_games') {
    const session = await getServerSession(authOptions)
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    try {
      const fs = await import('fs')
      const path = await import('path')
      const listPath = path.join(process.cwd(), 'list.json')
      
      if (fs.existsSync(listPath)) {
        const fileContent = fs.readFileSync(listPath, 'utf8')
        const games = JSON.parse(fileContent)
        return NextResponse.json({ games })
      }
    } catch (err) {
      console.error('[API Admin] Error reading list.json:', err)
    }

    // Fallback to database if file is missing or invalid
    const { prisma } = await import('@/app/lib/prisma')
    const games = await prisma.manifest.findMany({
      select: {
        name: true,
        steamAppId: true
      },
      orderBy: {
        name: 'asc'
      }
    })
    
    return NextResponse.json({ 
      games: games.map(g => ({ name: g.name, appId: parseInt(g.steamAppId) })) 
    })
  }

  return new NextResponse('Method Not Allowed', { status: 405 })
}

export async function POST(request: NextRequest) {
  const signature = request.headers.get('x-signature-ed25519')
  const timestamp = request.headers.get('x-signature-timestamp')
  const body = await request.text()

  const { prisma } = await import('@/app/lib/prisma')
  const config = await prisma.systemConfig.findUnique({ where: { key: 'DISCORD_ADMIN_PUBLIC_KEY' } })
  const PUBLIC_KEY = config?.value || process.env.DISCORD_ADMIN_PUBLIC_KEY || ''

  if (!signature || !timestamp || !verifySignature(body, signature, timestamp, PUBLIC_KEY)) {
    return new NextResponse('Invalid request signature', { status: 401 })
  }

  const interaction = JSON.parse(body)

  // 1. Handle Ping
  if (interaction.type === PING) {
    return NextResponse.json({ type: PONG })
  }

  // 2. Handle Autocomplete
  if (interaction.type === APPLICATION_COMMAND_AUTOCOMPLETE) {
    return NextResponse.json({
      type: APPLICATION_COMMAND_AUTOCOMPLETE_RESULT,
      data: { choices: [] }
    })
  }

  // 3. Handle Application Command
  if (interaction.type === APPLICATION_COMMAND) {
    const { name, options } = interaction.data
    const command = name === 'admin' ? options?.[0]?.name : name
    const subOptions = options?.[0]?.options || options
    const discordId = interaction.member?.user?.id || interaction.user?.id

    switch (command) {
      case 'stats': {
        const embed = await getSystemStatsEmbed()
        return NextResponse.json({
          type: CHANNEL_MESSAGE_WITH_SOURCE,
          data: { embeds: [embed] }
        })
      }


      case 'ban': {
        const userId = subOptions?.find((o: any) => o.name === 'user')?.value
        const reason = subOptions?.find((o: any) => o.name === 'reason')?.value || 'No reason provided.'
        
        if (!userId) return NextResponse.json({ type: CHANNEL_MESSAGE_WITH_SOURCE, data: { content: '❌ Missing User ID.' } })
        
        const result = await banUserViaBot(userId, reason)
        return NextResponse.json({
          type: CHANNEL_MESSAGE_WITH_SOURCE,
          data: { content: result.success ? `✅ ${result.message}` : `❌ ${result.message}` }
        })
      }

      case 'manifest': {
        const appId = subOptions?.find((o: any) => o.name === 'appid')?.value
        if (!appId) return NextResponse.json({ type: CHANNEL_MESSAGE_WITH_SOURCE, data: { content: '❌ Missing App ID.' } })

        const status = await checkManifestStatus(appId)
        if (!status.exists) {
          return NextResponse.json({
            type: CHANNEL_MESSAGE_WITH_SOURCE,
            data: { content: `🔍 Manifest for \`${appId}\` does **not** exist in the database.` }
          })
        }

        return NextResponse.json({
          type: CHANNEL_MESSAGE_WITH_SOURCE,
          data: {
            content: `📖 **Manifest Found**\n**Name**: ${status.name}\n**Downloads**: ${status.downloads}\n**Indexed**: ${new Date(status.createdAt!).toLocaleDateString()}`
          }
        })
      }

      case 'drop': {
        // Discord enforces default_member_permissions: '8' (ADMINISTRATOR) at the API level,
        // but we double-check here so the handler is safe if called without that guard.
        const memberPermissions = BigInt(interaction.member?.permissions ?? '0')
        const ADMINISTRATOR = BigInt(0x8)
        if ((memberPermissions & ADMINISTRATOR) === BigInt(0)) {
          return NextResponse.json({
            type: CHANNEL_MESSAGE_WITH_SOURCE,
            data: { content: '❌ You need the **Administrator** permission to use this command.', flags: 64 }
          })
        }

        const count = subOptions?.find((o: any) => o.name === 'count')?.value ?? 1
        const platform = subOptions?.find((o: any) => o.name === 'platform')?.value
        const minGames = subOptions?.find((o: any) => o.name === 'min_games')?.value
        const dropDiscordId = interaction.member?.user?.id || interaction.user?.id

        const result = await executeAccountDrop(
          Number(count),
          dropDiscordId,
          minGames != null ? Number(minGames) : undefined,
          platform
        )
        return NextResponse.json({
          type: CHANNEL_MESSAGE_WITH_SOURCE,
          data: {
            content: result.success
              ? `✅ ${result.message}`
              : `❌ ${result.message}`,
            flags: 64 // ephemeral — only visible to the admin who ran /drop
          }
        })
      }

      default:
        return NextResponse.json({
          type: CHANNEL_MESSAGE_WITH_SOURCE,
          data: { content: '❓ Unknown command.' }
        })
    }
  }

  // 4. Handle Button Interactions
  if (interaction.type === MESSAGE_COMPONENT) {
    const { custom_id } = interaction.data
    const discordId = interaction.member?.user?.id || interaction.user?.id

    // Check staff/admin permissions
    const userInDb = await prisma.user.findUnique({ where: { discordId } })
    if (!userInDb || (userInDb.role !== 'ADMIN' && userInDb.role !== 'OWNER')) {
      return NextResponse.json({
        type: CHANNEL_MESSAGE_WITH_SOURCE,
        data: { content: '❌ Unauthorized. Staff visibility only.', flags: 64 } // Ephemeral
      })
    }

    if (custom_id.startsWith('donation_approve_')) {
      const donationId = custom_id.replace('donation_approve_', '')
      const result = await approveDonation(donationId)
      
      return NextResponse.json({
        type: UPDATE_MESSAGE,
        data: { 
          content: result.success ? `✅ Approved by <@${discordId}>` : `❌ ${result.message}`,
          components: [] // Remove buttons
        }
      })
    }

    if (custom_id.startsWith('donation_reject_')) {
      const donationId = custom_id.replace('donation_reject_', '')
      const result = await rejectDonation(donationId)
      
      return NextResponse.json({
        type: UPDATE_MESSAGE,
        data: { 
          content: result.success ? `❌ Rejected by <@${discordId}>` : `❌ ${result.message}`,
          components: [] // Remove buttons
        }
      })
    }
  }

  return NextResponse.json({ type: PONG })
}
