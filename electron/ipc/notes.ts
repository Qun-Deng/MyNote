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
    const fileName = title.endsWith('.md') ? title : `${title}.md`
    const filePath = path.join(folderPath, fileName).replace(/\\/g, '/')
    const fullPath = resolveNotePath(filePath)
    ensureDir(path.dirname(fullPath))

    const template = `# ${title}\n\n`
    fs.writeFileSync(fullPath, template, 'utf-8')

    // Sync to DB
    syncNoteToDB(filePath, template)

    return {
      id: 0,
      path: filePath,
      title,
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
    const oldFull = resolveNotePath(oldPath)
    const newFull = resolveNotePath(newPath)
    if (fs.existsSync(oldFull)) {
      ensureDir(path.dirname(newFull))
      fs.renameSync(oldFull, newFull)
    }
  })

  // Vault tree
  ipcMain.handle('vault:tree', async () => {
    if (!vaultPath) return []
    return scanDirectory(vaultPath, vaultPath)
  })

  // Recent notes
  ipcMain.handle('notes:recent', async () => {
    try {
      const rows = getRecentNotes(6)
      return rows.map((row) => ({
        id: row.id,
        path: row.path,
        title: row.title,
        created_at: row.created_at,
        updated_at: row.updated_at,
        tags: JSON.parse(row.tags || '[]'),
        is_diary: row.is_diary === 1,
        diary_date: row.diary_date,
      }))
    } catch {
      return []
    }
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
        }))
    } catch {
      return []
    }
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
  }
}
