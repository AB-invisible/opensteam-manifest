import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/app/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/app/lib/auth-options'

export async function GET(req: NextRequest) {
  const tokenStr = req.nextUrl.searchParams.get('token')
  
  if (!tokenStr) {
    return new NextResponse('Missing token', { status: 400 })
  }

  // 1. Verify token exists and is valid
  const linkToken = await prisma.telegramLinkToken.findUnique({
    where: { token: tokenStr }
  })

  if (!linkToken) {
    return new NextResponse('Invalid or expired token', { status: 400 })
  }

  if (linkToken.expiresAt < new Date()) {
    await prisma.telegramLinkToken.delete({ where: { id: linkToken.id } })
    return new NextResponse('Token has expired. Please use /link in Telegram again.', { status: 400 })
  }

  // 2. Check if user is authenticated via Discord
  const session = await getServerSession(authOptions)
  
  if (!session || !session.user) {
    // Redirect to sign in, then back to this exact URL to complete linking
    const callbackUrl = encodeURIComponent(`/api/telegram/link?token=${tokenStr}`)
    return NextResponse.redirect(new URL(`/api/auth/signin?callbackUrl=${callbackUrl}`, req.url))
  }

  // 3. Perform linking
  try {
    // Delete any existing link tokens for this telegram ID
    await prisma.telegramLinkToken.deleteMany({
      where: { telegramId: linkToken.telegramId }
    })

    // Remove telegramId from any other user (telegram accounts can only be linked to one discord)
    await prisma.user.updateMany({
      where: { telegramId: linkToken.telegramId },
      data: { telegramId: null }
    })

    // Update current user
    const discordId = (session.user as any).discordId
    await prisma.user.update({
      where: { discordId },
      data: { telegramId: linkToken.telegramId }
    })

    // Send a success message to the telegram chat to confirm
    const { sendTelegramMessage } = await import('@/app/lib/telegram-bot')
    await sendTelegramMessage(linkToken.telegramId, `✅ <b>Account Linked Successfully!</b>\n\nYour OpenSteam account (<b>${session.user.name}</b>) is now linked to Telegram.\n\nYou can now use commands like <code>/gen</code> securely!`)

    // 4. Show success page
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Account Linked</title>
        <style>
          body { font-family: system-ui, sans-serif; background: #000; color: #fff; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
          .card { background: #111; padding: 2rem; border-radius: 1rem; border: 1px solid #333; text-align: center; }
          h1 { color: #4ade80; margin-top: 0; }
          p { color: #888; }
          a { display: inline-block; margin-top: 1rem; padding: 0.5rem 1rem; background: #3b82f6; color: #fff; text-decoration: none; border-radius: 0.5rem; font-weight: bold; }
        </style>
      </head>
      <body>
        <div class="card">
          <h1>✅ Account Linked!</h1>
          <p>Your Telegram account is now linked to OpenSteam.</p>
          <p>You can close this window and return to Telegram.</p>
          <a href="https://t.me/OpenSteamBot">Return to Bot</a>
        </div>
      </body>
      </html>
    `
    return new NextResponse(html, { headers: { 'Content-Type': 'text/html' } })
  } catch (error) {
    console.error('[Telegram Link Error]', error)
    return new NextResponse('Internal server error during linking', { status: 500 })
  }
}
