import { ipcMain } from 'electron'
import fs from 'fs'
import path from 'path'
import {
  upsertNote,
  getNoteByPath,
  getAllNotes,
  getRecentNotes,
  deleteNoteByPath,
  updateFTSIndex,
  setNoteArchived,
  setNotePinned,
  batchArchiveNotes,
  batchDeleteNotes,
  batchAddTag,
  renameTagInNotes,
  deleteTagFromNotes,
  updateLinksForNote,
  getBacklinks,
  getForwardLinks,
  getNoteStats,
} from '../db/queries'

let vaultPath: string | null = null

export function setVaultPath(p: string | null) {
  vaultPath = p
}

export function getVaultPath(): string | null {
  return vaultPath
}

// ====== Helpers ======

function resolveNotePath(filePath: string): string {
  if (!vaultPath) throw new Error('Vault not initialized')
  return path.join(vaultPath, filePath)
}

function ensureDir(dirPath: string) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true })
  }
}

function normalizeNoteFileName(title: string): string {
  const trimmed = title.trim()
  const base = trimmed.toLowerCase().endsWith('.md') ? trimmed.slice(0, -3) : trimmed
  const safeBase = base
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/[. ]+$/g, '')
    .trim()
  return `${safeBase || 'Untitled'}.md`
}

function normalizeNotePath(filePath: string): string {
  const dir = path.dirname(filePath)
  const fileName = normalizeNoteFileName(path.basename(filePath))
  return (dir === '.' ? fileName : path.join(dir, fileName)).replace(/\\/g, '/')
}

function getTitle(filePath: string, content: string): string {
  // Try to extract from first heading
  const match = content.match(/^#\s+(.+)$/m)
  if (match) return match[1]
  // Fallback to filename
  return path.basename(filePath, '.md')
}

function scanDirectory(dir: string, relativeTo: string): { name: string; path: string; type: 'file' | 'directory'; children?: any[] }[] {
  const entries: any[] = []
  if (!fs.existsSync(dir)) return entries

  const items = fs.readdirSync(dir)
  for (const item of items) {
    if (item.startsWith('.')) continue
    const fullPath = path.join(dir, item)
    const relPath = path.relative(relativeTo, fullPath).replace(/\\/g, '/')
    const stat = fs.statSync(fullPath)

    if (stat.isDirectory()) {
      entries.push({
        name: item,
        path: relPath,
        type: 'directory',
        children: scanDirectory(fullPath, relativeTo),
      })
    } else if (stat.isFile() && item.endsWith('.md')) {
      entries.push({
        name: item,
        path: relPath,
        type: 'file',
      })
    }
  }

  // Sort: directories first, then files, both alphabetically
  entries.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'directory' ? -1 : 1
    return a.name.localeCompare(b.name)
  })

  return entries
}

function syncNoteToDB(filePath: string, content: string) {
  try {
    const stat = fs.statSync(resolveNotePath(filePath))
    const tags = extractTags(content)
    upsertNote({
      path: filePath,
      title: getTitle(filePath, content),
      created_at: stat.birthtime.toISOString(),
      updated_at: stat.mtime.toISOString(),
      tags: JSON.stringify(tags),
      is_diary: filePath.startsWith('diary/') ? 1 : 0,
      diary_date: filePath.startsWith('diary/') ? extractDiaryDate(filePath) : null,
    })
    // Update FTS index
    try {
      updateFTSIndex(filePath, getTitle(filePath, content), content)
    } catch {}
    // Extract and store wikilinks
    try {
      const rawLinks = extractWikilinks(content)
      const resolved = resolveWikilinkTargets(rawLinks)
      updateLinksForNote(filePath, resolved)
    } catch {}
  } catch {
    // DB might not be initialized yet, that's OK
  }
}

