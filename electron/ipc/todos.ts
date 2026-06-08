import { ipcMain } from 'electron'
import fs from 'fs'
import path from 'path'
import { getVaultPath } from './notes'

interface TodoItem {
  id: number
  note_path: string
  content: string
  completed: boolean
  line_number: number
  created_at: string
  completed_at: string | null
  priority: number
}

// In-memory todo store (will be replaced by SQLite in Phase 3)
let todos: TodoItem[] = []
let nextId = 1

function extractTodosFromMarkdown(filePath: string, markdown: string): TodoItem[] {
  const lines = markdown.split('\n')
  const items: TodoItem[] = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    // Match "- [ ] text" or "- [x] text" or "- [X] text"
    const match = line.match(/^\s*[-*+]\s+\[(\s|x|X)\]\s+(.+)$/)
    if (match) {
      const completed = match[1].toLowerCase() === 'x'
      items.push({
        id: 0,
        note_path: filePath,
        content: match[2].trim(),
        completed,
        line_number: i + 1,
        created_at: new Date().toISOString(),
        completed_at: completed ? new Date().toISOString() : null,
        priority: 0,
      })
    }
  }

  return items
}

function toggleTodoInFile(filePath: string, lineNumber: number): boolean {
  const vaultPath = getVaultPath()
  if (!vaultPath) return false

  const fullPath = path.join(vaultPath, filePath)
  if (!fs.existsSync(fullPath)) return false

  const content = fs.readFileSync(fullPath, 'utf-8')
  const lines = content.split('\n')

  if (lineNumber < 1 || lineNumber > lines.length) return false

  const line = lines[lineNumber - 1]
  if (line.includes('[ ]')) {
    lines[lineNumber - 1] = line.replace('[ ]', '[x]')
  } else if (line.includes('[x]') || line.includes('[X]')) {
    lines[lineNumber - 1] = line.replace(/\[x\]/i, '[ ]')
  } else {
    return false
  }

  fs.writeFileSync(fullPath, lines.join('\n'), 'utf-8')
  return true
}

export function registerTodosIPC() {
  // Extract todos from a note
  ipcMain.handle('todos:extract', async (_event, filePath: string, content: string) => {
    // Remove existing todos for this note
    todos = todos.filter((t) => t.note_path !== filePath)

    // Extract new todos
    const extracted = extractTodosFromMarkdown(filePath, content)
    for (const item of extracted) {
      item.id = nextId++
      todos.push(item)
    }
  })

  // List todos
  ipcMain.handle('todos:list', async (_event, filter?: { completed?: boolean }) => {
    if (filter?.completed !== undefined) {
      return todos.filter((t) => t.completed === filter.completed)
    }
    return [...todos]
  })

  // Toggle a todo
  ipcMain.handle('todos:toggle', async (_event, todoId: number) => {
    const todo = todos.find((t) => t.id === todoId)
    if (!todo) return

    // Toggle in the .md file
    const success = toggleTodoInFile(todo.note_path, todo.line_number)
    if (!success) return

    // Toggle in memory
    todo.completed = !todo.completed
    todo.completed_at = todo.completed ? new Date().toISOString() : null
  })

  // Sync all (re-scan all notes)
  ipcMain.handle('todos:sync-all', async () => {
    const vaultPath = getVaultPath()
    if (!vaultPath) return

    todos = []
    nextId = 1

    const walkDir = (dir: string) => {
      if (!fs.existsSync(dir)) return
      const items = fs.readdirSync(dir)
      for (const item of items) {
        if (item.startsWith('.')) continue
        const fullPath = path.join(dir, item)
        if (fs.statSync(fullPath).isDirectory()) {
          walkDir(fullPath)
        } else if (item.endsWith('.md')) {
          const relPath = path.relative(vaultPath, fullPath).replace(/\\/g, '/')
          const content = fs.readFileSync(fullPath, 'utf-8')
          const extracted = extractTodosFromMarkdown(relPath, content)
          for (const t of extracted) {
            t.id = nextId++
            todos.push(t)
          }
        }
      }
    }

    walkDir(vaultPath)
  })
}
