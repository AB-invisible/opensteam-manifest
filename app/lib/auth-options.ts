import { NextAuthOptions } from 'next-auth'
import DiscordProvider from 'next-auth/providers/discord'
import { prisma } from './prisma'
import { getDiscordCdnAvatarUrl } from './discord-avatar'
import {
  persistDiscordOAuthTokens,
  ensureDiscordGuildMembership,
  resolveOAuthDiscordUserId,
} from './discord-oauth-tokens'
import { logAuthIssue, logNextAuthError } from './auth-issue-log'
import { assertWebActivityFresh, touchWebActivity } from './session-inactivity'
import { assertWebSessionNotRevoked, clearWebSessionRevoke, clearWebSessionRevokeForGuildBannedLogin, markWebLogin } from './web-session-revoke'

function extractDiscordAvatarHash(image: string | null | undefined): string | undefined {
  if (!image?.trim()) return undefined
  const trimmed = image.trim()
  if (!trimmed.startsWith('http')) return trimmed
  const match = trimmed.match(/\/avatars\/\d+\/([a-zA-Z0-9_]+)/)
  if (!match?.[1]) return undefined
  return match[1].replace(/\.(webp|png|gif|jpe?g)$/i, '')
}

async function ensureOwnerAccount(discordId: string) {
  const ownerDiscordId = process.env.OWNER_DISCORD_ID?.trim()
  if (!ownerDiscordId || discordId !== ownerDiscordId) return
  await dbRetry(() =>
    prisma.user.updateMany({
      where: { discordId },
      data: {
        role: 'OWNER',
        roleLevel: 150,
        plan: 'CUSTOM',
        securityBypass: true,
      },
    })
  )
}

async function dbRetry<T>(fn: () => Promise<T>, retries = 3, delay = 1000): Promise<T> {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (error: any) {
      if (i === retries - 1) throw error;
      console.warn(`[NextAuth DB] Retry ${i + 1}/${retries} due to error: ${error.message}`);
      await new Promise(resolve => setTimeout(resolve, delay * (i + 2))); // Exponential backoff
    }
  }
  throw new Error('Retries failed');
}

