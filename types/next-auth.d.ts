import NextAuth from 'next-auth'

declare module 'next-auth' {
  interface Session {
    user: {
      id?: string
      name?: string | null
      email?: string | null
      image?: string | null
      discordId?: string
      role?: string
      plan?: string
      isBanned?: boolean
      isShadowing?: boolean
      shadowingName?: string
      realRole?: string
      realId?: string
      activeOrgId?: string | null
      inactivityExpired?: boolean
      guildLeftExpired?: boolean
      guildBannedExpired?: boolean
      oauthExpired?: boolean
      discordGuildRestricted?: boolean
    }
  }

  interface User {
    id?: string
    name?: string | null
    email?: string | null
    image?: string | null
    discordId?: string
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    accessToken?: string
    refreshToken?: string
    discordId?: string
  }
}
