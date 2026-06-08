import { ipcMain } from 'electron'
import fs from 'fs'
import path from 'path'
import { getVaultPath } from './notes'
import {
  clearTodosForNote,
  insertTodo,
  getAllTodos,
  updateTodoCompleted,
} from '../db/queries'

interface TodoExtract {
  note_path: string
  content: string
  completed: number
  line_number: number
  created_at: string
  completed_at: string | null
  priority: number
}

function extractTodosFromMarkdown(filePath: string, markdown: string): TodoExtract[] {
  const lines = markdown.split('\n')
  const items: TodoExtract[] = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const match = line.match(/^\s*[-*+]\s+\[(\s|x|X)\]\s+(.+)$/)
    if (match) {
      const completed = match[1].toLowerCase() === 'x'
      items.push({
        note_path: filePath,
        content: match[2].trim(),
        completed: completed ? 1 : 0,
        line_number: i + 1,
        created_at: new Date().toISOString(),
        completed_at: completed ? new Date().toISOString() : null,
        priority: 0,
      })
    }
  }

  return items
}

function toggleTodoInFile(filePath: string, lineNumber: number): string | null {
  const vaultPath = getVaultPath()
  if (!vaultPath) return null

  const fullPath = path.join(vaultPath, filePath)
  if (!fs.existsSync(fullPath)) return null

  const content = fs.readFileSync(fullPath, 'utf-8')
  const lines = content.split('\n')

  if (lineNumber < 1 || lineNumber > lines.length) return null

  const line = lines[lineNumber - 1]
  if (line.includes('[ ]')) {
    lines[lineNumber - 1] = line.replace('[ ]', '[x]')
  } else if (line.includes('[x]') || line.includes('[X]')) {
    lines[lineNumber - 1] = line.replace(/\[x\]/i, '[ ]')
  } else {
    return null
  }

  const newContent = lines.join('\n')
  fs.writeFileSync(fullPath, newContent, 'utf-8')
  return newContent
}

export function registerTodosIPC() {
  // Extract todos from a note
  ipcMain.handle('todos:extract', async (_event, filePath: string, content: string) => {
    try {
      // Clear existing todos for this note
      clearTodosForNote(filePath)

      // Extract new todos
      const extracted = extractTodosFromMarkdown(filePath, content)
      for (const item of extracted) {
        insertTodo(item)
      }
    } catch (err) {
      console.error('Failed to extract todos:', err)
    }
  })

  // List todos
  ipcMain.handle('todos:list', async (_event, filter?: { completed?: boolean }) => {
    try {
      const rows = getAllTodos(filter)
      return rows.map((row) => ({
        id: row.id,
        note_path: row.note_path,
        content: row.content,
        completed: row.completed === 1,
        line_number: row.line_number,
        created_at: row.created_at,
        completed_at: row.completed_at,
        priority: row.priority,
      }))
    } catch {
      return []
    }
  })

  // Toggle a todo
  ipcMain.handle('todos:toggle', async (_event, todoId: number) => {
    try {
      // Get the todo from DB
      const todos = getAllTodos()
      const todo = todos.find((t) => t.id === todoId)
      if (!todo) return

      // Toggle in the .md file
      const newContent = toggleTodoInFile(todo.note_path, todo.line_number)
      if (newContent !== null) {
        // Update DB
        const newCompleted = todo.completed === 0
        updateTodoCompleted(todoId, newCompleted)

        // Re-extract todos for this note
        clearTodosForNote(todo.note_path)
        const extracted = extractTodosFromMarkdown(todo.note_path, newContent)
        for (const item of extracted) {
          insertTodo(item)
        }
      }
    } catch (err) {
      console.error('Failed to toggle todo:', err)
    }
  })

  // Sync all (re-scan all notes)
  ipcMain.handle('todos:sync-all', async () => {
    const vaultPath = getVaultPath()
    if (!vaultPath) return

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
          clearTodosForNote(relPath)
          const extracted = extractTodosFromMarkdown(relPath, content)
          for (const t of extracted) {
            insertTodo(t)
          }
        }
      }
    }

    walkDir(vaultPath)
  })
}
