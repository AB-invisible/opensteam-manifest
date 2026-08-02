import { describe, expect, it } from 'vitest'

const {
  depotBoxBaseUrl,
  looksLikeArchive,
  parseFilenameFromDisposition,
  requestSpacingMs,
  resolveDepotBoxUrl,
} = require('../scripts/lib/depotbox')

describe('DepotBox helpers', () => {
  it('normalizes and resolves DepotBox URLs', () => {
    expect(depotBoxBaseUrl('https://depotbox.org///')).toBe('https://depotbox.org')
    expect(resolveDepotBoxUrl('/api/download/token', 'https://depotbox.org/')).toBe('https://depotbox.org/api/download/token')
    expect(resolveDepotBoxUrl('https://cdn.example/file.zip', 'https://depotbox.org')).toBe('https://cdn.example/file.zip')
  })

  it('uses a conservative default request spacing for 120 requests per minute', () => {
    expect(requestSpacingMs(120)).toBe(500)
    expect(requestSpacingMs(60)).toBe(1000)
    expect(requestSpacingMs(0)).toBe(0)
  })

  it('parses download filenames', () => {
    expect(parseFilenameFromDisposition('attachment; filename="Half_Life-70.zip"', '70.zip')).toBe('Half_Life-70.zip')
    expect(parseFilenameFromDisposition("attachment; filename*=UTF-8''Portal%202.zip", '620.zip')).toBe('Portal 2.zip')
    expect(parseFilenameFromDisposition('', '730.zip')).toBe('730.zip')
  })

  it('recognizes archive-like buffers', () => {
    expect(looksLikeArchive(Buffer.concat([Buffer.from('PK'), Buffer.alloc(1200)]))).toBe(true)
    expect(looksLikeArchive(Buffer.from('<html>error</html>'))).toBe(false)
  })
})
