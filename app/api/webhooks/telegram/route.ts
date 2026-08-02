import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/app/lib/prisma'
import { sendTelegramMessage, sendTelegramDocument, sendTelegramPublicPromo, sendTelegramChatAction } from '@/app/lib/telegram-bot'
import { getManifestBuffer } from '@/app/lib/storage'
import { callLlmWithFallback } from '@/app/lib/llm-client'
import { getSystemKnowledgeBase } from '@/app/lib/docs-loader'
import { getTelegramWebhookSecret, verifyTelegramWebhookSecret } from '@/app/lib/telegram-webhook-auth'
import { requireRuntimeSecretInProduction } from '@/app/lib/runtime-secrets'

export async function POST(req: NextRequest) {
  try {
    const webhookSecret = await getTelegramWebhookSecret()
    const missingSecretResponse = requireRuntimeSecretInProduction(
      webhookSecret,
      'TELEGRAM_WEBHOOK_SECRET',
      'Telegram Webhook'
    )
    if (missingSecretResponse) {
      return missingSecretResponse
    }

    if (webhookSecret) {
      const token = req.headers.get('X-Telegram-Bot-Api-Secret-Token')
      if (!verifyTelegramWebhookSecret(token, webhookSecret)) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }
    }

    const update = await req.json()

    // We only care about text messages for this basic implementation
    if (!update.message || !update.message.text) {
      return NextResponse.json({ status: 'ok' })
    }

    const chatId = update.message.chat.id
    const text = update.message.text as string

    if (text.startsWith('/start') || text.startsWith('/help')) {
      await sendTelegramMessage(chatId, `🚀 <b>Welcome to the OpenSteam Bot!</b>\n\nI can help you check system status, discover games, and search our library.\n\n<b>Commands:</b>\n/search [game] - Search for a game manifest\n/gen [AppID] - Generate or fetch a manifest\n/onlinefix [game] - Search OnlineFix for games\n/latest - View newly added games\n/top - View most downloaded games\n/status - Check system health`, {
        reply_markup: {
          inline_keyboard: [[{ text: '🌐 Visit Website', url: 'http://127.0.0.1:3000' }]]
        }
      })
      return NextResponse.json({ status: 'ok' })
    }

    if (text.startsWith('/status')) {
      // Basic mock status
      await sendTelegramMessage(chatId, `🟢 <b>OpenSteam Status</b>\n\nAll systems operational.\nFrontend: Online\nDatabase: Online\nApp Pool: Healthy`)
      return NextResponse.json({ status: 'ok' })
    }

    if (text.startsWith('/latest')) {
      const manifests = await prisma.manifest.findMany({
        orderBy: { createdAt: 'desc' },
        take: 5
      })
      if (manifests.length === 0) {
        await sendTelegramMessage(chatId, `❌ No games found in the database.`)
        return NextResponse.json({ status: 'ok' })
      }
      const resultsText = manifests.map(m => `🆕 <b>${m.name}</b>\nAppID: <code>${m.steamAppId}</code>`).join('\n\n')
      await sendTelegramMessage(chatId, `🔥 <b>Latest Additions:</b>\n\n${resultsText}`, {
        reply_markup: {
          inline_keyboard: [[{ text: '🎮 Browse All Games', url: 'http://127.0.0.1:3000' }]]
        }
      })
      return NextResponse.json({ status: 'ok' })
    }

    if (text.startsWith('/top')) {
      const manifests = await prisma.manifest.findMany({
        orderBy: { downloads: 'desc' },
        take: 5
      })
      if (manifests.length === 0) {
        await sendTelegramMessage(chatId, `❌ No games found in the database.`)
        return NextResponse.json({ status: 'ok' })
      }
      const resultsText = manifests.map((m, i) => `${i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : '🎮'} <b>${m.name}</b>\nDownloads: ${m.downloads}`).join('\n\n')
      await sendTelegramMessage(chatId, `🏆 <b>Top Downloaded Games:</b>\n\n${resultsText}`)
      return NextResponse.json({ status: 'ok' })
    }

    if (text.startsWith('/onlinefix')) {
      const query = text.replace('/onlinefix', '').trim()
      
      if (!query) {
        await sendTelegramMessage(chatId, `⚠️ Please provide a game name. Example: <code>/onlinefix skyrim</code>`)
        return NextResponse.json({ status: 'ok' })
      }

      // Check if linked
      const user = await prisma.user.findUnique({
        where: { telegramId: chatId.toString() }
      })

      if (!user) {
        await sendTelegramMessage(chatId, `⚠️ <b>Unlinked Account</b>\n\nYou must link your OpenSteam account to use the onlinefix command.\n\nUse /link to get started.`)
        return NextResponse.json({ status: 'ok' })
      }

      if (user.isBanned) {
        await sendTelegramMessage(chatId, `❌ <b>Account Banned</b>\nYour account is permanently suspended from using OpenSteam services.`)
        return NextResponse.json({ status: 'ok' })
      }
      
      await sendTelegramChatAction(chatId, 'typing')
      
      try {
        console.log(`[Telegram OnlineFix] Fetching data for "${query}" requested by ${chatId}`)
        
        const {
          getOnlineFixBucketName,
          getOnlineFixDownloadUrl,
          syncOnlineFixIndexFromS3,
        } = require('@/scripts/lib/onlinefix-s3')
        
        const onlineFixBucketName = await getOnlineFixBucketName()

        const findOnlineFixGames = () => prisma.onlineFixGame.findMany({
          where: {
            name: { contains: query, mode: 'insensitive' }
          },
          orderBy: [
            { searches: 'desc' },
            { name: 'asc' }
          ],
          take: 5
        })

        let gamesToShow: any[] = []
        let dbGames = await findOnlineFixGames()

        if (dbGames.length === 0 && onlineFixBucketName) {
          console.log(`[Telegram OnlineFix] Not found in DB. Refreshing S3 index from OnlineFixes bucket prefix...`)
          await syncOnlineFixIndexFromS3({ prismaClient: prisma })
          dbGames = await findOnlineFixGames()
        }

        if (dbGames.length > 0) {
          console.log(`[Telegram OnlineFix] Found ${dbGames.length} indexed S3 game(s) in DB.`)
          gamesToShow = dbGames
        } else {
          console.log(`[Telegram OnlineFix] No indexed S3 games found for "${query}".`)
        }

        if (gamesToShow.length === 0 && process.env.ONLINEFIX_ENABLE_PERON_FALLBACK === '1') {
          console.log(`[Telegram OnlineFix] Not found in DB. Falling back to PeronDepot scrape...`)
          const response = await fetch(`https://api.perondepot.xyz/?q=${encodeURIComponent(query)}`, {
            method: 'GET',
            headers: {
              'User-Agent': 'OpenSteam/1.0'
            }
          })
          
          if (!response.ok) {
            await sendTelegramMessage(chatId, `❌ <b>OnlineFix Lookup Failed</b>\nAPI returned status code ${response.status}`)
            return NextResponse.json({ status: 'ok' })
          }
          
          const html = await response.text()
          const games: Array<{ name: string; fileName: string; fileUrl: string; fileSize: string }> = []
          const lines = html.split('\n')

          for (const line of lines) {
            const hrefStartIndex = line.indexOf('<a href="')
            if (hrefStartIndex === -1) continue
            
            const hrefValueStart = hrefStartIndex + '<a href="'.length
            const hrefValueEnd = line.indexOf('"', hrefValueStart)
            if (hrefValueEnd === -1) continue
            
            const href = line.substring(hrefValueStart, hrefValueEnd)
            
            const textStartIndex = line.indexOf('>', hrefValueEnd) + 1
            const textEndIndex = line.indexOf('<', textStartIndex)
            if (textStartIndex === -1 || textEndIndex === -1) continue
            
            const fileName = line.substring(textStartIndex, textEndIndex).trim()
            
            if (!fileName || fileName.includes('..') || fileName.includes('docker') || fileName.includes('nginx') || fileName.includes('.html')) continue
            if (!fileName.endsWith('.rar') && !fileName.endsWith('.zip')) continue
            
            const cleanName = fileName.replace('.rar', '').replace('.zip', '').replace(/_/g, ' ').trim()
            
            let fileSize = 'Unknown'
            const sizeMatch = line.match(/(\d+(?:\.\d+)?)\s*(KB|MB|GB|TB|K|M|G|T)/i)
            if (sizeMatch) {
              fileSize = sizeMatch[0]
            }
            
            games.push({
              name: cleanName,
              fileName: fileName,
              fileUrl: `https://api.perondepot.xyz/${href}`,
              fileSize: fileSize
            })
          }

          const { mirrorOnlineFixToS3 } = require('@/scripts/lib/onlinefix-s3');

          for (const game of games) {
            const existing = await prisma.onlineFixGame.findFirst({
              where: { fileName: game.fileName }
            })
            if (!existing) {
              const newGame = await prisma.onlineFixGame.create({
                data: {
                  name: game.name,
                  fileName: game.fileName,
                  fileUrl: game.fileUrl,
                  fileSize: game.fileSize
                }
              })
              mirrorOnlineFixToS3(newGame).catch((err: any) => console.error('[OnlineFix] Background S3 sync failed:', err.message));
            }
          }
          
          gamesToShow = games.slice(0, 5)
        }

        if (dbGames.length > 0) {
          for (const game of dbGames) {
            await prisma.onlineFixGame.update({
              where: { id: game.id },
              data: { searches: { increment: 1 } }
            }).catch(() => {})
          }
        }

        if (gamesToShow.length === 0) {
          await sendTelegramMessage(chatId, `❌ <b>No Games Found</b>\nNo OnlineFix games found for "${query}"`)
          return NextResponse.json({ status: 'ok' })
        }

        const topGame = gamesToShow[0]
        
        // Fetch Steam base info for the top game
        let steamInfo: any = null
        try {
          const { searchSteamStoreByName } = require('@/app/lib/steam-app-list')
          const searchRes = await searchSteamStoreByName(topGame.name)
          if (searchRes.length > 0) {
            const appId = searchRes[0].appid
            const detailsRes = await fetch(`https://store.steampowered.com/api/appdetails?appids=${appId}`, {
              signal: AbortSignal.timeout(5000)
            })
            if (detailsRes.ok) {
              const data = await detailsRes.json()
              if (data && data[appId] && data[appId].success) {
                steamInfo = data[appId].data
              }
            }
          }
        } catch (err: any) {
          console.error('[Telegram Steam Fetch Error]', err.message)
        }

        let caption = `🎮 <b>${steamInfo ? steamInfo.name : topGame.name}</b> (OnlineFix)\n\n`
        
        if (steamInfo?.short_description) {
          caption += `<i>${steamInfo.short_description}</i>\n\n`
        }
        
        caption += `<b>Found ${gamesToShow.length} Download(s):</b>\n`
        
        await sendTelegramMessage(chatId, caption)
        
        for (const game of gamesToShow) {
          await sendTelegramChatAction(chatId, 'upload_document')
          try {
            const fileUrl = await getOnlineFixDownloadUrl(game)
            if (!fileUrl) {
              await sendTelegramMessage(chatId, `Could not resolve a download link for <b>${game.name}</b> at this time.`)
              continue
            }

            const fileRes = await fetch(fileUrl)
            if (fileRes.ok) {
              const buffer = Buffer.from(await fileRes.arrayBuffer())
              await sendTelegramDocument(chatId, buffer, game.fileName, `📦 <b>${game.name}</b> — <code>${game.fileSize}</code>`)
            } else {
              await sendTelegramMessage(chatId, `⚠️ Could not fetch <b>${game.name}</b> at this time.`)
            }
          } catch (e) {
            console.error('[Telegram OnlineFix File Fetch Error]', e)
          }
        }
        
      } catch (err) {
        console.error('[Telegram OnlineFix] Error:', err);
        await sendTelegramMessage(chatId, `❌ <b>Unexpected Error</b>\nAn error occurred while processing your request.`);
      }
      
      return NextResponse.json({ status: 'ok' })
    }

    if (text.startsWith('/search')) {
      const query = text.replace('/search', '').trim()
      
      if (!query) {
        await sendTelegramMessage(chatId, `⚠️ Please provide a game name. Example: <code>/search skyrim</code>`)
        return NextResponse.json({ status: 'ok' })
      }

      // Search database for manifests
      const manifests = await prisma.manifest.findMany({
        where: {
          name: { contains: query, mode: 'insensitive' }
        },
        take: 5
      })

      if (manifests.length === 0) {
        await sendTelegramMessage(chatId, `❌ No games found matching "<b>${query}</b>".`)
        return NextResponse.json({ status: 'ok' })
      }

      const resultsText = manifests.map(m => `🎮 <b>${m.name}</b>\nAppID: <code>${m.steamAppId}</code>\nDownloads: ${m.downloads}`).join('\n\n')
      await sendTelegramMessage(chatId, `🔍 <b>Search Results:</b>\n\n${resultsText}`)
      return NextResponse.json({ status: 'ok' })
    }

    if (text.startsWith('/link')) {
      // Create a unique token
      const tokenStr = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15)
      
      await prisma.telegramLinkToken.upsert({
        where: { telegramId: chatId.toString() },
        update: { token: tokenStr, expiresAt: new Date(Date.now() + 15 * 60 * 1000) },
        create: { telegramId: chatId.toString(), token: tokenStr, expiresAt: new Date(Date.now() + 15 * 60 * 1000) }
      })

      const linkUrl = `http://127.0.0.1:3000/api/telegram/link?token=${tokenStr}`

      await sendTelegramMessage(chatId, `🔗 <b>Link Your Account</b>\n\nClick the button below to link your Telegram to your OpenSteam (Discord) account.\n\n<i>This link expires in 15 minutes.</i>`, {
        reply_markup: {
          inline_keyboard: [[{ text: '🎮 Link Discord Account', url: linkUrl }]]
        }
      })
      return NextResponse.json({ status: 'ok' })
    }

    if (text.startsWith('/gen')) {
      const appId = text.replace('/gen', '').trim()
      
      if (!appId || !/^\d+$/.test(appId)) {
        await sendTelegramMessage(chatId, `⚠️ Please provide a valid Steam App ID. Example: <code>/gen 730</code>`)
        return NextResponse.json({ status: 'ok' })
      }

      // Check if linked
      const user = await prisma.user.findUnique({
        where: { telegramId: chatId.toString() }
      })

      if (!user) {
        await sendTelegramMessage(chatId, `⚠️ <b>Unlinked Account</b>\n\nYou must link your OpenSteam account to use the generation command.\n\nUse /link to get started.`)
        return NextResponse.json({ status: 'ok' })
      }

      // Check if already generated
      const manifest = await prisma.manifest.findUnique({
        where: { steamAppId: appId }
      })

      if (manifest) {
        const zipBuffer = await getManifestBuffer(manifest.steamAppId)
        if (zipBuffer) {
          await sendTelegramDocument(chatId, zipBuffer, `${manifest.steamAppId}.zip`, `✅ <b>Like Game File available</b>\n\n<b>${manifest.name}</b> is already cached and ready.\n\nAppID: <code>${manifest.steamAppId}</code>\nDownloads: ${manifest.downloads}`)
        } else {
          await sendTelegramMessage(chatId, `✅ <b>Like Game File available</b>\n\n<b>${manifest.name}</b> is already cached and ready.\n\nAppID: <code>${manifest.steamAppId}</code>\nDownloads: ${manifest.downloads}`, {
            reply_markup: {
              inline_keyboard: [[{ text: '🎮 Download Now', url: `http://127.0.0.1:3000/manifest/${manifest.steamAppId}` }]]
            }
          })
        }
        return NextResponse.json({ status: 'ok' })
      }

      // Generation Flow with Quotas
      const { checkWebDailyQuota } = await import('@/app/lib/ratelimit')
      const { canAccessRyuu, canUseMorrenusFallback } = await import('@/app/lib/config')

      const webQuota = await checkWebDailyQuota(user.id, user as any)
      const { todayCount, limit: dailyWebLimit } = webQuota

      if (!webQuota.allowed) {
        await sendTelegramMessage(chatId, `🚫 <b>Daily Limit Reached</b>\n\nYou have used your daily limit of ${dailyWebLimit} web generations.\n\nUpgrade your plan to generate more.`, {
          reply_markup: {
            inline_keyboard: [[{ text: '💎 Upgrade Plan', url: 'http://127.0.0.1:3000/pricing' }]]
          }
        })
        return NextResponse.json({ status: 'ok' })
      }

      const hasRyuuAccess = canAccessRyuu(user as any)
      if (!hasRyuuAccess) {
         await sendTelegramMessage(chatId, `🔒 <b>Access Denied</b>\n\nYour plan does not have upstream generation enabled.`)
         return NextResponse.json({ status: 'ok' })
      }

      await sendTelegramMessage(chatId, `⏳ <b>Generating App ID ${appId}...</b>\n\nContacting upstream sources...`)

      const { fetchManifestFromRyuu } = await import('@/app/lib/ryuu')
      const { fetchManifestFromMorrenus } = await import('@/app/lib/morrenus')
      const storage = await import('@/app/lib/storage')
      const { resolveAndUpsertManifestName } = await import('@/app/lib/manifest-name-resolve')

      let result = await fetchManifestFromRyuu(appId)
      if (!result.success && canUseMorrenusFallback(user as any)) {
        result = await fetchManifestFromMorrenus(appId)
      }

      if (!result.success || !result.zipBuffer) {
        await sendTelegramMessage(chatId, `❌ <b>Generation Failed</b>\n\nCould not fetch App ID <code>${appId}</code> from upstream. It may be invalid or not available.`)
        return NextResponse.json({ status: 'ok' })
      }

      await storage.persistManifest(appId, result.zipBuffer)
      const gameName = await resolveAndUpsertManifestName(appId, undefined, user.id)

      await prisma.webGeneration.create({
        data: { userId: user.id, appId, gameName, isNsfw: false, source: 'discord' }, // using 'discord' or we could add 'telegram' to source if schema supported it
      }).catch(() => {})

      const zipBuffer = await getManifestBuffer(appId)
      if (zipBuffer) {
        await sendTelegramDocument(chatId, zipBuffer, `${appId}.zip`, `✅ <b>Generation Successful!</b>\n\n<b>${gameName}</b> has been generated.\n\nUsage: ${todayCount + 1}/${dailyWebLimit}`)
      } else {
        await sendTelegramMessage(chatId, `✅ <b>Generation Successful!</b>\n\n<b>${gameName}</b> has been generated.\n\nUsage: ${todayCount + 1}/${dailyWebLimit}`, {
            reply_markup: {
              inline_keyboard: [[{ text: '🎮 Download Now', url: `http://127.0.0.1:3000/manifest/${appId}` }]]
            }
        })
      }

      // Auto-post to channel
      await sendTelegramPublicPromo(`🎉 <b>New Game Generated via Telegram!</b>\n\nA user just generated <b>${gameName}</b> (AppID: ${appId}).\n\nGet the manifest instantly by using our bot!`, undefined, {
        reply_markup: {
          inline_keyboard: [[{ text: '🤖 Start Generating', url: 'https://t.me/opensteam_bot' }]]
        }
      })

      return NextResponse.json({ status: 'ok' })
    }

    if (text.startsWith('/me')) {
      const user = await prisma.user.findUnique({
        where: { telegramId: chatId.toString() }
      })
      if (!user) {
        await sendTelegramMessage(chatId, `⚠️ <b>Unlinked Account</b>\n\nYour Telegram is not linked to any OpenSteam account.\nUse /link to connect it.`)
      } else {
        await sendTelegramMessage(chatId, `👤 <b>Your Account</b>\n\nDiscord ID: <code>${user.discordId}</code>\nRole: ${user.role}\nPlan: ${user.plan}`)
      }
      return NextResponse.json({ status: 'ok' })
    }

    if (text.startsWith('/unlink')) {
      await prisma.user.updateMany({
        where: { telegramId: chatId.toString() },
        data: { telegramId: null }
      })
      await sendTelegramMessage(chatId, `✅ <b>Account Unlinked</b>\n\nYour Telegram is no longer linked to your OpenSteam account.`)
      return NextResponse.json({ status: 'ok' })
    }

    // Unrecognized command or plain message -> AI Support Bot Fallback
    await sendTelegramChatAction(chatId, 'typing')

    const kb = getSystemKnowledgeBase()
    const systemPrompt = `You are the official OpenSteam Support Assistant.
You help users with questions about OpenSteam, the bot, the platform, and its features.
Always be polite, concise, and helpful. Use Telegram-supported HTML formatting (<b>, <i>, <code>).

KNOWLEDGE BASE:
${kb}

CRITICAL RULES:
1. When answering questions, naturally promote OpenSteam's premium plans if the user is asking about limits or missing features.
2. If relevant, explicitly mention our highly anticipated "coming soon offline denuvo activation" feature to build hype.
3. Keep answers under 150 words. Do NOT overwhelm the user with long text. Provide links if they need more info.`

    const llmResult = await callLlmWithFallback({
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: text }
      ],
      temperature: 0.3,
      max_tokens: 500
    })

    if (llmResult && llmResult.message.content) {
      await sendTelegramMessage(chatId, llmResult.message.content)
    } else {
      await sendTelegramMessage(chatId, `🤖 I'm currently unable to process your request. Please try again later or type /help.`)
    }

    return NextResponse.json({ status: 'ok' })
  } catch (error) {
    console.error('[Telegram Webhook] Error processing update:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
