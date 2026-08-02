import { NextRequest, NextResponse } from 'next/server'
import { resolveActiveOAuthCredentials } from '@/app/lib/discord-bot-credentials'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))
    const code = String(body.code || '').trim()
    const redirectUri = String(body.redirect_uri || '').trim()

    if (!code) {
      return NextResponse.json({ error: 'Missing code' }, { status: 400 })
    }

    let clientId = ''
    let clientSecret = ''

    try {
      const active = await resolveActiveOAuthCredentials()
      clientId = active.clientId || ''
      clientSecret = active.clientSecret || ''
    } catch {
      // fallback to env
    }

    if (!clientId || !clientSecret) {
      clientId = process.env.DISCORD_CLIENT_ID || ''
      clientSecret = process.env.DISCORD_CLIENT_SECRET || ''
    }

    if (!clientId || !clientSecret) {
      return NextResponse.json(
        { error: 'Discord OAuth client credentials not configured' },
        { status: 500 }
      )
    }

    const tokenParams = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'authorization_code',
      code,
    })

    if (redirectUri) {
      tokenParams.append('redirect_uri', redirectUri)
    }

    const tokenRes = await fetch('https://discord.com/api/v10/oauth2/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: tokenParams.toString(),
    })

    if (!tokenRes.ok) {
      const errText = await tokenRes.text().catch(() => tokenRes.statusText)
      console.error('[Discord Activity Token Error]:', tokenRes.status, errText)
      return NextResponse.json(
        { error: 'Failed to exchange authorization code', details: errText },
        { status: tokenRes.status }
      )
    }

    const tokenData = await tokenRes.json()
    const accessToken = tokenData.access_token

    // Fetch user profile
    const userRes = await fetch('https://discord.com/api/v10/users/@me', {
      headers: { Authorization: `Bearer ${accessToken}` },
    })

    const user = userRes.ok ? await userRes.json() : null

    // Fetch relationships (permitted within Discord Activity frames when scope contains relationships.read)
    let relationships = null
    const relRes = await fetch('https://discord.com/api/v10/users/@me/relationships', {
      headers: { Authorization: `Bearer ${accessToken}` },
    })

    if (relRes.ok) {
      relationships = await relRes.json()
    }

    // Fetch connections
    let connections = null
    const connRes = await fetch('https://discord.com/api/v10/users/@me/connections', {
      headers: { Authorization: `Bearer ${accessToken}` },
    })

    if (connRes.ok) {
      connections = await connRes.json()
    }

    return NextResponse.json({
      access_token: accessToken,
      user,
      relationships,
      connections,
      scope: tokenData.scope,
    })
  } catch (error) {
    console.error('[Discord Activity Token Handler Exception]:', error)
    return NextResponse.json(
      { error: 'Internal Activity Auth Error' },
      { status: 500 }
    )
  }
}
