import { prisma } from './prisma'
import { Plan } from '@prisma/client'
import { sendBotDmWithFailover } from '@/app/lib/discord-bot-credentials'

/**
 * Global System Notification & Alert Utilities
 */

export interface NotificationAction {
  title?: string
  message: string
  description?: string
  type: 'warning' | 'error'
  active: boolean
}

/**
 * Creates/Updates the active system-wide notification.
 * Optionally triggers Discord DMs to Standard+ users.
 */
export async function setSystemNotification(data: NotificationAction) {
  // 1. Mark all current notifications as inactive
  await prisma.systemNotification.updateMany({
    where: { active: true },
    data: { active: false }
  })

  // 2. Create the new notification
  const notification = await prisma.systemNotification.create({
    data: {
      title: data.title,
      message: data.message,
      description: data.description,
      type: data.type,
      active: data.active
    }
  })

  // 3. If active and an issue is being reported, broadcast to Standard+ users via Discord DMs
  if (data.active) {
    // Only broadcast if it's a "standard+" user (Plan != FREE)
    // We do this as a fire-and-forget background task
    broadcastToStandardUsers(data.message, data.type, data.title, data.description).catch(err => {
      console.error('[Notification Broadcast] Failed to send DMs:', err)
    })
  }

  return notification
}

/**
 * Fetches the currently active global notification.
 */
export async function getActiveNotification() {
  return await prisma.systemNotification.findFirst({
    where: { active: true },
    orderBy: { createdAt: 'desc' }
  })
}

/**
 * Broadcasts a message to all users on paid plans via Discord DMs.
 */
async function broadcastToStandardUsers(message: string, type: string, titleOverride?: string, description?: string) {
  // Fetch all users with Standard+ plans (REGULAR, PREMIUM, RESELLER, BUSINESS, CUSTOM)
  const users = await prisma.user.findMany({
    where: {
      plan: { 
        in: [
          Plan.REGULAR, 
          Plan.PREMIUM, 
          Plan.RESELLER, 
          Plan.BUSINESS, 
          Plan.CUSTOM
        ]
      },
      isBanned: false,
      discordId: { 
        notIn: ['unknown', '', 'n/a', '0'] 
      }
    },
    select: { discordId: true, username: true }
  })

  console.log(`[Notification] Starting broadcast for ${users.length} users with concurrency...`)
  const startTime = Date.now()
  const color = type === 'error' ? 0xff4444 : 0xf59e0b
  const defaultTitle = type === 'error' ? '🔴 System Outage Alert' : '⚠️ System Maintenance Warning'
  const finalTitle = titleOverride || defaultTitle

  // Helper for single DM attempt
  const sendDM = async (user: any) => {
    try {
      const embed = {
        title: finalTitle,
        description: `Hello **${user.username}**,\n\n**${message}**\n\n${description ? `*Details:*\n${description}\n\n` : ''}*Check the dashboard for real-time status updates.*`,
        color,
        timestamp: new Date().toISOString(),
        footer: { text: 'OpenSteam Service Status' },
      }
      const result = await sendBotDmWithFailover(user.discordId, '', embed)
      if (!result.sent) {
        console.warn(`[Notification] Failed DM to ${user.username}:`, result.error)
      }
    } catch (err) {
      console.error(`[Notification] Error in DM task for ${user.discordId}:`, err)
    }
  }

  // Process in concurrent batches of 10
  const batchSize = 10
  for (let i = 0; i < users.length; i += batchSize) {
    const batch = users.slice(i, i + batchSize)
    await Promise.all(batch.map(u => sendDM(u)))
    if (i + batchSize < users.length) {
      await new Promise(resolve => setTimeout(resolve, 500)) // Safety delay
    }
  }

  console.log(`[Notification] Broadcast complete for ${users.length} users. Took ${Date.now() - startTime}ms`)
}
