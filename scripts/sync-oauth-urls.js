const fs = require('fs')

const path = require('path')



const envPath = path.join(__dirname, '..', '.env')

const LOCAL_SITE_URL = 'https://opensteam.lol'



function setEnvKey(key, value) {

  const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/)

  let found = false

  const out = lines.map((line) => {

    if (line.startsWith(`${key}=`)) {

      found = true

      return `${key}="${value}"`

    }

    return line

  })

  if (!found) out.push(`${key}="${value}"`)

  fs.writeFileSync(envPath, out.join('\n') + '\n', 'utf8')

}



setEnvKey('NEXTAUTH_URL', LOCAL_SITE_URL)

setEnvKey('NEXT_PUBLIC_APP_URL', LOCAL_SITE_URL)

setEnvKey('AUTH_TRUST_HOST', 'true')

setEnvKey('ENABLE_HTTPS_SECURITY_HEADERS', 'true')

setEnvKey('PORT', '3000')



try {

  const { writeSiteSettings } = require('./lib/site-settings')

  writeSiteSettings({ siteUrl: LOCAL_SITE_URL, loginUrl: LOCAL_SITE_URL })

} catch (_) {}



console.log(`Local site URL: ${LOCAL_SITE_URL} (hosts file on your PC only)`)

console.log('Public access uses the Cloudflare tunnel URL — see public-url.txt')

console.log('Run: node scripts/sync-tunnel-url.js  (after tunnel starts)')


