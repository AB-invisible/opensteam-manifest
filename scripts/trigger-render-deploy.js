#!/usr/bin/env node
/** Trigger a Render redeploy for manifest-web only (no env patch). */
require('dotenv').config()
const fs = require('fs')
const path = require('path')

const API = 'https://api.render.com/v1'

function getRenderApiKey() {
  const fromEnv = process.env.RENDER_API_KEY?.trim()
  if (fromEnv) return fromEnv
  const cliPath = path.join(process.env.USERPROFILE || process.env.HOME || '', '.render', 'cli.yaml')
  if (!fs.existsSync(cliPath)) return null
  const m = fs.readFileSync(cliPath, 'utf8').match(/key:\s*(rnd_[^\s]+)/)
  return m?.[1] || null
}

const key = getRenderApiKey()
if (!key) {
  console.error('RENDER_API_KEY missing')
  process.exit(1)
}

async function api(method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${key}`,
      Accept: 'application/json',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${text}`)
  return text ? JSON.parse(text) : null
}

async function main() {
  const services = await api('GET', '/services?limit=50')
  const web = services.find((row) => row.service?.name === 'manifest-web')?.service
  if (!web?.id) throw new Error('manifest-web service not found')

  const deploy = await api('POST', `/services/${web.id}/deploys`, {
    clearCache: 'clear',
  })
  console.log('Deploy triggered for manifest-web')
  console.log('Deploy id:', deploy.id)
  console.log('Status:', deploy.status)
  console.log('URL:', web.serviceDetails?.url || web.url)
}

main().catch((err) => {
  console.error(err.message || err)
  process.exit(1)
})
