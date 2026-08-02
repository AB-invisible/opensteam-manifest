import fs from 'fs'
import path from 'path'

let cachedKnowledgeBase: string | null = null

export function getSystemKnowledgeBase(): string {
  if (cachedKnowledgeBase) return cachedKnowledgeBase

  const kbDir = path.join(process.cwd(), 'docs', 'kb')
  let combinedDocs = ''

  try {
    if (fs.existsSync(kbDir)) {
      const files = fs.readdirSync(kbDir).filter(f => f.endsWith('.md'))
      for (const file of files) {
        const filePath = path.join(kbDir, file)
        const content = fs.readFileSync(filePath, 'utf-8')
        combinedDocs += `\n\n--- [FILE: ${file}] ---\n\n${content}`
      }
    }
  } catch (error) {
    console.error('[Docs Loader] Failed to load knowledge base:', error)
  }

  cachedKnowledgeBase = combinedDocs
  return cachedKnowledgeBase
}
