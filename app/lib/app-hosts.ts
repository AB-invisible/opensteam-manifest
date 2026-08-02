export function isTunnelHost(host: string): boolean {
  const h = host.split(':')[0].trim().toLowerCase()
  if (h.endsWith('.loca.lt')) return true
  return h.endsWith('.trycloudflare.com') && h !== 'api.trycloudflare.com'
}

export function isLocalOpenSteamHost(host: string): boolean {
  const h = host.split(':')[0].trim().toLowerCase()
  return h === 'opensteam.lol' || h === 'www.opensteam.lol'
}

export function isLocalhostHost(host: string): boolean {
  const h = host.split(':')[0].trim().toLowerCase()
  return h === 'localhost' || h === '127.0.0.1' || h === '::1' || h === '[::1]'
}
