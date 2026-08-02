import fs from 'fs'
import path from 'path'

export interface KbArticle {
  id: string
  title: string
  path: string
  content: string
}

let cachedArticles: KbArticle[] | null = null
let lastCacheTime = 0
const CACHE_TTL_MS = 60 * 60 * 1000 // 1 hour cache

export function loadKnowledgeBase(): KbArticle[] {
  const now = Date.now()
  if (cachedArticles && now - lastCacheTime < CACHE_TTL_MS) {
    return cachedArticles
  }

  const articles: KbArticle[] = []
  const rootDir = process.cwd()
  const kbDir = path.join(rootDir, 'docs', 'kb')

  if (fs.existsSync(kbDir)) {
    const files = fs.readdirSync(kbDir)
    for (const file of files) {
      if (file.endsWith('.md')) {
        const fullPath = path.join(kbDir, file)
        try {
          const content = fs.readFileSync(fullPath, 'utf8')
          articles.push({
            id: file,
            title: file.replace('.md', '').replace(/-/g, ' ').toUpperCase(),
            path: `docs/kb/${file}`,
            content,
          })
        } catch (e: any) {
          console.warn(`[KB Service] Failed to read ${file}:`, e?.message)
        }
      }
    }
  }

  const rootDocs = ['API_DOCUMENTATION.md', 'API_ACTIVATION.md', 'README.md']
  for (const docFile of rootDocs) {
    const fullPath = path.join(rootDir, docFile)
    if (fs.existsSync(fullPath)) {
      try {
        const content = fs.readFileSync(fullPath, 'utf8')
        articles.push({
          id: docFile,
          title: docFile.replace('.md', '').replace(/_/g, ' '),
          path: docFile,
          content: content.slice(0, 4000),
        })
      } catch (e: any) {
        console.warn(`[KB Service] Failed to read root doc ${docFile}:`, e?.message)
      }
    }
  }

  cachedArticles = articles
  lastCacheTime = now
  return articles
}

export function getKnowledgeBaseContext(userQuery = ''): string {
  const articles = loadKnowledgeBase()
  if (!articles || articles.length === 0) {
    return 'OpenSteam platform: Steam manifest generation, delivery, and API service. Main manifest script is .lua; .manifest files are optional.'
  }

  if (!userQuery.trim()) {
    return articles
      .slice(0, 5)
      .map((a) => `=== ARTICLE: ${a.title} (${a.path}) ===\n${a.content.slice(0, 600)}...`)
      .join('\n\n')
  }

  const queryTerms = userQuery
    .toLowerCase()
    .replace(/[^\w\s]/g, '')
    .split(/\s+/)
    .filter((t) => t.length > 2)

  const scored = articles.map((article) => {
    let score = 0
    const lowerContent = article.content.toLowerCase()
    const lowerTitle = article.title.toLowerCase()

    for (const term of queryTerms) {
      if (lowerTitle.includes(term)) score += 10
      const count = lowerContent.split(term).length - 1
      score += Math.min(count, 5)
    }

    if (userQuery.toLowerCase().includes('manifest') || userQuery.toLowerCase().includes('lua')) {
      if (article.id.includes('manifest') || lowerContent.includes('.lua')) {
        score += 8
      }
    }

    return { article, score }
  })

  scored.sort((a, b) => b.score - a.score)

  const topArticles = scored
    .slice(0, 3)
    .filter((s) => s.score > 0)
    .map((s) => s.article)

  const selected = topArticles.length > 0 ? topArticles : articles.slice(0, 2)

  const contextText = selected
    .map((a) => `=== ARTICLE: ${a.title} (${a.path}) ===\n${a.content}`)
    .join('\n\n')

  return contextText.slice(0, 3500)
}
