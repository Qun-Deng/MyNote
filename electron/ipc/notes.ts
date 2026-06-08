import { ipcMain } from 'electron'
import fs from 'fs'
import path from 'path'

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

// ====== IPC Handlers ======

export function registerNotesIPC() {
  // List all notes
  ipcMain.handle('notes:list', async () => {
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
          const stat = fs.statSync(fullPath)
          const content = fs.readFileSync(fullPath, 'utf-8')
          notes.push({
            id: 0, // Will be populated by DB later
            path: relPath,
            title: getTitle(relPath, content),
            created_at: stat.birthtime.toISOString(),
            updated_at: stat.mtime.toISOString(),
            tags: [],
            is_diary: relPath.startsWith('diary/'),
            diary_date: null,
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

    return {
      meta: {
        id: 0,
        path: filePath,
        title: getTitle(filePath, content),
        created_at: stat.birthtime.toISOString(),
        updated_at: stat.mtime.toISOString(),
        tags: [],
        is_diary: filePath.startsWith('diary/'),
        diary_date: null,
      },
      content,
    }
  })

  // Write a note
  ipcMain.handle('notes:write', async (_event, filePath: string, content: string) => {
    if (!vaultPath) throw new Error('Vault not initialized')
    const fullPath = resolveNotePath(filePath)
    ensureDir(path.dirname(fullPath))
    fs.writeFileSync(fullPath, content, 'utf-8')
  })

  // Create a note
  ipcMain.handle('notes:create', async (_event, folderPath: string, title: string) => {
    if (!vaultPath) throw new Error('Vault not initialized')
    const fileName = title.endsWith('.md') ? title : `${title}.md`
    const filePath = path.join(folderPath, fileName)
    const fullPath = resolveNotePath(filePath)
    ensureDir(path.dirname(fullPath))

    const template = `# ${title}\n\n`
    fs.writeFileSync(fullPath, template, 'utf-8')

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
}
