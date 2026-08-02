export type ResponseCookieOptions = {
  httpOnly?: boolean
  sameSite?: 'lax' | 'strict' | 'none'
  path?: string
  secure?: boolean
  maxAge?: number
}

export type ResponseCookieTarget = Response & {
  cookies?: {
    set: (name: string, value: string, options: ResponseCookieOptions) => void
  }
}

function sameSiteValue(value: ResponseCookieOptions['sameSite']): string | null {
  if (!value) return null
  if (value === 'none') return 'None'
  if (value === 'strict') return 'Strict'
  return 'Lax'
}

function serializeCookie(name: string, value: string, options: ResponseCookieOptions): string {
  const parts = [`${name}=${encodeURIComponent(value)}`]

  if (typeof options.maxAge === 'number') {
    parts.push(`Max-Age=${Math.trunc(options.maxAge)}`)
  }
  if (options.path) {
    parts.push(`Path=${options.path}`)
  }
  if (options.httpOnly) {
    parts.push('HttpOnly')
  }
  if (options.secure) {
    parts.push('Secure')
  }

  const sameSite = sameSiteValue(options.sameSite)
  if (sameSite) {
    parts.push(`SameSite=${sameSite}`)
  }

  return parts.join('; ')
}

export function setResponseCookie(
  response: ResponseCookieTarget,
  name: string,
  value: string,
  options: ResponseCookieOptions
) {
  if (response.cookies?.set) {
    response.cookies.set(name, value, options)
    return
  }

  response.headers.append('Set-Cookie', serializeCookie(name, value, options))
}