function extractTags(content: string): string[] {
  const tags: string[] = []
  // 1. Frontmatter tags
  const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  if (fmMatch) {
    const fm = fmMatch[1]
    // YAML-style: tags: [tag1, tag2]
    const yamlMatch = fm.match(/tags:\s*\[([^\]]*)\]/)
    if (yamlMatch) {
      tags.push(...yamlMatch[1].split(',').map((t) => t.trim().replace(/['"]/g, '')))
    }
    // YAML-style: tags:\n  - tag1\n  - tag2
    const yamlListMatch = fm.match(/tags:\s*\n((?:\s*-\s*.+\n?)*)/)
    if (yamlListMatch) {
      const listItems = yamlListMatch[1].matchAll(/-\s*(.+)/g)
      for (const item of listItems) {
        tags.push(item[1].trim().replace(/['"]/g, ''))
      }
    }
  }
  // 2. Inline #tag syntax (not in code blocks or URLs)
  const bodyContent = content.replace(/^---[\s\S]*?---/, '') // Remove frontmatter
  const inlineTags = bodyContent.matchAll(/(?:^|\s)#([\w一-鿿-]+)/g)
  for (const match of inlineTags) {
    const tag = match[1].toLowerCase()
    if (!tags.includes(tag)) tags.push(tag)
  }
  return tags
}

// Get all unique tags across notes
export function getAllTags(): string[] {
  const allTags = new Set<string>()
  try {
    const { getAllNotes } = require('../db/queries')
    const notes = getAllNotes()
    for (const note of notes) {
      const noteTags = JSON.parse(note.tags || '[]')
      noteTags.forEach((t: string) => allTags.add(t))
    }
  } catch {}
  return Array.from(allTags).sort()
}

function extractDiaryDate(filePath: string): string | null {
  // Extract date from diary/YYYY/YYYY-MM-DD.md
  const match = filePath.match(/(\d{4}-\d{2}-\d{2})\.md$/)
  return match ? match[1] : null
}

function extractWikilinks(content: string): { target: string; context: string }[] {
  const links: { target: string; context: string }[] = []
  const regex = /\[\[([^\]|#]+)(?:[|#][^\]]+)?\]\]/g
  let match: RegExpExecArray | null
  while ((match = regex.exec(content)) !== null) {
    const target = match[1].trim()
    const start = Math.max(0, match.index - 20)
    const end = Math.min(content.length, match.index + match[0].length + 20)
    const context = content.slice(start, end).replace(/\n/g, ' ')
    links.push({ target, context })
  }
  return links
}

// ====== Tag Content Helpers ======

function replaceTagInFrontmatter(content: string, oldTag: string, newTag: string): string {
  const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  if (!fmMatch) return content

  const fm = fmMatch[1]
  let newFm = fm
  // YAML list: tags:\n  - oldTag\n  - other
  newFm = newFm.replace(
    new RegExp(`(\\s*-\\s*)${escapeRegex(oldTag)}(\\s*\\n|$)`, 'g'),
    `$1${newTag}$2`
  )
  // YAML array: tags: [oldTag, other] or tags: [other, oldTag]
  newFm = newFm.replace(
    new RegExp(`(\\[|,\\s*)${escapeRegex(oldTag)}(\\s*,|\\s*\\])`, 'g'),
    `$1${newTag}$2`
  )
  // YAML single: tags: oldTag
  newFm = newFm.replace(
    new RegExp(`^(\\s*tags:\\s*)${escapeRegex(oldTag)}\\s*$`, 'gm'),
    `$1${newTag}`
  )

  return content.replace(fmMatch[0], `---\n${newFm}\n---`)
}

function removeTagFromFrontmatter(content: string, tagName: string): string {
  const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  if (!fmMatch) return content

  const fm = fmMatch[1]
  let newFm = fm
  // YAML list item: \n  - tagName
  newFm = newFm.replace(
    new RegExp(`\\n\\s*-\\s*${escapeRegex(tagName)}\\s*\\n?`, 'g'),
    '\n'
  )
  // YAML array: remove from [a, tagName, b] → [a, b]
  newFm = newFm.replace(
    new RegExp(`,\\s*${escapeRegex(tagName)}\\s*(?=,|\\])`, 'g'),
    ''
  )
  newFm = newFm.replace(
    new RegExp(`${escapeRegex(tagName)}\\s*,\\s*`, 'g'),
    ''
  )
  newFm = newFm.replace(
    new RegExp(`\\[\\s*${escapeRegex(tagName)}\\s*\\]`, 'g'),
    '[]'
  )

  return content.replace(fmMatch[0], `---\n${newFm}\n---`)
}

function replaceInlineTag(content: string, oldTag: string, newTag: string): string {
  // Only replace standalone #tag (not in code blocks or frontmatter)
  const body = content.replace(/^---[\s\S]*?---/, '')
  const fmEnd = content.indexOf(body)
  const prefix = content.slice(0, fmEnd)

  const newBody = body.replace(
    new RegExp(`(?<=^|\\s)#${escapeRegex(oldTag)}(?=\\s|$|[.,;:!?，。；：！？])`, 'gm'),
    `#${newTag}`
  )

  return prefix + newBody
}

function removeInlineTag(content: string, tagName: string): string {
  const body = content.replace(/^---[\s\S]*?---/, '')
  const fmEnd = content.indexOf(body)
  const prefix = content.slice(0, fmEnd)

  const newBody = body.replace(
    new RegExp(`(?<=^|\\s)#${escapeRegex(tagName)}(?=\\s|$|[.,;:!?，。；：！？])`, 'gm'),
    ''
  )

  return prefix + newBody
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function resolveWikilinkTargets(rawLinks: { target: string; context: string }[]): { target: string; context: string }[] {
  // Build an index of all note paths for resolution
  const allPaths: string[] = []
  try {
    const notes = getAllNotes()
    allPaths.push(...notes.map(n => n.path))
  } catch {
    // If DB is unavailable, scan the filesystem
    if (vaultPath) {
      const scan = (dir: string) => {
        if (!fs.existsSync(dir)) return
        for (const item of fs.readdirSync(dir)) {
          if (item.startsWith('.')) continue
          const fp = path.join(dir, item)
          if (fs.statSync(fp).isDirectory()) { scan(fp) }
          else if (item.endsWith('.md')) {
            allPaths.push(path.relative(vaultPath!, fp).replace(/\\/g, '/'))
          }
        }
      }
      scan(vaultPath)
    }
  }

  return rawLinks.map(link => {
    const raw = link.target

    // Strategy 1: Exact match (with or without .md)
    if (allPaths.includes(raw)) return { ...link, target: raw }
    if (allPaths.includes(raw + '.md')) return { ...link, target: raw + '.md' }

    // Strategy 2: Case-insensitive filename match (e.g., "my note" → "notes/My Note.md")
    const rawLower = raw.toLowerCase().replace(/\.md$/i, '')
    const matched = allPaths.find(p => {
      const name = p.split('/').pop()?.replace(/\.md$/i, '')?.toLowerCase()
      return name === rawLower
    })
    if (matched) return { ...link, target: matched }

    // Strategy 3: Partial path match (e.g., "folder/note" → "notes/folder/note.md")
    const rawPath = raw.replace(/\\/g, '/').toLowerCase()
    const pathMatched = allPaths.find(p => p.toLowerCase().includes(rawPath))
    if (pathMatched) return { ...link, target: pathMatched }

    // Strategy 4: Search with .md appended
    const rawPathMd = rawPath + '.md'
    const pathMdMatched = allPaths.find(p => p.toLowerCase().includes(rawPathMd))
    if (pathMdMatched) return { ...link, target: pathMdMatched }

    // No match found — keep the raw target (link to a note that might be created later)
    return link
  })
}

// ====== IPC Handlers ======

export function registerNotesIPC() {
  // List all notes
  ipcMain.handle('notes:list', async () => {
    if (!vaultPath) return []

    // Try DB first, fall back to file scan
    try {
      const dbNotes = getAllNotes()
      if (dbNotes.length > 0) {
        return dbNotes.map((row) => ({
          id: row.id,
          path: row.path,
          title: row.title,
          created_at: row.created_at,
          updated_at: row.updated_at,
          tags: JSON.parse(row.tags || '[]'),
          is_diary: row.is_diary === 1,
          diary_date: row.diary_date,
          archived: row.archived === 1,
          pinned: row.pinned === 1,
        }))
      }
    } catch {}

    // Fall back to file system scan
    const notes: any[] = []
    const walkDir = (dir: string) => {
      if (!fs.existsSync(dir)) return
      const items = fs.readdirSync(dir)
      for (const item of items) {
        if (item.startsWith('.')) continue
        const fullPath = path.join(dir, item)
        if (fs.statSync(fullPath).isDirectory()) {
          walkDir(fullPath)
        } else if (item.endsWith('.md')) {
          const relPath = path.relative(vaultPath!, fullPath).replace(/\\/g, '/')
          const stat = fs.statSync(fullPath)
          const content = fs.readFileSync(fullPath, 'utf-8')
          notes.push({
            id: 0,
            path: relPath,
            title: getTitle(relPath, content),
            created_at: stat.birthtime.toISOString(),
            updated_at: stat.mtime.toISOString(),
            tags: extractTags(content),
            is_diary: relPath.startsWith('diary/'),
            diary_date: extractDiaryDate(relPath),
            archived: false,
            pinned: false,
          })
        }
      }
    }
    walkDir(vaultPath)
    return notes
  })

  // Read a note
  ipcMain.handle('notes:read', async (_event, filePath: string) => {
    if (!vaultPath) return null
    const fullPath = resolveNotePath(filePath)
    if (!fs.existsSync(fullPath)) return null

    const content = fs.readFileSync(fullPath, 'utf-8')
    const stat = fs.statSync(fullPath)

    // Try DB for metadata, fall back to extraction
    let meta: any
    try {
      const dbNote = getNoteByPath(filePath)
      if (dbNote) {
        meta = {
          id: dbNote.id,
          path: dbNote.path,
          title: dbNote.title,
          created_at: dbNote.created_at,
          updated_at: dbNote.updated_at,
          tags: JSON.parse(dbNote.tags || '[]'),
          is_diary: dbNote.is_diary === 1,
          diary_date: dbNote.diary_date,
          archived: dbNote.archived === 1,
          pinned: dbNote.pinned === 1,
        }
      } else {
        meta = buildMetaFromFile(filePath, content, stat)
      }
    } catch {
      meta = buildMetaFromFile(filePath, content, stat)
    }

    return { meta, content }
  })

  // Write a note
  ipcMain.handle('notes:write', async (_event, filePath: string, content: string) => {
    if (!vaultPath) throw new Error('Vault not initialized')
    const fullPath = resolveNotePath(filePath)
    ensureDir(path.dirname(fullPath))
    fs.writeFileSync(fullPath, content, 'utf-8')

    // Sync to DB
    syncNoteToDB(filePath, content)
  })

  // Create a note
  ipcMain.handle('notes:create', async (_event, folderPath: string, title: string) => {
    if (!vaultPath) throw new Error('Vault not initialized')
    const fileName = normalizeNoteFileName(title)
    const filePath = path.join(folderPath, fileName).replace(/\\/g, '/')
    const fullPath = resolveNotePath(filePath)
    ensureDir(path.dirname(fullPath))
    if (fs.existsSync(fullPath)) throw new Error(`Note already exists: ${filePath}`)

    const noteTitle = path.basename(fileName, '.md')
    const template = `# ${noteTitle}\n\n`
    fs.writeFileSync(fullPath, template, 'utf-8')

    // Sync to DB
    syncNoteToDB(filePath, template)

    return {
      id: 0,
      path: filePath,
      title: noteTitle,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      tags: [],
      is_diary: false,
      diary_date: null,
    }
  })

  // Delete a note
  ipcMain.handle('notes:delete', async (_event, filePath: string) => {
    if (!vaultPath) throw new Error('Vault not initialized')
    const fullPath = resolveNotePath(filePath)
    if (fs.existsSync(fullPath)) {
      fs.unlinkSync(fullPath)
    }
    // Remove from DB
    try {
      deleteNoteByPath(filePath)
    } catch {}
  })

  // Rename a note
  ipcMain.handle('notes:rename', async (_event, oldPath: string, newPath: string) => {
    if (!vaultPath) throw new Error('Vault not initialized')
    const normalizedNewPath = normalizeNotePath(newPath)
    const oldFull = resolveNotePath(oldPath)
    const newFull = resolveNotePath(normalizedNewPath)
    if (fs.existsSync(oldFull)) {
      if (fs.existsSync(newFull) && oldFull !== newFull) {
        throw new Error(`Target already exists: ${normalizedNewPath}`)
      }
      ensureDir(path.dirname(newFull))
      if (oldFull !== newFull) {
        fs.renameSync(oldFull, newFull)
      }
      const content = fs.readFileSync(newFull, 'utf-8')
      syncNoteToDB(normalizedNewPath, content)
      if (oldPath !== normalizedNewPath) {
        try {
          deleteNoteByPath(oldPath)
        } catch {}
      }
    }
    return normalizedNewPath
  })

  // Vault tree
  ipcMain.handle('vault:tree', async () => {
    if (!vaultPath) return []
    return scanDirectory(vaultPath, vaultPath)
  })

  // Recent notes
  ipcMain.handle('notes:recent', async () => {
    // Try DB first
    try {
      const rows = getRecentNotes(6)
      if (rows.length > 0) {
        return rows.map((row) => ({
          id: row.id,
          path: row.path,
          title: row.title,
          created_at: row.created_at,
          updated_at: row.updated_at,
          tags: JSON.parse(row.tags || '[]'),
          is_diary: row.is_diary === 1,
          diary_date: row.diary_date,
          archived: row.archived === 1,
          pinned: row.pinned === 1,
        }))
      }
    } catch {}

    // Fallback: file-system scan sorted by modification time
    if (!vaultPath) return []
    const notes: any[] = []
    const walkDir = (dir: string) => {
      if (!fs.existsSync(dir)) return
      const items = fs.readdirSync(dir)
      for (const item of items) {
        if (item.startsWith('.')) continue
        const fullPath = path.join(dir, item)
        if (fs.statSync(fullPath).isDirectory()) {
          walkDir(fullPath)
        } else if (item.endsWith('.md')) {
          const relPath = path.relative(vaultPath!, fullPath).replace(/\\/g, '/')
          // Skip diary notes for recent list
          if (relPath.startsWith('diary/')) return
          const stat = fs.statSync(fullPath)
          const content = fs.readFileSync(fullPath, 'utf-8')
          notes.push({
            id: 0,
            path: relPath,
            title: getTitle(relPath, content),
            created_at: stat.birthtime.toISOString(),
            updated_at: stat.mtime.toISOString(),
            tags: extractTags(content),
            is_diary: false,
            diary_date: null,
            archived: false,
            pinned: false,
          })
        }
      }
    }
    walkDir(vaultPath)
    notes.sort((a, b) => b.updated_at.localeCompare(a.updated_at))
    return notes.slice(0, 6)
  })

  // Get all tags
  ipcMain.handle('notes:tags', async () => {
    return getAllTags()
  })

  // Get notes by tag
  ipcMain.handle('notes:by-tag', async (_event, tag: string) => {
    try {
      const allNotes = getAllNotes()
      return allNotes
        .filter((row) => {
          const tags = JSON.parse(row.tags || '[]')
          return tags.includes(tag)
        })
        .map((row) => ({
          id: row.id,
          path: row.path,
          title: row.title,
          created_at: row.created_at,
          updated_at: row.updated_at,
          tags: JSON.parse(row.tags || '[]'),
          is_diary: row.is_diary === 1,
          diary_date: row.diary_date,
          archived: row.archived === 1,
          pinned: row.pinned === 1,
        }))
    } catch {
      return []
    }
  })

  // ====== Archive & Pin ======

  ipcMain.handle('notes:set-archived', async (_event, filePath: string, archived: boolean) => {
    setNoteArchived(filePath, archived)
  })

  ipcMain.handle('notes:set-pinned', async (_event, filePath: string, pinned: boolean) => {
    setNotePinned(filePath, pinned)
  })

  ipcMain.handle('notes:batch-archive', async (_event, filePaths: string[], archived: boolean) => {
    batchArchiveNotes(filePaths, archived)
  })

  ipcMain.handle('notes:batch-delete', async (_event, filePaths: string[]) => {
    if (!vaultPath) throw new Error('Vault not initialized')
    // Delete files from disk
    for (const fp of filePaths) {
      const fullPath = resolveNotePath(fp)
      if (fs.existsSync(fullPath)) {
        fs.unlinkSync(fullPath)
      }
    }
    // Delete from DB
    batchDeleteNotes(filePaths)
  })

  ipcMain.handle('notes:batch-tag', async (_event, filePaths: string[], tag: string) => {
    batchAddTag(filePaths, tag)
  })

  // ====== Tag Management ======

  ipcMain.handle('tags:rename', async (_event, oldName: string, newName: string) => {
    if (!vaultPath) return getAllTags()

    // 1. Update markdown files on disk
    const allNotes = getAllNotes()
    for (const note of allNotes) {
      const tags: string[] = JSON.parse(note.tags || '[]')
      if (!tags.includes(oldName)) continue

      const fullPath = resolveNotePath(note.path)
      if (!fs.existsSync(fullPath)) continue
      let content = fs.readFileSync(fullPath, 'utf-8')

      // Replace tag in frontmatter
      content = replaceTagInFrontmatter(content, oldName, newName)
      // Replace inline #tag (word boundary, not in code blocks)
      content = replaceInlineTag(content, oldName, newName)

      fs.writeFileSync(fullPath, content, 'utf-8')
    }

    // 2. Update DB
    renameTagInNotes(oldName, newName)
    return getAllTags()
  })

  ipcMain.handle('tags:delete', async (_event, tagName: string) => {
    if (!vaultPath) return getAllTags()

    // 1. Update markdown files on disk
    const allNotes = getAllNotes()
    for (const note of allNotes) {
      const tags: string[] = JSON.parse(note.tags || '[]')
      if (!tags.includes(tagName)) continue

      const fullPath = resolveNotePath(note.path)
      if (!fs.existsSync(fullPath)) continue
      let content = fs.readFileSync(fullPath, 'utf-8')

      // Remove tag from frontmatter
      content = removeTagFromFrontmatter(content, tagName)
      // Remove inline #tag
      content = removeInlineTag(content, tagName)

      fs.writeFileSync(fullPath, content, 'utf-8')
    }

    // 2. Update DB
    deleteTagFromNotes(tagName)
    return getAllTags()
  })

  // ====== Links & Backlinks ======

  ipcMain.handle('notes:update-links', async (_event, filePath: string, links: { target: string; context: string }[]) => {
    const resolved = resolveWikilinkTargets(links)
    updateLinksForNote(filePath, resolved)
  })

  ipcMain.handle('notes:backlinks', async (_event, notePath: string) => {
    return getBacklinks(notePath)
  })

  ipcMain.handle('notes:forward-links', async (_event, notePath: string) => {
    return getForwardLinks(notePath)
  })

  // ====== Stats ======

  ipcMain.handle('notes:stats', async (_event, filePath: string) => {
    return getNoteStats(filePath)
  })
}

function buildMetaFromFile(filePath: string, content: string, stat: fs.Stats) {
  return {
    id: 0,
    path: filePath,
    title: getTitle(filePath, content),
    created_at: stat.birthtime.toISOString(),
    updated_at: stat.mtime.toISOString(),
    tags: extractTags(content),
    is_diary: filePath.startsWith('diary/'),
    diary_date: extractDiaryDate(filePath),
    archived: false,
    pinned: false,
  }
}
