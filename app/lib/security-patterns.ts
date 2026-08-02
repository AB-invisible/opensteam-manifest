export const BLACKLISTED_PATTERNS = [
  /drop\s+table/i,
  /delete\s+from/i,
  /truncate\s+table/i,
  /alter\s+table/i,
  /union\s+select/i,
  /insert\s+into/i,
  /psql\s+/i,
  /mysql\s+/i,
  /\/\*/,
  /1\s*=\s*1/i,
  /['"]\s*1\s*['"]\s*=\s*['"]\s*1\s*['"]/i,
  /['"]\s*OR\s*['"]\s*1\s*['"]\s*=\s*['"]\s*1\s*['"]/i,
  /sleep\(\d+\)/i,
  /benchmark\(/i,
  /waitfor\s+delay/i,
  /<script/i,
  /onload=/i,
  /onerror=/i,
  /eval\(/i,
  /exec\s+/i,
  /\.env/i,
  /\.git\//i,
  /wp-admin/i,
  /wp-config\.php/i,
  /config\.json/i,
  /\.\.\/\.\.\//,
  /\/etc\/passwd/i
]

export const SCRAPER_USER_AGENTS = [
  'scrapy',
  'python-requests',
  'aiohttp',
  'urllib',
  'curl',
  'wget',
  'httpx',
  'go-http-client',
  'puppeteer',
  'playwright',
  'headlesschrome',
  'phantomjs',
  'selenium',
  'cypress',
  'postmanruntime',
  'mechanize',
  'libwww-perl',
  'java/'
]

export function isMalicious(input: string): string | null {
  for (const pattern of BLACKLISTED_PATTERNS) {
    if (pattern.test(input)) {
      return `Malicious pattern detected: ${pattern.source}`
    }
  }
  return null
}

export function isScraperUserAgent(ua: string | null): string | null {
  if (!ua || ua.trim() === '') {
    return 'Missing or empty User-Agent'
  }
  const lowerUa = ua.toLowerCase()
  for (const bot of SCRAPER_USER_AGENTS) {
    if (lowerUa.includes(bot)) {
      return `Automated scraper detected: ${bot}`
    }
  }
  return null
}
