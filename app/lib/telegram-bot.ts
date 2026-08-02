export async function sendTelegramMessage(chatId: string, text: string, options?: any) {
  const token = process.env.TELEGRAM_BOT_TOKEN
  if (!token) {
    console.warn('TELEGRAM_BOT_TOKEN is not set. Skipping Telegram message.')
    return false
  }

  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: 'HTML',
        ...options,
      }),
    })

    if (!res.ok) {
      const resText = await res.text()
      console.error('[Telegram] Failed to send message:', res.status, resText)
      return false
    }

    return true
  } catch (error) {
    console.error('[Telegram] Error sending message:', error)
    return false
  }
}

export async function sendTelegramPhoto(chatId: string, photo: string, caption?: string, options?: any) {
  const token = process.env.TELEGRAM_BOT_TOKEN
  if (!token) {
    console.warn('TELEGRAM_BOT_TOKEN is not set. Skipping Telegram photo.')
    return false
  }

  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        chat_id: chatId,
        photo,
        caption,
        parse_mode: 'HTML',
        ...options,
      }),
    })

    if (!res.ok) {
      const resText = await res.text()
      console.error('[Telegram] Failed to send photo:', res.status, resText)
      return false
    }

    return true
  } catch (error) {
    console.error('[Telegram] Error sending photo:', error)
    return false
  }
}

export async function sendTelegramAdminAlert(text: string) {
  const adminGroupId = process.env.TELEGRAM_ADMIN_GROUP_ID
  if (!adminGroupId) return false
  return sendTelegramMessage(adminGroupId, `🚨 <b>ADMIN ALERT</b>\n\n${text}`)
}

export async function sendTelegramPublicPromo(text: string, photoUrl?: string, options?: any) {
  const channelId = process.env.TELEGRAM_PUBLIC_CHANNEL_ID
  if (!channelId) return false
  
  if (photoUrl) {
    return sendTelegramPhoto(channelId, photoUrl, text, options)
  }
  return sendTelegramMessage(channelId, text, options)
}

export async function sendTelegramGameAnnouncement(data: {
  gameName: string
  appId: string
  imageUrl?: string
  wasUpdate: boolean
}) {
  const chatId = process.env.TELEGRAM_PUBLIC_CHANNEL_ID
  if (!chatId) {
    console.warn('TELEGRAM_PUBLIC_CHANNEL_ID is not set. Not sending game announcement.')
    return false
  }

  const text = data.wasUpdate
    ? `🔄 <b>MANIFEST UPDATED!</b>\n\n🎮 <b>${data.gameName}</b>\n🆔 AppID: <code>${data.appId}</code>\n\nThe manifest has been refreshed — grab the latest version now!\n\n👉 <a href="http://127.0.0.1:3000">opensteam.lol</a>`
    : `🎉 <b>NEW GAME DROP!</b>\n\n🎮 <b>${data.gameName}</b>\n🆔 AppID: <code>${data.appId}</code>\n\nThis game is now available on OpenSteam — generate your manifest instantly!\n\n👉 <a href="http://127.0.0.1:3000">opensteam.lol</a>`

  const photo = data.imageUrl || `https://cdn.akamai.steamstatic.com/steam/apps/${data.appId}/header.jpg`
  return sendTelegramPhoto(chatId, photo, text)
}

export async function sendTelegramDocument(chatId: string, buffer: Buffer, filename: string, caption?: string, options?: any) {
  const token = process.env.TELEGRAM_BOT_TOKEN
  if (!token) return false

  try {
    const formData = new FormData()
    formData.append('chat_id', chatId)
    const blob = new Blob([new Uint8Array(buffer)], { type: 'application/zip' })
    formData.append('document', blob, filename)
    if (caption) {
      formData.append('caption', caption)
    }
    formData.append('parse_mode', 'HTML')
    
    if (options) {
      for (const [key, value] of Object.entries(options)) {
         formData.append(key, typeof value === 'object' ? JSON.stringify(value) : String(value))
      }
    }

    const res = await fetch(`https://api.telegram.org/bot${token}/sendDocument`, {
      method: 'POST',
      body: formData,
    })
    
    if (!res.ok) {
      console.error('[Telegram] Failed to send document:', await res.text())
      return false
    }
    return true
  } catch (error) {
    console.error('[Telegram] Error sending document:', error)
    return false
  }
}

export async function sendTelegramChatAction(chatId: string, action: string = 'typing') {
  const token = process.env.TELEGRAM_BOT_TOKEN
  if (!token) return false

  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendChatAction`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, action })
    })
    
    if (!res.ok) {
      console.error('[Telegram] Failed to send chat action:', await res.text())
      return false
    }
    return true
  } catch (error) {
    console.error('[Telegram] Error sending chat action:', error)
    return false
  }
}

