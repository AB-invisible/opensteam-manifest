import { describe, it, expect } from 'vitest'
import { isPlaceholderManifestName, safeManifestFilename } from '@/app/lib/manifest-filename'

describe('manifest-filename', () => {
  it('detects placeholder names', () => {
    expect(isPlaceholderManifestName('App 730')).toBe(true)
    expect(isPlaceholderManifestName('Manifest 730')).toBe(true)
    expect(isPlaceholderManifestName('Counter-Strike 2')).toBe(false)
  })

  it('builds safe download filenames', () => {
    expect(safeManifestFilename('Counter-Strike 2', 730)).toBe('Counter-Strike_2_730.zip')
    expect(safeManifestFilename('App 730', 730)).toBe('App_730.zip')
  })
})
