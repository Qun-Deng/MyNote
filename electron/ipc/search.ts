import { ipcMain } from 'electron'
import fs from 'fs'
import path from 'path'
import { getVaultPath } from './notes'

interface SearchResult {
  path: string
  title: string
  snippet: string
  rank: number
}

export function registerSearchIPC() {
  ipcMain.handle('search:query', async (_event, query: string) => {
    const vaultPath = getVaultPath()
    if (!vaultPath || !query.trim()) return []

    const results: SearchResult[] = []
    const lowerQuery = query.toLowerCase()

    const searchDir = (dir: string) => {
      if (!fs.existsSync(dir)) return
      const items = fs.readdirSync(dir)
      for (const item of items) {
        if (item.startsWith('.')) continue
        const fullPath = path.join(dir, item)
        if (fs.statSync(fullPath).isDirectory()) {
          searchDir(fullPath)
        } else if (item.endsWith('.md')) {
          const content = fs.readFileSync(fullPath, 'utf-8')
          const lowerContent = content.toLowerCase()
          const idx = lowerContent.indexOf(lowerQuery)

          if (idx !== -1) {
            const relPath = path.relative(vaultPath, fullPath).replace(/\\/g, '/')
            // Extract title from first heading
            const titleMatch = content.match(/^#\s+(.+)$/m)
            const title = titleMatch ? titleMatch[1] : path.basename(item, '.md')

            // Extract snippet around match
            const start = Math.max(0, idx - 40)
            const end = Math.min(content.length, idx + query.length + 40)
            let snippet = content.substring(start, end)
            if (start > 0) snippet = '...' + snippet
            if (end < content.length) snippet = snippet + '...'
            snippet = snippet.replace(/\n/g, ' ')

            results.push({
              path: relPath,
              title,
              snippet,
              rank: idx, // Simple rank by position
            })
          }
        }
      }
    }

    searchDir(vaultPath)
    return results.sort((a, b) => a.rank - b.rank).slice(0, 20)
  })

  ipcMain.handle('search:reindex', async () => {
    // Will be implemented with SQLite FTS5 in Phase 4
  })
}
