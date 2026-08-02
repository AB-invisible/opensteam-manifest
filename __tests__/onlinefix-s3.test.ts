import { afterEach, describe, expect, it, vi } from 'vitest'

const ORIGINAL_ENV = { ...process.env }

function loadHelper(env: Record<string, string | undefined> = {}) {
  vi.resetModules()

  for (const key of [
    'AWS_S3_BUCKET_NAME',
    'AWS_DEFAULT_REGION',
    'AWS_ENDPOINT_URL',
    'ONLINEFIX_S3_PREFIX',
  ]) {
    delete process.env[key]
  }

  for (const [key, value] of Object.entries(env)) {
    if (value == null) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  }

  return require('../scripts/lib/onlinefix-s3')
}

afterEach(() => {
  vi.resetModules()
  process.env = { ...ORIGINAL_ENV }
})

describe('OnlineFix S3 helpers', () => {
  it('builds URL-safe S3 links for raw archive keys', () => {
    const { getOnlineFixS3Url } = loadHelper({
      AWS_S3_BUCKET_NAME: 'gamegen-files',
      AWS_DEFAULT_REGION: 'eu-central-1',
    })

    expect(getOnlineFixS3Url('OnlineFixes/My Game & Fix.rar')).toBe(
      'https://gamegen-files.s3.eu-central-1.amazonaws.com/OnlineFixes/My%20Game%20%26%20Fix.rar'
    )
  })

  it('preserves the OnlineFixes prefix when resolving file names', () => {
    const { onlineFixKeyForFileName } = loadHelper({
      AWS_S3_BUCKET_NAME: 'gamegen-files',
      ONLINEFIX_S3_PREFIX: 'OnlineFixes',
    })

    expect(onlineFixKeyForFileName('Palworld_Fix_Repair.rar')).toBe('OnlineFixes/Palworld_Fix_Repair.rar')
    expect(onlineFixKeyForFileName('OnlineFixes/Palworld_Fix_Repair.rar')).toBe('OnlineFixes/Palworld_Fix_Repair.rar')
  })

  it('converts S3 archive objects into indexed OnlineFix rows', () => {
    const { onlineFixGameFromS3Object } = loadHelper({
      AWS_S3_BUCKET_NAME: 'gamegen-files',
      AWS_DEFAULT_REGION: 'us-east-1',
    })

    const lastModified = new Date('2026-07-06T08:41:00Z')
    const game = onlineFixGameFromS3Object({
      Key: 'OnlineFixes/Palworld_Fix_Repair.rar',
      Size: 1024 * 1024,
      LastModified: lastModified,
    })

    expect(game).toMatchObject({
      name: 'Palworld',
      fileName: 'Palworld_Fix_Repair.rar',
      fileUrl: 'https://gamegen-files.s3.us-east-1.amazonaws.com/OnlineFixes/Palworld_Fix_Repair.rar',
      fileSize: '1.0 MB',
      lastUpdated: lastModified,
      s3Key: 'OnlineFixes/Palworld_Fix_Repair.rar',
    })
  })

  it('ignores non-archive S3 objects', () => {
    const { onlineFixGameFromS3Object } = loadHelper({
      AWS_S3_BUCKET_NAME: 'gamegen-files',
    })

    expect(onlineFixGameFromS3Object({ Key: 'OnlineFixes/readme.txt' })).toBeNull()
    expect(onlineFixGameFromS3Object({ Key: 'OnlineFixes/folder/' })).toBeNull()
  })
})
