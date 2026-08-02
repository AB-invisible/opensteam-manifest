import fs from 'fs'
import path from 'path'
import { uploadToS3, getS3Stream, s3FileExists, uploadBufferToS3, getS3ObjectContentLength } from './s3'
import { prisma } from './prisma'

/**
 * Railway Volume Storage Utility
 * 
 * On Railway: set STORAGE_PATH to your volume mount (e.g. /data)
 * Locally: defaults to ./data in project root
 */

const STORAGE_PATH = process.env.STORAGE_PATH || path.join(process.cwd(), 'data')

// Auto-create the base bucket folders so the app never crashes from missing dirs
ensureDir(STORAGE_PATH)
ensureDir(path.join(STORAGE_PATH, 'manifests'))
ensureDir(path.join(STORAGE_PATH, 'user-data'))

export function getManifestDir(appId: string | number): string {
  return path.join(STORAGE_PATH, 'manifests', String(appId))
}

export function getManifestFilePath(appId: string | number, filename: string): string {
  return path.join(getManifestDir(appId), filename)
}

export function ensureDir(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true })
  }
}

/**
 * Local-only storage for User Data (Forge scripts, metadata, etc.)
 * Strictly bypasses S3 to keep private user data on the local volume.
 */
export function getUserDataDir(subDir: string = ''): string {
  const dir = path.join(STORAGE_PATH, 'user-data', subDir)
  ensureDir(dir)
  return dir
}

export function writeUserData(filename: string, content: string | Buffer, subDir: string = ''): string {
  const dir = getUserDataDir(subDir)
  const filePath = path.join(dir, filename)
  fs.writeFileSync(filePath, content)
  return filePath
}

export function readUserData(filename: string, subDir: string = ''): Buffer | null {
  const filePath = path.join(getUserDataDir(subDir), filename)
  if (!fs.existsSync(filePath)) return null
  return fs.readFileSync(filePath)
}

export function deleteUserData(filename: string, subDir: string = ''): void {
  const filePath = path.join(getUserDataDir(subDir), filename)
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath)
  }
}

/**
 * Forge Sandbox Persistent Storage
 * Allows scripts to save state that survives redeploys.
 */
export function writeForgeData(userId: string, key: string, data: any): void {
  const dir = getUserDataDir(`forge/${userId}`)
  const filePath = path.join(dir, `${key}.json`)
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2))
}

export function readForgeData(userId: string, key: string): any | null {
  const filePath = path.join(getUserDataDir(`forge/${userId}`), `${key}.json`)
  if (!fs.existsSync(filePath)) return null
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'))
  } catch (e) {
    return null
  }
}

/**
 * Write a file for a manifest.
 * Creates directories automatically.
 */
export function writeManifestFile(appId: string | number, filename: string, content: string | Buffer): string {
  const dir = getManifestDir(appId)
  ensureDir(dir)
  const filePath = path.join(dir, filename)
  fs.writeFileSync(filePath, content)
  return filePath
}

/**
 * Persist a manifest file: Write to local storage, then move to S3 if configured.
 * Local copy is deleted after S3 upload to ensure S3 is the source of truth.
 */
export async function persistManifest(appId: string | number, buffer: Buffer): Promise<{ path: string | null; storageType: 'local' | 's3' }> {
  const appIdStr = String(appId)
  const filename = `${appIdStr}.zip`
  const s3Key = `manifests/${appIdStr}/${filename}`
  
  // 1. Priority: Direct S3 Upload (No intermediate disk storage)
  if (process.env.BUCKET_TYPE !== 'windows' && process.env.AWS_S3_BUCKET_NAME) {
    try {
      console.log(`[Storage] Uploading ${filename} directly to S3 bucket...`)
      await uploadBufferToS3(buffer, s3Key, 'application/zip')
      console.log(`[Storage] Direct upload successful.`)
      return { path: null, storageType: 's3' }
    } catch (err) {
      console.error(`[Storage] S3 direct upload failed, falling back:`, err)
    }
  }

  // 2. Fallback: Local Storage (only if S3 is unavailable)
  console.log(`[Storage] Saving ${filename} to local volume fallback...`)
  const savedPath = writeManifestFile(appIdStr, filename, buffer)
  return { path: savedPath, storageType: 'local' }
}

