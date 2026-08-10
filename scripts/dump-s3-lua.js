require('dotenv').config()
const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3')
const JSZip = require('jszip')
const { cleanManifestZip } = require('./lib/clean-manifest')

async function main() {
  const appId = process.argv[2] || '1067360'
  const s3 = new S3Client({
    region: process.env.AWS_REGION || 'auto',
    endpoint: process.env.AWS_ENDPOINT || undefined,
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    },
    forcePathStyle: !!process.env.AWS_ENDPOINT,
  })
  const key = `manifests/${appId}/${appId}.zip`
  const out = await s3.send(new GetObjectCommand({ Bucket: process.env.AWS_S3_BUCKET_NAME, Key: key }))
  const chunks = []
  for await (const c of out.Body) chunks.push(Buffer.from(c))
  const buf = Buffer.concat(chunks)
  const zip = await JSZip.loadAsync(buf)
  for (const n of Object.keys(zip.files)) {
    if (!n.toLowerCase().endsWith('.lua')) continue
    const raw = await zip.file(n).async('string')
    console.log('=== RAW', n, '===')
    console.log(raw)
  }
  const cleaned = await cleanManifestZip(buf)
  const z2 = await JSZip.loadAsync(cleaned)
  for (const n of Object.keys(z2.files)) {
    if (!n.toLowerCase().endsWith('.lua')) continue
    console.log('\n=== CLEANED', n, '===')
    console.log(await z2.file(n).async('string'))
  }
}

main().catch(console.error)
