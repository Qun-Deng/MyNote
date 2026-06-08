import { getDatabase, saveDatabase } from './connection'

export interface NoteRow {
  id: number
  path: string
  title: string
  created_at: string
  updated_at: string
  tags: string
  is_diary: number
  diary_date: string | null
}

export interface TodoRow {
  id: number
  note_path: string
  content: string
  completed: number
  line_number: number
  created_at: string
  completed_at: string | null
  priority: number
}

// ====== Notes ======

export function upsertNote(note: Omit<NoteRow, 'id'>): number {
  const db = getDatabase()
  const existing = db.exec('SELECT id FROM notes WHERE path = ?', [note.path])
  if (existing.length > 0 && existing[0].values.length > 0) {
    // Update
    db.run(
      `UPDATE notes SET title=?, updated_at=?, tags=?, is_diary=?, diary_date=? WHERE path=?`,
      [note.title, note.updated_at, note.tags, note.is_diary, note.diary_date, note.path]
    )
    saveDatabase()
    return existing[0].values[0][0] as number
  } else {
    // Insert
    db.run(
      `INSERT INTO notes (path, title, created_at, updated_at, tags, is_diary, diary_date)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [note.path, note.title, note.created_at, note.updated_at, note.tags, note.is_diary, note.diary_date]
    )
    saveDatabase()
    const result = db.exec('SELECT last_insert_rowid()')
    return result[0].values[0][0] as number
  }
}

export function getNoteByPath(filePath: string): NoteRow | null {
  const db = getDatabase()
  const result = db.exec('SELECT * FROM notes WHERE path = ?', [filePath])
  if (result.length === 0 || result[0].values.length === 0) return null
  const row = result[0].values[0]
  return {
    id: row[0] as number,
    path: row[1] as string,
    title: row[2] as string,
    created_at: row[3] as string,
    updated_at: row[4] as string,
    tags: row[5] as string,
    is_diary: row[6] as number,
    diary_date: row[7] as string | null,
  }
}

function rowToNote(row: any[]): NoteRow {
  return {
    id: row[0] as number,
    path: row[1] as string,
    title: row[2] as string,
    created_at: row[3] as string,
    updated_at: row[4] as string,
    tags: row[5] as string,
    is_diary: row[6] as number,
    diary_date: row[7] as string | null,
  }
}

function rowToTodo(row: any[]): TodoRow {
  return {
    id: row[0] as number,
    note_path: row[1] as string,
    content: row[2] as string,
    completed: row[3] as number,
    line_number: row[4] as number,
    created_at: row[5] as string,
    completed_at: row[6] as string | null,
    priority: row[7] as number,
  }
}

export function getAllNotes(): NoteRow[] {
  const db = getDatabase()
  const result = db.exec('SELECT * FROM notes ORDER BY updated_at DESC')
  if (result.length === 0) return []
  return result[0].values.map(rowToNote)
}

export function getRecentNotes(limit = 6): NoteRow[] {
  const db = getDatabase()
  const result = db.exec(
    'SELECT * FROM notes WHERE is_diary = 0 ORDER BY updated_at DESC LIMIT ?',
    [limit]
  )
  if (result.length === 0) return []
  return result[0].values.map(rowToNote)
}

export function deleteNoteByPath(filePath: string) {
  const db = getDatabase()
  db.run('DELETE FROM notes WHERE path = ?', [filePath])
  db.run('DELETE FROM todos WHERE note_path = ?', [filePath])
  // Also try FTS cleanup
  try { db.run('DELETE FROM notes_fts WHERE rowid IN (SELECT rowid FROM notes_fts WHERE title = ?)', [filePath]) } catch {}
  saveDatabase()
}

// ====== Todos ======

export function clearTodosForNote(notePath: string) {
  const db = getDatabase()
  db.run('DELETE FROM todos WHERE note_path = ?', [notePath])
}

export function insertTodo(todo: Omit<TodoRow, 'id'>) {
  const db = getDatabase()
  db.run(
    `INSERT INTO todos (note_path, content, completed, line_number, created_at, completed_at, priority)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [todo.note_path, todo.content, todo.completed, todo.line_number, todo.created_at, todo.completed_at, todo.priority]
  )
}

export function getAllTodos(filter?: { completed?: boolean }): TodoRow[] {
  const db = getDatabase()
  let query = 'SELECT * FROM todos'
  const params: any[] = []
  if (filter?.completed !== undefined) {
    query += ' WHERE completed = ?'
    params.push(filter.completed ? 1 : 0)
  }
  query += ' ORDER BY created_at DESC'
  const result = db.exec(query, params)
  if (result.length === 0) return []
  return result[0].values.map(rowToTodo)
}

export function updateTodoCompleted(todoId: number, completed: boolean) {
  const db = getDatabase()
  db.run(
    'UPDATE todos SET completed = ?, completed_at = ? WHERE id = ?',
    [completed ? 1 : 0, completed ? new Date().toISOString() : null, todoId]
  )
  saveDatabase()
}

// ====== Diary ======

export function getDiaryEntries(year: number, month: number): string[] {
  const db = getDatabase()
  const prefix = `${year}-${String(month).padStart(2, '0')}`
  const result = db.exec(
    "SELECT diary_date FROM notes WHERE is_diary = 1 AND diary_date LIKE ?",
    [`${prefix}%`]
  )
  if (result.length === 0) return []
  return result[0].values.map((row: any[]) => row[0] as string)
}

// ====== Search ======

export function searchNotesFTS(query: string): any[] {
  const db = getDatabase()
  try {
    const result = db.exec(
      "SELECT rowid, title, snippet(notes_fts, 1, '<mark>', '</mark>', '...', 32) as snippet FROM notes_fts WHERE notes_fts MATCH ? ORDER BY rank LIMIT 20",
      [query]
    )
    if (result.length === 0) return []
    return result[0].values.map((row: any[]) => ({
      rowid: row[0],
      title: row[1],
      snippet: row[2],
    }))
  } catch {
    return []
  }
}

export function updateFTSIndex(notePath: string, title: string, content: string) {
  const db = getDatabase()
  try {
    // Delete existing entry
    db.run('DELETE FROM notes_fts WHERE title = ?', [notePath])
    // Insert new
    db.run('INSERT INTO notes_fts (title, content) VALUES (?, ?)', [title, content])
    saveDatabase()
  } catch {
    // FTS might not be available
  }
}