export const authOptions: NextAuthOptions = {
  secret: process.env.NEXTAUTH_SECRET,
  logger: {
    error(code, metadata) {
      console.error(`[NextAuth] ${code}`, metadata)
      logNextAuthError(code, metadata)
    },
  },
  providers: [
    DiscordProvider({
      clientId: process.env.DISCORD_CLIENT_ID || 'PENDING',
      clientSecret: process.env.DISCORD_CLIENT_SECRET || 'PENDING',
      authorization: {
        params: {
          scope: 'identify email guilds.join'
        }
      },
      async profile(profile) {
        const avatarHash = profile.avatar
        const ext = avatarHash?.startsWith('a_') ? 'gif' : 'png'
        const oauthImageUrl = avatarHash
          ? `https://cdn.discordapp.com/avatars/${profile.id}/${avatarHash}.${ext}`
          : null
        return {
          id: profile.id,
          name: profile.username,
          email: profile.email,
          image: oauthImageUrl,
        }
      }
    }),
  ],
  callbacks: {
    async signIn({ user, account }) {
      const discordId = resolveOAuthDiscordUserId(account, user)
      if (!discordId) return true

      try {
        const data = await dbRetry(() => prisma.user.findUnique({
          where: { discordId },
          select: { isBanned: true, jailUntil: true, isSelfSuspended: true, id: true }
        }));
        if (data) {
          const isJailed = data.jailUntil && new Date() < new Date(data.jailUntil);
          if (data.isBanned || isJailed) {
            logAuthIssue({
              stage: 'signin_callback:blocked',
              error: data.isBanned ? 'Account banned' : 'Account jailed',
              discordId,
              flow: 'login',
            })
            return `/banned?id=${discordId}`; // Redirect to custom banned page
          }
          if (data.isSelfSuspended) {
            await dbRetry(() => prisma.user.update({
              where: { id: data.id },
              data: { isSelfSuspended: false }
            }));
            try {
              const { sendSelfReactivationEmail } = await import('@/app/lib/email');
              await sendSelfReactivationEmail(data.id);
            } catch (err) {
              console.error('[NextAuth] Reactivation email error:', err);
            }
          }
        }
        return true;
      } catch (e) {
        console.error('[NextAuth] signIn callback database error:', e);
        logAuthIssue({
          stage: 'signin_callback:database',
          error: e instanceof Error ? e.message : 'Database error during sign-in',
          discordId,
          flow: 'login',
        })
        return false;
      }
    },
    async jwt({ token, account, user }) {
      const oauthDiscordId = resolveOAuthDiscordUserId(account, user)
      if (account && oauthDiscordId) {
        const discordId = oauthDiscordId
        token.accessToken = account.access_token
        token.refreshToken = account.refresh_token ?? token.refreshToken
        token.discordId = discordId

        // Capture OAuth tokens to DB so bot can use them for guilds.join pullback.
        // User row may not exist yet on first signup — tokens stay in JWT until /api/auth/me runs.
        try {
          await dbRetry(() =>
            persistDiscordOAuthTokens(
              discordId,
              account.access_token,
              account.refresh_token
            )
          )
        } catch (err) {
          console.error('[NextAuth] Failed to save Discord OAuth tokens:', err)
        }

        let verifyOAuthOnly = false
        try {
          const { completeVerificationOAuthBridge } = await import('./discord-verify-oauth-bridge')
          const bridge = await completeVerificationOAuthBridge({
            discordId,
            accessToken: account.access_token,
            refreshToken: account.refresh_token,
          })
          verifyOAuthOnly = bridge.handled
          if (bridge.handled && bridge.error) {
            console.warn('[NextAuth] Verify OAuth bridge:', bridge.error)
            logAuthIssue({
              stage: `verify_oauth_bridge:${bridge.error}`,
              error: bridge.error,
              discordId,
              flow: 'verify',
            })
          }
        } catch (err) {
          console.error('[NextAuth] Verify OAuth bridge error:', err)
          logAuthIssue({
            stage: 'verify_oauth_bridge:exception',
            error: err instanceof Error ? err.message : 'Verify OAuth bridge threw',
            discordId,
            flow: 'verify',
          })
        }

        if (!verifyOAuthOnly) {
          await markWebLogin(discordId).catch((err) =>
            console.error('[NextAuth] Failed to mark web login:', err)
          )
        }

        try {
          const guildResult = await ensureDiscordGuildMembership(discordId, {
            accessToken: account.access_token,
            refreshToken: account.refresh_token,
            source: 'login',
          })
          await clearWebSessionRevokeForGuildBannedLogin(discordId)
          if (guildResult.ok) {
            await clearWebSessionRevoke(discordId)
          } else if (guildResult.reason !== 'user-not-found') {
            logAuthIssue({
              stage: 'guild_ensure:jwt_callback',
              error: guildResult.message || guildResult.reason,
              discordId,
              flow: verifyOAuthOnly ? 'verify' : 'login',
              details: { reason: guildResult.reason },
            })
          }
        } catch (err) {
          console.error('[NextAuth] Failed to clear session revoke on login:', err)
        }

        // Refresh the DB avatar/username with what Discord OAuth just gave us.
        // profile() returns the CURRENT profile from Discord; session() reads
        // username from DB, so without this write stale handles persist until
        // the next Discord API sync. updateMany is a no-op if the user doesn't
        // exist yet (first signup) — /api/auth/me will create them.
        if (user?.name || user?.image) {
          try {
            const data: { avatar?: string; username?: string } = {}
            const avatarHash = extractDiscordAvatarHash(user.image as string | undefined)
            if (avatarHash) data.avatar = avatarHash
            if (user.name) data.username = user.name as string
            await dbRetry(() => prisma.user.updateMany({
              where: { discordId },
              data,
            }))
          } catch (e: any) {
            console.warn('[NextAuth] Failed to refresh profile from OAuth:', e?.message)
          }
        }

        await ensureOwnerAccount(discordId).catch((err) =>
          console.error('[NextAuth] Failed to ensure owner account:', err)
        )
      }
      return token
    },
    async session({ session, token }) {
      if (token && session.user) {
        const u = session.user as any;
        const discordId = token.discordId as string | undefined;
        if (!discordId) return session;

        u.discordId = discordId;
        
        try {
          // Single read — no dbRetry on hot session path (polled every 30–60s).
          const data = await prisma.user.findUnique({
            where: { discordId },
            select: {
              id: true,
              username: true,
              avatar: true,
              role: true,
              plan: true,
              isBanned: true,
              jailUntil: true,
              shadowingId: true,
              activeOrgId: true,
              lastWebActivityAt: true,
              webSessionRevokedAt: true,
              webSessionRevokeReason: true,
              discordGuildBannedAt: true,
            },
          })
          
          if (data) {
            const revokeCheck = assertWebSessionNotRevoked(data)
            if (!revokeCheck.ok) {
              if (revokeCheck.reason === 'guild_banned') {
                u.guildBannedExpired = true
              } else if (revokeCheck.reason === 'oauth_expired') {
                u.oauthExpired = true
              } else {
                u.guildLeftExpired = true
              }
              return session
            }

            const activityCheck = assertWebActivityFresh(data)
            if (!activityCheck.ok) {
              u.inactivityExpired = true
              return session
            }
            // Check for IP Blacklist or Jail during session validation
            const ip = 'internal-ref' // We can't easily get IP in session callback, but we can check jail status
            const isJailed = data.jailUntil && new Date() < new Date(data.jailUntil);
            const isBlocked = data.isBanned || isJailed;
            
            if (isBlocked) {
              u.isBanned = true;
              return session;
            }

            const avatarUrl = getDiscordCdnAvatarUrl(discordId, data.avatar, 128)
            if (avatarUrl) {
              session.user.image = avatarUrl
            }
            if (data.username) {
              session.user.name = data.username
            }

            const isAdminOrOwner = data.role === 'ADMIN' || data.role === 'OWNER';
            
            if (isAdminOrOwner && data.shadowingId) {
              const target = await prisma.user.findUnique({
                where: { id: data.shadowingId as string },
                select: { role: true, plan: true, username: true, id: true }
              });
  
              if (target) {
                u.role = target.role;
                u.plan = target.plan;
                u.isShadowing = true;
                u.shadowingName = target.username;
                u.realRole = data.role; // Keep track of actual role (ADMIN or OWNER)
                u.realId = data.id;   // Keep track of actual Admin/Owner ID
                return session;
              }
            }
  

            u.id = data.id;
            u.role = data.role;
            u.plan = data.plan;
            u.realRole = data.role;
            u.activeOrgId = data.activeOrgId;
            u.discordGuildRestricted = Boolean(data.discordGuildBannedAt);
          }
        } catch (error) {
          console.error('[NextAuth] session callback database error:', error);
          // Don't crash the session if DB is down, just provide minimal session
        }
      }
      return session;
    },
  },
  pages: {
    // Do not set signIn here — GET /api/auth/signin/discord would redirect to the
    // custom page with error=discord (provider id) instead of starting OAuth.
    error: '/auth/signin',
  },
  events: {
    async signIn({ user, account, isNewUser }) {
      const { isVerifyOAuthJustCompleted, clearVerifyDoneCookie } = await import('./discord-verify-oauth-bridge')
      const fromVerifyOAuth = isVerifyOAuthJustCompleted()
      if (fromVerifyOAuth) {
        clearVerifyDoneCookie()
      }

      const oauthDiscordId = resolveOAuthDiscordUserId(account, user)

      if (account?.access_token && oauthDiscordId && !fromVerifyOAuth) {
        try {
          await persistDiscordOAuthTokens(
            oauthDiscordId,
            account.access_token,
            account.refresh_token
          )
        } catch (err) {
          console.error('[NextAuth] signIn event failed to save Discord OAuth tokens:', err)
        }

        try {
          const guildResult = await ensureDiscordGuildMembership(oauthDiscordId, {
            accessToken: account.access_token,
            refreshToken: account.refresh_token,
            source: 'login',
          })
          if (!guildResult.ok) {
            console.warn('[NextAuth] Discord guild ensure on sign-in failed:', oauthDiscordId, guildResult.reason)
            if (guildResult.reason !== 'user-not-found') {
              logAuthIssue({
                stage: 'guild_ensure:sign_in_event',
                error: guildResult.message || guildResult.reason,
                discordId: oauthDiscordId,
                flow: 'login',
                details: { reason: guildResult.reason },
              })
            }
          }
        } catch (err) {
          console.error('[NextAuth] Discord guild ensure on sign-in error:', err)
        }

        try {
          const dbUser = await prisma.user.findUnique({
            where: { discordId: oauthDiscordId },
            select: { id: true },
          })
          if (dbUser) {
            await touchWebActivity(dbUser.id)
          }
        } catch (err) {
          console.error('[NextAuth] Failed to touch web activity on sign-in:', err)
        }
      }

      if (fromVerifyOAuth) {
        return
      }

      if (user && user.email) {
        try {
          const { sendBrandedEmail } = await import('@/app/lib/email');
          const time = new Date().toLocaleString('en-GB', {
            weekday: 'long', year: 'numeric', month: 'long',
            day: 'numeric', hour: '2-digit', minute: '2-digit', timeZoneName: 'short'
          });
          await sendBrandedEmail(
            user.email,
            isNewUser
              ? 'Welcome to OpenSteam — Account Created'
              : 'New Login Detected — OpenSteam',
            isNewUser ? '👋 Welcome to OpenSteam' : '🔐 New Login Detected',
            isNewUser
              ? `Hello <strong>${user.name || 'there'}</strong>,<br><br>Your OpenSteam account has been created and you are now logged in. Welcome to the network.<br><br><strong>Login time:</strong> ${time}`
              : `Hello <strong>${user.name || 'there'}</strong>,<br><br>A new login was detected on your OpenSteam account.<br><br><strong>Time:</strong> ${time}<br><br>If this was you, no action is required.`,
            isNewUser ? '#10b981' : '#f59e0b',
            undefined,
            {
              buttonText: 'Go to Dashboard',
              buttonUrl: 'http://127.0.0.1:3000/dashboard',
              securityNotice: isNewUser
                ? undefined
                : 'If you did not log in, your Discord account may be compromised. Immediately change your Discord password and enable Two-Factor Authentication, then contact our support team.',
            }
          );
        } catch (e) {
          console.error('[NextAuth] Error sending login email:', e);
        }
      }
    }
  },
  debug: process.env.NODE_ENV === 'development',
  session: {
    strategy: 'jwt',
    maxAge: 30 * 24 * 60 * 60,
  },
  useSecureCookies: true,
  cookies: {
    sessionToken: {
      name: '__Secure-next-auth.session-token',
      options: {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        secure: true,
        maxAge: 30 * 24 * 60 * 60,
      },
    },
  },
}
