export function getBrowserFingerprint() {
  if (typeof window === 'undefined') return 'server'

  const components = [
    window.navigator.userAgent,
    window.navigator.language,
    window.navigator.hardwareConcurrency || 'unknown',
    (window.navigator as any).deviceMemory || 'unknown',
    window.screen.colorDepth,
    window.screen.width + 'x' + window.screen.height,
    window.devicePixelRatio,
    new Date().getTimezoneOffset(),
    !!window.sessionStorage,
    !!window.localStorage,
    !!window.indexedDB,
    (window.navigator as any).platform || 'unknown',
    getCanvasHash()
  ]
  
  // Use a simple hash function for better uniqueness than just btoa
  const str = components.join('|')
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash = hash & hash // Convert to 32bit integer
  }
  
  return btoa(hash.toString() + str).substring(0, 64)
}

export function getCanvasHash() {
  if (typeof window === 'undefined') return null
  
  try {
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    
    ctx.textBaseline = "top"
    ctx.font = "14px 'Arial'"
    ctx.textBaseline = "alphabetic"
    ctx.fillStyle = "#f60"
    ctx.fillRect(125,1,62,20)
    ctx.fillStyle = "#069"
    ctx.fillText("OpenSteam_Sentinel_Noise", 2, 15)
    ctx.fillStyle = "rgba(102, 204, 0, 0.7)"
    ctx.fillText("OpenSteam_Sentinel_Noise", 4, 17)
    
    return canvas.toDataURL().substring(0, 64)
  } catch (e) {
    return 'noise-error'
  }
}