/**
 * Read a manifest file.
 */
export function readManifestFile(appId: string | number, filename: string): Buffer {
  const filePath = getManifestFilePath(appId, filename)
  return fs.readFileSync(filePath)
}

export function manifestFileExists(appId: string | number, filename: string): boolean {
  return fs.existsSync(getManifestFilePath(appId, filename))
}

/**
 * Get the zip file path for a manifest.
 * Convention: {appId}.zip inside the manifest directory.
 */
export function getZipPath(appId: string | number): string {
  return getManifestFilePath(appId, `${appId}.zip`)
}

export function zipExists(appId: string | number): boolean {
  return fs.existsSync(getZipPath(appId))
}

/**
 * Async check if zip exists in ANY configured storage (Local or S3).
 */
export async function anyStorageZipExists(appId: string | number): Promise<boolean> {
  const appIdStr = String(appId)
  
  // 1. Primary Check: S3 Bucket (Our own manifests)
  if (process.env.BUCKET_TYPE !== 'windows' && process.env.AWS_S3_BUCKET_NAME) {
    try {
      const exists = await s3FileExists(`manifests/${appIdStr}/${appIdStr}.zip`)
      if (exists) {
        console.log(`[Storage] ${appIdStr} found in S3 bucket.`)
        return true
      }
    } catch (err) {
      console.error(`[Storage] S3 check failed for ${appIdStr}:`, err)
    }
  }

  // 2. Secondary Check: Local Storage (Fallback/Legacy)
  if (zipExists(appIdStr)) {
    console.log(`[Storage] ${appIdStr} found in local fallback storage.`)
    return true
  }

  return false
}

/** Byte size of the manifest zip in S3 (if present) else local, else null. */
export async function getManifestZipSizeBytes(appId: string | number): Promise<number | null> {
  const appIdStr = String(appId)
  const s3Key = `manifests/${appIdStr}/${appIdStr}.zip`
  if (process.env.BUCKET_TYPE !== 'windows' && process.env.AWS_S3_BUCKET_NAME) {
    const inBucket = await s3FileExists(s3Key)
    if (inBucket) {
      const len = await getS3ObjectContentLength(s3Key)
      if (len != null) return len
    }
  }
  if (zipExists(appIdStr)) {
    return fs.statSync(getZipPath(appIdStr)).size
  }
  return null
}


/**
 * Get file size in bytes, or null if file doesn't exist.
 */
export function getFileSize(appId: string | number, filename: string): number | null {
  const filePath = getManifestFilePath(appId, filename)
  if (!fs.existsSync(filePath)) return null
  return fs.statSync(filePath).size
}

export function listManifestFiles(appId: string | number): string[] {
  const dir = getManifestDir(appId)
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir)
}

/**
 * List all manifest app IDs registered in the database.
 * This is now the source of truth instead of checking the local filesystem.
 */
export async function listAllManifests(): Promise<string[]> {
  const manifests = await prisma.manifest.findMany({ select: { steamAppId: true } })
  return manifests.map(m => m.steamAppId)
}

/**
 * Delete a manifest and all its files from all storage layers and the database.
 */
export async function deleteManifest(appId: string | number): Promise<void> {
  const appIdStr = String(appId)
  
  // 1. Delete from Database
  await prisma.manifest.deleteMany({
    where: { steamAppId: appIdStr }
  })

  // 2. Delete from Local Storage (if exists)
  const dir = getManifestDir(appId)
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true })
  }

  // 3. Delete from S3 (if configured)
  if (process.env.BUCKET_TYPE !== 'windows' && process.env.AWS_S3_BUCKET_NAME) {
    const { deleteFromS3 } = await import('./s3')
    try {
      await deleteFromS3(`manifests/${appIdStr}/${appIdStr}.zip`)
      console.log(`[Storage] Deleted ${appIdStr} from S3.`)
    } catch (err) {
      console.warn(`[Storage] Failed S3 cleanup for ${appIdStr}, it might not have existed there.`)
    }
  }
}

