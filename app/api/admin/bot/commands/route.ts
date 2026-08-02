import fs from 'fs'
import path from 'path'
import { authOptions } from '@/app/lib/auth-options'
import { prisma } from '@/app/lib/prisma'
import { getServerSession } from 'next-auth'
import { NextRequest, NextResponse } from 'next/server'
import { authenticateApiKey } from '@/app/lib/auth'
import axios from 'axios'

function getMainBotCommands(): any[] {
  const path = require('path')
  const registryPath = path.join(process.cwd(), 'scripts', 'register-commands.js')
  const { commands } = require(registryPath)
  if (!Array.isArray(commands) || commands.length === 0) {
    throw new Error('Main Discord command registry is empty or unavailable.')
  }
  return commands
}

/**
 * POST /api/admin/bot/commands
 * Registers slash commands for the Discord bot using keys from the database.
 */
export async function POST(request: NextRequest) {
  let body: any = {}
  try {
    // Clone and read body first to avoid "Body has already been read" errors
    // which can happen if middleware or auth handlers interfere.
    body = await request.clone().json().catch(() => ({}))
  } catch (e) {
    console.error('[Bot Control] Failed to parse body:', e)
  }

  // 1. Authenticate (Session or API Key)
  let user = null
  const auth = await authenticateApiKey(request, { skipUsage: true })
  
  if (auth) {
    user = auth.user
  } else {
    const session = await getServerSession(authOptions)
    if (session?.user) {
      user = await prisma.user.findUnique({
        where: { discordId: session.user.discordId as string }
      })
    }
  }

  if (!user || (user.role !== 'OWNER' && user.role !== 'ADMIN')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    const { action } = body

    if (action === 'REGISTER') {
      const tokenConfig = await prisma.systemConfig.findUnique({ where: { key: 'DISCORD_BOT_TOKEN' } })
      const clientId = process.env.DISCORD_CLIENT_ID
      const clientSecret = process.env.DISCORD_CLIENT_SECRET

      if (!tokenConfig?.value || !clientId || !clientSecret) {
        return NextResponse.json({ error: 'Missing Discord Bot Token in settings, or Client ID/Secret in environment variables.' }, { status: 400 })
      }

      const commands = getMainBotCommands()

      /*
       * Legacy dashboard command copy kept for audit/history only.
       * Do not use it for sync; Discord PUT replaces the complete command set.
       *
      const previousDashboardCommands = [
        {
          name: 'admin',
          description: 'Administrative commands for OpenSteam',
          options: [
            {
              name: 'stats',
              description: 'View real-time system health and storage stats',
              type: 1,
            },
            {
              name: 'user-info',
              description: 'Fetch detailed data about a user',
              type: 1,
              options: [
                {
                  name: 'user',
                  description: 'The User ID or Discord ID',
                  type: 3,
                  required: true,
                },
              ],
            },
            {
              name: 'set-plan',
              description: "Update a user's subscription plan",
              type: 1,
              options: [
                {
                  name: 'user',
                  description: 'The User ID or Discord ID',
                  type: 3,
                  required: true,
                },
                {
                  name: 'plan',
                  description: 'The target plan level',
                  type: 3,
                  required: true,
                  choices: [
                    { name: 'Free', value: 'FREE' },
                    { name: 'Regular', value: 'REGULAR' },
                    { name: 'Premium', value: 'PREMIUM' },
                    { name: 'Reseller', value: 'RESELLER' },
                    { name: 'Business', value: 'BUSINESS' },
                    { name: 'Custom', value: 'CUSTOM' },
                  ],
                },
              ],
            },
            {
              name: 'lookup-key',
              description: 'Look up an API key and its owner',
              type: 1,
              options: [
                {
                  name: 'key',
                  description: 'The full API key (e.g. mg_...)',
                  type: 3,
                  required: true,
                },
              ],
            },
            {
              name: 'ban',
              description: 'Ban a user from the platform',
              type: 1,
              options: [
                {
                  name: 'user',
                  description: 'The User ID or Discord ID of the user to ban',
                  type: 3,
                  required: true,
                },
                {
                  name: 'reason',
                  description: 'Reason for the ban',
                  type: 3,
                  required: false,
                },
              ],
            },
            {
              name: 'softban',
              description: 'Softban (kick and purge messages) a user from the Discord server',
              type: 1,
              options: [
                {
                  name: 'user',
                  description: 'The Discord User ID or Mention of the user to softban',
                  type: 3,
                  required: true,
                },
                {
                  name: 'reason',
                  description: 'Reason for the softban',
                  type: 3,
                  required: false,
                },
              ],
            },
            {
              name: 'kick',
              description: 'Kick a user from the Discord server',
              type: 1,
              options: [
                {
                  name: 'user',
                  description: 'The Discord User ID or Mention of the user to kick',
                  type: 3,
                  required: true,
                },
                {
                  name: 'reason',
                  description: 'Reason for the kick',
                  type: 3,
                  required: false,
                },
              ],
            },
            {
              name: 'manifest',
              description: 'Check if a game manifest exists in the database',
              type: 1,
              options: [
                {
                  name: 'appid',
                  description: 'The Steam App ID to check',
                  type: 3,
                  required: true,
                },
              ],
            },
            {
              name: 'lookup-ip',
              description: 'Check security logs and risk score for an IP address',
              type: 1,
              options: [
                {
                  name: 'ip',
                  description: 'The IPv4 or IPv6 address to investigate',
                  type: 3,
                  required: true,
                },
              ],
            },
            {
              name: 'unban',
              description: 'Unban a user on the platform',
              type: 1,
              options: [
                {
                  name: 'user',
                  description: 'The User ID or Discord ID of the user to unban',
                  type: 3,
                  required: true,
                },
                {
                  name: 'reason',
                  description: 'Reason for the unban',
                  type: 3,
                  required: false,
                },
              ],
            },
            {
              name: 'pullback',
              description: 'Force-join authorized users back into the Discord server',
              type: 1,
              options: [
                {
                  name: 'user',
                  description: 'Optional OpenSteam user ID or Discord ID (omit for all users)',
                  type: 3,
                  required: false,
                },
              ],
            },
            {
              name: 'merge',
              description: 'Detect users with role 1493956344925917184 and assign 1473719437692637288 if only role',
              type: 1,
            },
          ],
        },
        {
          name: 'gen',
          description: 'Generate a manifest for a Steam App ID',
          options: [
            {
              name: 'appid',
              description: 'Numeric Steam App ID (e.g. 730)',
              type: 4,
              required: true,
              min_value: 1,
            },
          ],
        },
        {
          name: 'dlcgen',
          description: 'Generate DLC Lua for a Steam App ID',
          options: [
            {
              name: 'appid',
              description: 'Numeric Steam App ID (e.g. 730)',
              type: 4,
              required: true,
              min_value: 1,
            },
          ],
        },
        {
          name: 'autogen',
          description: 'Generate pending requested games from Ryuu/Morrenus into the database',
          options: [
            {
              name: 'action',
              description: 'Run now, enable/disable the daily job, or show status',
              type: 3,
              required: false,
              choices: [
                { name: 'Run now', value: 'run' },
                { name: 'Enable daily', value: 'enable' },
                { name: 'Disable daily', value: 'disable' },
                { name: 'Status', value: 'status' },
              ],
            },
            {
              name: 'limit',
              description: 'How many pending requests to process (default 10, max 25)',
              type: 4,
              required: false,
              min_value: 1,
              max_value: 25,
            },
            {
              name: 'request_id',
              description: 'Optional specific OpenSteam request ID to process',
              type: 3,
              required: false,
            },
          ],
        },
        {
          name: 'status',
          description: 'Check your current account status and daily usage'
        },
        {
          name: 'request',
          description: 'Request a new game manifest to be added to OpenSteam',
          options: [
            {
              name: 'appid',
              description: 'The Steam App ID of the game',
              type: 3,
              required: true
            },
            {
              name: 'comment',
              description: 'Optional comment/reason for the request',
              type: 3,
              required: false
            }
          ]
        },
        {
          name: 'self-adv',
          description: 'DM a specific message to all registered users and all members of the guild',
          options: [
            {
              name: 'message',
              description: 'The message to send',
              type: 3,
              required: true
            }
          ]
        },
        {
          name: 'drop',
          description: 'Drop accounts from a platform pool in drops/ (Administrator only)',
          default_member_permissions: '8', // ADMINISTRATOR permission flag
          options: [
            {
              name: 'count',
              description: 'How many accounts to drop (1–25)',
              type: 4, // INTEGER
              required: true,
              min_value: 1,
              max_value: 25,
            },
            {
              name: 'platform',
              description: 'Platform pool (drops/steam.txt, netflix.txt, etc.)',
              type: 3, // STRING
              required: true,
              autocomplete: true,
            },
            {
              name: 'min_games',
              description: 'Minimum games required on the account (Steam pools)',
              type: 4, // INTEGER
              required: false,
              min_value: 0,
            }
          ]
        },
        {
          name: 'promote',
          description: 'Promote a member by one role higher in the hierarchy, or directly to a target role.',
          default_member_permissions: '8',
          options: [
            {
              name: 'user',
              description: 'The member to promote',
              type: 6,
              required: true
            },
            {
              name: 'role',
              description: 'Target role to promote directly to',
              type: 8,
              required: false
            }
          ]
        },
        {
          name: 'demote',
          description: 'Demote a member by one role lower in the hierarchy, or directly from a target role.',
          default_member_permissions: '8',
          options: [
            {
              name: 'user',
              description: 'The member to demote',
              type: 6,
              required: true
            },
            {
              name: 'role',
              description: 'Target role to demote directly from',
              type: 8,
              required: false
            }
          ]
        },
        {
          name: 'warn',
          description: 'Formally warn a member, log it in the database audit log, and DM them the warning.',
          default_member_permissions: '8',
          options: [
            {
              name: 'user',
              description: 'The member to warn',
              type: 6,
              required: true
            },
            {
              name: 'reason',
              description: 'The reason for the warning',
              type: 3,
              required: true
            },
            {
              name: 'proof',
              description: 'Image/screenshot proof of the infraction',
              type: 11,
              required: false
            }
          ]
        },
        {
          name: 'timeout',
          description: 'Time out / mute a member in the guild for a specified duration.',
          default_member_permissions: '8',
          options: [
            {
              name: 'user',
              description: 'The member to timeout',
              type: 6,
              required: true
            },
            {
              name: 'duration',
              description: 'Duration (e.g. 60s, 5m, 1h, 1d, 7d)',
              type: 3,
              required: true
            },
            {
              name: 'reason',
              description: 'Reason for the timeout',
              type: 3,
              required: false
            },
            {
              name: 'proof',
              description: 'Image/screenshot proof of the infraction',
              type: 11,
              required: false
            }
          ]
        },
        {
          name: 'modlogs',
          description: "View a member's moderation infractions and action history.",
          default_member_permissions: '8',
          options: [
            {
              name: 'user',
              description: 'The user to check modlogs for',
              type: 6,
              required: true
            }
          ]
        },
        {
          name: 'grantrole',
          description: 'Grant a role to every member who has another role',
          default_member_permissions: '8',
          options: [
            {
              name: 'has_role',
              description: 'Members must have this role (e.g. unverified)',
              type: 8,
              required: true,
            },
            {
              name: 'grant_role',
              description: 'Role to add to those members (e.g. verified)',
              type: 8,
              required: true,
            },
          ],
        },
        {
          name: 'Report Message',
          type: 3
        }
      ]
      void previousDashboardCommands
      */

      const guildConfig = await prisma.systemConfig.findUnique({ where: { key: 'DISCORD_GUILD_ID' } })

      const headers = {
        Authorization: `Bot ${tokenConfig.value}`,
        'Content-Type': 'application/json',
      }

      // Step 1: Clear global commands to prevent duplicates (global + guild = doubled commands in Discord)
      await axios.put(
        `https://discord.com/api/v10/applications/${clientId}/commands`,
        [],
        { headers }
      )

      if (!guildConfig?.value) {
        return NextResponse.json({ error: 'DISCORD_GUILD_ID not configured in settings.' }, { status: 400 })
      }

      // Step 2: Register all commands guild-specifically (instant, no 1-hour delay)
      const guildResponse = await axios.put(
        `https://discord.com/api/v10/applications/${clientId}/guilds/${guildConfig.value}/commands`,
        commands,
        { headers }
      )

      await prisma.auditLog.create({
        data: {
          userId: user.id,
          action: 'BOT_SYNC',
          details: `Synchronized Discord Bot commands in guild ${guildConfig.value}: ${guildResponse.data.map((c: any) => c.name).join(', ')}`,
          ip: request.headers.get('x-forwarded-for') || '127.0.0.1'
        }
      })

      return NextResponse.json({
        success: true,
        message: `Commands synchronized instantly in your guild.`
      })
    }

    if (action === 'STATUS_CHANGE') {
      const { status: targetStatus } = body
      
      const tokenConfig = await prisma.systemConfig.findUnique({ where: { key: 'DISCORD_BOT_TOKEN' } })
      if (!tokenConfig?.value) {
         return NextResponse.json({ error: 'No token configured.' }, { status: 400 })
      }

      const { spawn, execSync } = await import('child_process')
      const path = await import('path')

      // 1. If target is RUNNING, attempt to spawn daemon
      if (targetStatus === 'RUNNING') {
        try {
          // Check if already running (simplified check)
          // On many systems we can use pgrep or tasklist, but for a simple fix:
          // We try to kill any existing node process running bot-daemon.js
          if (process.platform === 'win32') {
             try {
               const pidFile = path.join(process.cwd(), 'data/bot.pid');
               if (fs.existsSync(pidFile)) {
                 const pid = fs.readFileSync(pidFile, 'utf8').trim();
                 if (pid) execSync(`taskkill /F /PID ${pid}`, { stdio: 'ignore' });
               }
             } catch (e) {}
             try {
                const psCmd = 'powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.Name -eq \'node.exe\' -and $_.CommandLine -like \'*bot-daemon.js*\' } | Select-Object -ExpandProperty ProcessId"';
                const pids = execSync(psCmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).split(/\r?\n/).map(p => p.trim()).filter(Boolean);
                pids.forEach(pid => {
                  if (pid && Number(pid) !== process.pid) {
                    try { execSync(`taskkill /F /PID ${pid}`, { stdio: 'ignore' }); } catch (_) {}
                  }
                });
              } catch (e) {}
          } else {
             try { execSync('pkill -f scripts/bot-daemon.js', { stdio: 'ignore' }) } catch(e){}
          }
          
          const scriptPath = path.join(process.cwd(), 'scripts/bot-daemon.js')
          
          // Spawn the bot as a background process
          const botProcess = spawn('node', [scriptPath], {
            detached: true,
            stdio: 'ignore', // Important for serverless/detached processes
            cwd: process.cwd(),
            env: { ...process.env }
          })

          botProcess.unref() // Allow the parent (API route) to exit without killing the child
          
          // Persist state for auto-restart after redeploy
          await prisma.systemConfig.upsert({
            where: { key: 'DISCORD_BOT_ENABLED' },
            update: { value: 'true' },
            create: { key: 'DISCORD_BOT_ENABLED', value: 'true' }
          });

          console.log(`[Bot Control] Spawned bot daemon at PID: ${botProcess.pid}`)
        } catch (err: any) {
          console.error('[Bot Control] Spawn error:', err.message)
          return NextResponse.json({ error: `Failed to spawn bot: ${err.message}` }, { status: 500 })
        }
      } 
      
      // 2. If target is IDLE, stop the daemon
      if (targetStatus === 'IDLE') {
        if (process.platform === 'win32') {
          try {
            const pidFile = path.join(process.cwd(), 'data/bot.pid');
            if (fs.existsSync(pidFile)) {
              const pid = fs.readFileSync(pidFile, 'utf8').trim();
              if (pid) execSync(`taskkill /F /PID ${pid}`, { stdio: 'ignore' });
            }
          } catch (e) {}
          try {
            const psCmd = 'powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.Name -eq \'node.exe\' -and $_.CommandLine -like \'*bot-daemon.js*\' } | Select-Object -ExpandProperty ProcessId"';
            const pids = execSync(psCmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).split(/\r?\n/).map(p => p.trim()).filter(Boolean);
            pids.forEach(pid => {
              if (pid && Number(pid) !== process.pid) {
                try { execSync(`taskkill /F /PID ${pid}`, { stdio: 'ignore' }); } catch (_) {}
              }
            });
          } catch (e) {}
        } else {
          try { execSync('pkill -f scripts/bot-daemon.js', { stdio: 'ignore' }) } catch (e) { }
        }

        // Persist state
        await prisma.systemConfig.upsert({
          where: { key: 'DISCORD_BOT_ENABLED' },
          update: { value: 'false' },
          create: { key: 'DISCORD_BOT_ENABLED', value: 'false' }
        });
      }

      await prisma.auditLog.create({
        data: {
          userId: user.id,
          action: 'BOT_CONTROL',
          details: `Bot operation performed: ${targetStatus}`,
          ip: request.headers.get('x-forwarded-for') || '127.0.0.1'
        }
      })

      return NextResponse.json({ success: true, status: targetStatus })
    }

    if (action === 'MANUAL_DROP') {
      const { count, minGames, platform } = body
      const dropCount = parseInt(count) || 1
      const minGamesFilter = parseInt(minGames) || 0
      const dropPlatform = typeof platform === 'string' ? platform.trim() : ''

      if (dropCount < 1 || dropCount > 25) {
        return NextResponse.json({ error: 'Count must be between 1 and 25.' }, { status: 400 })
      }
      if (!dropPlatform) {
        return NextResponse.json({ error: 'Platform is required (e.g. steam, netflix).' }, { status: 400 })
      }

      // Execute drop using bot-admin helper
      const { executeAccountDrop } = require('@/app/lib/bot-admin')
      const result = await executeAccountDrop(
        dropCount,
        user.discordId || '1505274869477146684',
        minGamesFilter,
        dropPlatform
      )

      if (result.success) {
        await prisma.auditLog.create({
          data: {
            userId: user.id,
            action: 'BOT_DROP',
            details: `Manually triggered drop of ${dropCount} accounts via Admin Panel: ${result.message}`,
            ip: request.headers.get('x-forwarded-for') || '127.0.0.1'
          }
        })
        return NextResponse.json({ success: true, message: result.message })
      } else {
        return NextResponse.json({ error: result.message }, { status: 500 })
      }
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })

  } catch (error: any) {
    const errorMsg = error.response?.data?.message || error.message || 'Unknown error'
    console.error('[Bot Control Error]', error.response?.data || error.message)
    return NextResponse.json({ error: `Bot Error: ${errorMsg}` }, { status: 500 })
  }
}
