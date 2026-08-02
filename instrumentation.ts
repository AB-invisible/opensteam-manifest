function warnAuthEnv(issue: string) {
  console.warn(`[Auth env] ${issue}`)
}

function validateProductionAuthEnv() {
  if (process.env.NODE_ENV !== 'production') return

  const secret = process.env.NEXTAUTH_SECRET?.trim()
  if (!secret) {
    warnAuthEnv('NEXTAUTH_SECRET is empty — OAuth state cookies will fail')
  }

  const nextAuthUrl = process.env.NEXTAUTH_URL?.trim()
  const publicUrl = process.env.NEXT_PUBLIC_APP_URL?.trim()
  if (!nextAuthUrl) {
    warnAuthEnv('NEXTAUTH_URL is unset — set to your public https origin (e.g. http://127.0.0.1:3000)')
  }
  if (!publicUrl) {
    warnAuthEnv('NEXT_PUBLIC_APP_URL is unset — www/apex redirects and absolute links may break OAuth cookies')
  }
  if (nextAuthUrl && publicUrl && nextAuthUrl.replace(/\/$/, '') !== publicUrl.replace(/\/$/, '')) {
    warnAuthEnv('NEXTAUTH_URL and NEXT_PUBLIC_APP_URL differ — they should match the host users visit')
  }

  if (process.env.RAILWAY_STATIC_URL && process.env.AUTH_TRUST_HOST !== 'true') {
    warnAuthEnv('AUTH_TRUST_HOST is not true — set AUTH_TRUST_HOST=true on Railway for OAuth callbacks behind the proxy')
  }
}

function installProcessSafetyNet() {
  const g = globalThis as unknown as { __ggSafetyNetInstalled?: boolean }
  if (g.__ggSafetyNetInstalled) return
  g.__ggSafetyNetInstalled = true

  // On Node 22 the default action for an unhandled promise rejection is to
  // terminate the process. Background/fire-and-forget tasks (e.g. broadcasts)
  // would then take the whole server down, surfacing as 502s on every route.
  // Log loudly instead of crashing so a single stray task can't kill the app.
  process.on('unhandledRejection', (reason) => {
    console.error('[Process] Unhandled promise rejection (kept alive):', reason)
  })
  process.on('uncaughtException', (err) => {
    console.error('[Process] Uncaught exception (kept alive):', err)
  })
}

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    installProcessSafetyNet()
    validateProductionAuthEnv()
    const { startOtel } = await import('./app/lib/otel')
    startOtel()
  }
}