/**
 * Get total storage usage. 
 * Reports both the actual DB-calculated library size and the local transient buffer size.
 */
export async function getStorageUsage(): Promise<{ totalBytes: number; manifestCount: number; localBufferBytes: number }> {
  const manifestsDir = path.join(STORAGE_PATH, 'manifests')
  let localBufferBytes = 0

  if (fs.existsSync(manifestsDir)) {
    const dirs = fs.readdirSync(manifestsDir)
    for (const dir of dirs) {
      const fullDir = path.join(manifestsDir, dir)
      if (fs.statSync(fullDir).isDirectory()) {
        const files = fs.readdirSync(fullDir)
        for (const file of files) {
          localBufferBytes += fs.statSync(path.join(fullDir, file)).size
        }
      }
    }
  }

  // Get global library stats from DB
  const stats = await prisma.manifest.aggregate({
    _sum: { fileSize: true },
    _count: { id: true }
  })

  return {
    totalBytes: Number(stats._sum.fileSize || 0),
    manifestCount: stats._count.id,
    localBufferBytes
  }
}

/**
 * Get a readable stream for a manifest.
 * Priority: S3 is the source of truth for all manifest ZIPs.
 * Local files are only used for transient caching or as a fallback if S3 is unavailable.
 */
export async function getManifestStream(appId: string | number): Promise<{ body: any; contentLength: number | null }> {
  const appIdStr = String(appId)
  const filename = `${appIdStr}.zip`
  const s3Key = `manifests/${appIdStr}/${filename}`

  // 1. Primary: Fetch from S3
  if (process.env.BUCKET_TYPE !== 'windows' && process.env.AWS_S3_BUCKET_NAME) {
    try {
      const existsInS3 = await s3FileExists(s3Key)
      if (existsInS3) {
        const result = await getS3Stream(s3Key)
        if (result && result.body) {
          return {
            body: result.body,
            contentLength: result.contentLength ? Number(result.contentLength) : null
          }
        }
      }
    } catch (err) {
      console.error(`[Storage] Error fetching from S3 for ${appIdStr}:`, err)
    }
  }

  // 2. Secondary: Local fetch
  if (zipExists(appIdStr)) {
    const filePath = getZipPath(appIdStr)
    const stats = fs.statSync(filePath)

    // Only warn about fallback if S3 is actually configured but file wasn't found there
    if (process.env.BUCKET_TYPE !== 'windows' && process.env.AWS_S3_BUCKET_NAME) {
      console.warn(`[Storage] Manifest ${appIdStr} fetched from local fallback (S3 missing).`)
    }

    return {
      body: fs.createReadStream(filePath),
      contentLength: stats.size
    }
  }

  return { body: null, contentLength: null }
}

/**
 * Read a manifest zip fully into a Buffer (S3 → local fallback, same priority
 * as getManifestStream). Manifest zips are tiny (usually < 1 MB — just a .lua
 * inside), so buffering is fine and lets callers run cheap in-process
 * post-processing such as cleanManifestZip().
 */
export async function getManifestBuffer(appId: string | number): Promise<Buffer | null> {
  const { body, contentLength } = await getManifestStream(appId)
  if (!body) return null

  // Already-Buffer fallback (some S3 adapters yield a Buffer directly)
  if (Buffer.isBuffer(body)) return body

  // Stream → Buffer
  const chunks: Buffer[] = []
  try {
    for await (const chunk of body as AsyncIterable<any>) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    }
  } catch (err) {
    console.error(`[Storage] getManifestBuffer stream read failed for ${appId}:`, err)
    return null
  }
  const out = Buffer.concat(chunks)
  // Light sanity check — if Content-Length was reported, make sure we got it all
  if (contentLength != null && out.length !== contentLength) {
    console.warn(`[Storage] getManifestBuffer length mismatch for ${appId}: got ${out.length} expected ${contentLength}`)
  }
  return out
}
