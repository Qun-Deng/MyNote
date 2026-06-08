import { ipcMain } from 'electron'
import fs from 'fs'
import path from 'path'
import { getVaultPath } from './notes'

// ====== File-based todo operations (no DB dependency) ======
// Each todo is identified by { note_path, line_number }.

interface TodoItem {
  id: number           // hash of note_path + line_number (stable within session)
  note_path: string
  content: string
  completed: boolean
  line_number: number
  created_at: string
  completed_at: string | null
  priority: number
  deadline: string | null
}

function hashId(notePath: string, line: number): number {
  let h = 0
  const s = `${notePath}:${line}`
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h + s.charCodeAt(i)) | 0
  }
  return Math.abs(h)
}

const DDL_REGEX = /📅(\d{4}-\d{2}-\d{2})/

function extractTodosFromFile(filePath: string): TodoItem[] {
  const vaultPath = getVaultPath()
  if (!vaultPath) return []

  const fullPath = path.join(vaultPath, filePath)
  if (!fs.existsSync(fullPath)) return []

  const markdown = fs.readFileSync(fullPath, 'utf-8')
  const lines = markdown.split('\n')
  const items: TodoItem[] = []

  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(/^\s*[-*+]\s+\[(\s|x|X)\]\s+(.+)$/)
    if (!match) continue

    const completed = match[1].toLowerCase() === 'x'
    let content = match[2].trim()

    let deadline: string | null = null
    const ddlMatch = content.match(DDL_REGEX)
    if (ddlMatch) {
      deadline = ddlMatch[1]
      content = content.replace(DDL_REGEX, '').trim()
    }

    items.push({
      id: hashId(filePath, i + 1),
      note_path: filePath,
      content,
      completed,
      line_number: i + 1,
      created_at: '',
      completed_at: completed ? '' : null,
      priority: 0,
      deadline,
    })
  }

  return items
}

function walkVaultAndCollect(filter?: { completed?: boolean }): TodoItem[] {
  const vaultPath = getVaultPath()
  if (!vaultPath) return []

  const all: TodoItem[] = []

  const walk = (dir: string) => {
    if (!fs.existsSync(dir)) return
    const entries = fs.readdirSync(dir)
    for (const entry of entries) {
      if (entry.startsWith('.')) continue
      const full = path.join(dir, entry)
      if (fs.statSync(full).isDirectory()) {
        walk(full)
      } else if (entry.endsWith('.md')) {
        const relPath = path.relative(vaultPath, full).replace(/\\/g, '/')
        const todos = extractTodosFromFile(relPath)
        for (const t of todos) {
          if (filter?.completed !== undefined && t.completed !== filter.completed) continue
          all.push(t)
        }
      }
    }
  }

  walk(vaultPath)
  return all
}

function findTodo(id: number): { note_path: string; line_number: number } | null {
  const vaultPath = getVaultPath()
  if (!vaultPath) return null

  // We need to find which file + line corresponds to this id
  // Since we can't reverse the hash, we scan all files
  const walk = (dir: string): { note_path: string; line_number: number } | null => {
    if (!fs.existsSync(dir)) return null
    const entries = fs.readdirSync(dir)
    for (const entry of entries) {
      if (entry.startsWith('.')) continue
      const full = path.join(dir, entry)
      if (fs.statSync(full).isDirectory()) {
        const result = walk(full)
        if (result) return result
      } else if (entry.endsWith('.md')) {
        const relPath = path.relative(vaultPath, full).replace(/\\/g, '/')
        const todos = extractTodosFromFile(relPath)
        const found = todos.find((t) => t.id === id)
        if (found) return { note_path: found.note_path, line_number: found.line_number }
      }
    }
    return null
  }

  return walk(vaultPath)
}

