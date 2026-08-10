require('dotenv').config()
const JSZip = require('jszip')
const { cleanManifestZip } = require('./lib/clean-manifest')

const samples = [
  {
    name: 'depotbox',
    lua: `-- DepotBox manifest\n-- total depots: 5\naddappid(3787240)\nsetManifestid(123,456)`,
  },
  {
    name: 'cased',
    lua: `AddAppId(3787240)\nSetManifestid(123, "abc")`,
  },
  {
    name: 'spaced',
    lua: `-- comment\n  addappid(730)\n`,
  },
  {
    name: 'depotbox-inline',
    lua: `depotbox.org credit\naddAppId(123)`,
  },
  {
    name: 'multiline-call',
    lua: `addappid(\n3787240,\n123456\n)\nsetManifestid(3787240, "abc")`,
  },
]

async function runSample({ name, lua }) {
  const zip = new JSZip()
  zip.file(`${name}.lua`, lua)
  const buf = await zip.generateAsync({ type: 'nodebuffer' })
  const out = await cleanManifestZip(Buffer.from(buf))
  const z2 = await JSZip.loadAsync(out)
  const outLua = await z2.file(`${name}.lua`).async('string')
  console.log(`\n=== ${name} ===`)
  console.log('changed:', outLua.replace(/\r/g, '') !== lua.replace(/\r/g, ''))
  console.log(outLua)
}

async function main() {
  for (const sample of samples) await runSample(sample)

  const appId = process.argv[2]
  if (!appId) return

  if (process.env.NEON_DATABASE_URL) process.env.DATABASE_URL = process.env.NEON_DATABASE_URL
  const { getManifestBuffer } = require('../app/lib/storage')
  // storage is TS - use dynamic import won't work in plain node easily
  const axios = require('axios')
  const key = process.env.TEST_API_KEY || process.env.OPENSTEAM_TEST_KEY
  if (!key) {
    console.log('\nNo TEST_API_KEY — skip live fetch')
    return
  }
  const url = `https://manifest-web-ylio.onrender.com/api/v2/generate/${appId}?format=zip`
  const res = await axios.get(url, {
    headers: { Authorization: `Bearer ${key}`, Accept: 'application/zip' },
    responseType: 'arraybuffer',
    validateStatus: () => true,
    timeout: 120000,
  })
  console.log('\n=== LIVE', appId, 'status', res.status, 'bytes', res.data?.length)
  if (res.status !== 200) {
    console.log(res.data?.toString?.()?.slice(0, 400))
    return
  }
  const buf = Buffer.from(res.data)
  const zip = await JSZip.loadAsync(buf)
  for (const n of Object.keys(zip.files)) {
    if (!n.toLowerCase().endsWith('.lua')) continue
    const lua = await zip.file(n).async('string')
    console.log('\n--- live lua file:', n, '---')
    console.log(lua.slice(0, 800))
    const cleaned = await cleanManifestZip(buf)
    const z2 = await JSZip.loadAsync(cleaned)
    const outLua = await z2.file(n).async('string')
    console.log('\n--- after cleanManifestZip ---')
    console.log(outLua.slice(0, 800))
    console.log('clean changed zip:', !cleaned.equals(buf))
  }
}

main().catch(console.error)
