require('dotenv').config()
if (process.env.NEON_DATABASE_URL) process.env.DATABASE_URL = process.env.NEON_DATABASE_URL

const { S3Client, GetObjectCommand, PutObjectCommand, ListObjectsV2Command } = require('@aws-sdk/client-s3')
const { PrismaClient } = require('@prisma/client')
const { cleanManifestZip } = require('./lib/clean-manifest')

async function streamToBuffer(body) {
  const chunks = []
  for await (const c of body) chunks.push(Buffer.from(c))
  return Buffer.concat(chunks)
}

async function main() {
  const bucket = process.env.AWS_S3_BUCKET_NAME
  if (!bucket) throw new Error('AWS_S3_BUCKET_NAME missing')

  const s3 = new S3Client({
    region: process.env.AWS_REGION || 'auto',
    endpoint: process.env.AWS_ENDPOINT || undefined,
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    },
    forcePathStyle: !!process.env.AWS_ENDPOINT,
  })

  const prisma = new PrismaClient()
  const manifests = await prisma.manifest.findMany({
    select: { steamAppId: true, name: true, s3Key: true },
  })

  let healed = 0
  let skipped = 0
  let failed = 0

  for (const m of manifests) {
    const key = m.s3Key || `manifests/${m.steamAppId}/${m.steamAppId}.zip`
    try {
      const out = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }))
      const raw = await streamToBuffer(out.Body)
      const cleaned = await cleanManifestZip(raw)
      if (Buffer.compare(cleaned, raw) === 0) {
        skipped += 1
        continue
      }
      await s3.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: cleaned,
          ContentType: 'application/zip',
        }),
      )
      await prisma.manifest.update({
        where: { steamAppId: m.steamAppId },
        data: { fileSize: BigInt(cleaned.length), updatedAt: new Date() },
      }).catch(() => {})
      healed += 1
      console.log('healed', m.steamAppId, m.name)
    } catch (e) {
      failed += 1
      console.warn('fail', m.steamAppId, e.message)
    }
  }

  console.log(JSON.stringify({ healed, skipped, failed, total: manifests.length }))
  await prisma.$disconnect()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