export function registerTodosIPC() {
  // List all todos (file-based scan)
  ipcMain.handle('todos:list', async (_event, filter?: { completed?: boolean }) => {
    try {
      return walkVaultAndCollect(filter)
    } catch (err) {
      console.error('Failed to list todos:', err)
      return []
    }
  })

  // Add a todo (append line to file)
  ipcMain.handle('todos:add', async (_event, notePath: string, content: string, deadline?: string) => {
    const vaultPath = getVaultPath()
    if (!vaultPath) throw new Error('Vault not initialized')

    const fullPath = path.join(vaultPath, notePath)
    if (!fs.existsSync(fullPath)) throw new Error('Note not found')

    let line = `- [ ] ${content}`
    if (deadline) line += ` 📅${deadline}`

    const fileContent = fs.readFileSync(fullPath, 'utf-8')
    const newContent = fileContent.replace(/\n?$/, '\n') + line + '\n'
    fs.writeFileSync(fullPath, newContent, 'utf-8')

    // Return the newly created todo
    const todos = extractTodosFromFile(notePath)
    const created = todos[todos.length - 1]
    return created
  })

  // Delete a todo (remove line from file)
  ipcMain.handle('todos:delete', async (_event, todoId: number) => {
    const found = findTodo(todoId)
    if (!found) throw new Error('Todo not found')

    const vaultPath = getVaultPath()
    if (!vaultPath) throw new Error('Vault not initialized')

    const fullPath = path.join(vaultPath, found.note_path)
    if (!fs.existsSync(fullPath)) return

    const content = fs.readFileSync(fullPath, 'utf-8')
    const lines = content.split('\n')
    if (found.line_number >= 1 && found.line_number <= lines.length) {
      lines.splice(found.line_number - 1, 1)
      fs.writeFileSync(fullPath, lines.join('\n'), 'utf-8')
    }
  })

  // Toggle a todo
  ipcMain.handle('todos:toggle', async (_event, todoId: number) => {
    const found = findTodo(todoId)
    if (!found) return

    const vaultPath = getVaultPath()
    if (!vaultPath) return

    const fullPath = path.join(vaultPath, found.note_path)
    if (!fs.existsSync(fullPath)) return

    const content = fs.readFileSync(fullPath, 'utf-8')
    const lines = content.split('\n')
    const idx = found.line_number - 1
    if (idx < 0 || idx >= lines.length) return

    const line = lines[idx]
    if (line.includes('[ ]')) {
      lines[idx] = line.replace('[ ]', '[x]')
    } else if (line.includes('[x]') || line.includes('[X]')) {
      lines[idx] = line.replace(/\[x\]/i, '[ ]')
    } else {
      return
    }

    fs.writeFileSync(fullPath, lines.join('\n'), 'utf-8')
  })

  // Sync all (legacy — now a no-op since we scan files directly)
  ipcMain.handle('todos:sync-all', async () => {
    // Already file-based; just return success
  })

  // Extract (legacy — no-op)
  ipcMain.handle('todos:extract', async () => {
    // No-op: file-based system doesn't need extraction
  })

  // ════════════════════════════════════════════════════════════════
  // Todo Page — independent JSON storage (not tied to markdown notes)
  // ════════════════════════════════════════════════════════════════

  const TODO_PAGE_FILE = '.mynote-todos.json'

  interface TodoPageItem {
    id: string
    content: string
    completed: boolean
    section: 'today' | 'week' | 'month'
    created_date: string   // 'YYYY-MM-DD'
    created_at: string      // ISO datetime
  }

  function readTodoPage(): TodoPageItem[] {
    const vp = getVaultPath()
    if (!vp) return []
    const filePath = path.join(vp, TODO_PAGE_FILE)
    if (!fs.existsSync(filePath)) return []
    try {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'))
      return Array.isArray(data) ? data : []
    } catch {
      return []
    }
  }

  function writeTodoPage(items: TodoPageItem[]) {
    const vp = getVaultPath()
    if (!vp) return
    const filePath = path.join(vp, TODO_PAGE_FILE)
    fs.writeFileSync(filePath, JSON.stringify(items, null, 2), 'utf-8')
  }

  let uuidCounter = 0
  function genId(): string {
    uuidCounter++
    return `${Date.now()}-${uuidCounter}`
  }

  ipcMain.handle('todo-page:list', async () => {
    return readTodoPage()
  })

  ipcMain.handle('todo-page:add', async (_event, content: string, section: string) => {
    const items = readTodoPage()
    const now = new Date()
    const item: TodoPageItem = {
      id: genId(),
      content,
      completed: false,
      section: section as TodoPageItem['section'],
      created_date: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`,
      created_at: now.toISOString(),
    }
    items.push(item)
    writeTodoPage(items)
    return item
  })

  ipcMain.handle('todo-page:delete', async (_event, id: string) => {
    const items = readTodoPage()
    writeTodoPage(items.filter((t) => t.id !== id))
  })

  ipcMain.handle('todo-page:toggle', async (_event, id: string) => {
    const items = readTodoPage()
    const item = items.find((t) => t.id === id)
    if (item) {
      item.completed = !item.completed
      writeTodoPage(items)
    }
  })

  // Update deadline (file-based)
  ipcMain.handle('todos:update-deadline', async (_event, todoId: number, deadline: string | null) => {
    const found = findTodo(todoId)
    if (!found) return

    const vaultPath = getVaultPath()
    if (!vaultPath) return

    const fullPath = path.join(vaultPath, found.note_path)
    if (!fs.existsSync(fullPath)) return

    const content = fs.readFileSync(fullPath, 'utf-8')
    const lines = content.split('\n')
    const idx = found.line_number - 1
    if (idx < 0 || idx >= lines.length) return

    const line = lines[idx]
    // Remove existing deadline if any, add new one
    let cleaned = line.replace(/\s*📅\d{4}-\d{2}-\d{2}/, '')
    if (deadline) cleaned = cleaned.trimEnd() + ` 📅${deadline}`
    lines[idx] = cleaned

    fs.writeFileSync(fullPath, lines.join('\n'), 'utf-8')
  })
}
