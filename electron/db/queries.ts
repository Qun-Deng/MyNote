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
  archived: number
  pinned: number
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
  deadline: string | null
}

// ====== Notes ======

export function upsertNote(note: {
  path: string
  title: string
  created_at: string
  updated_at: string
  tags: string
  is_diary: number
  diary_date: string | null
  archived?: number
  pinned?: number
}): number {
  const db = getDatabase()
  const existing = db.exec('SELECT id FROM notes WHERE path = ?', [note.path])
  if (existing.length > 0 && existing[0].values.length > 0) {
    // Update — preserve archived/pinned unless explicitly provided
    db.run(
      `UPDATE notes SET title=?, updated_at=?, tags=?, is_diary=?, diary_date=? WHERE path=?`,
      [note.title, note.updated_at, note.tags, note.is_diary, note.diary_date, note.path]
    )
    saveDatabase()
    return existing[0].values[0][0] as number
  } else {
    // Insert
    db.run(
      `INSERT INTO notes (path, title, created_at, updated_at, tags, is_diary, diary_date, archived, pinned)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [note.path, note.title, note.created_at, note.updated_at, note.tags, note.is_diary, note.diary_date, note.archived ?? 0, note.pinned ?? 0]
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
    archived: (row[8] ?? 0) as number,
    pinned: (row[9] ?? 0) as number,
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
    archived: (row[8] ?? 0) as number,
    pinned: (row[9] ?? 0) as number,
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
    deadline: row[8] as string | null,
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
    `INSERT INTO todos (note_path, content, completed, line_number, created_at, completed_at, priority, deadline)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [todo.note_path, todo.content, todo.completed, todo.line_number, todo.created_at, todo.completed_at, todo.priority, todo.deadline ?? null]
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

export function getTodoById(todoId: number): TodoRow | null {
  const db = getDatabase()
  const result = db.exec('SELECT * FROM todos WHERE id = ?', [todoId])
  if (result.length === 0 || result[0].values.length === 0) return null
  return rowToTodo(result[0].values[0])
}

export function deleteTodoById(todoId: number) {
  const db = getDatabase()
  db.run('DELETE FROM todos WHERE id = ?', [todoId])
  saveDatabase()
}

export function updateTodoDeadline(todoId: number, deadline: string | null) {
  const db = getDatabase()
  db.run('UPDATE todos SET deadline = ? WHERE id = ?', [deadline, todoId])
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

// ====== Archive & Pin ======

export function setNoteArchived(filePath: string, archived: boolean) {
  const db = getDatabase()
  db.run('UPDATE notes SET archived = ? WHERE path = ?', [archived ? 1 : 0, filePath])
  saveDatabase()
}

export function setNotePinned(filePath: string, pinned: boolean) {
  const db = getDatabase()
  db.run('UPDATE notes SET pinned = ? WHERE path = ?', [pinned ? 1 : 0, filePath])
  saveDatabase()
}

export function batchArchiveNotes(filePaths: string[], archived: boolean) {
  const db = getDatabase()
  const placeholders = filePaths.map(() => '?').join(',')
  db.run(`UPDATE notes SET archived = ? WHERE path IN (${placeholders})`, [archived ? 1 : 0, ...filePaths])
  saveDatabase()
}

export function batchDeleteNotes(filePaths: string[]) {
  const db = getDatabase()
  const placeholders = filePaths.map(() => '?').join(',')
  db.run(`DELETE FROM notes WHERE path IN (${placeholders})`, filePaths)
  db.run(`DELETE FROM todos WHERE note_path IN (${placeholders})`, filePaths)
  saveDatabase()
}

// ====== Tag Management ======

export function renameTagInNotes(oldName: string, newName: string) {
  const db = getDatabase()
  const notes = getAllNotes()
  for (const note of notes) {
    const tags: string[] = JSON.parse(note.tags || '[]')
    const idx = tags.indexOf(oldName)
    if (idx !== -1) {
      tags[idx] = newName
      db.run('UPDATE notes SET tags = ? WHERE id = ?', [JSON.stringify(tags), note.id])
    }
  }
  saveDatabase()
}

export function deleteTagFromNotes(tagName: string) {
  const db = getDatabase()
  const notes = getAllNotes()
  for (const note of notes) {
    const tags: string[] = JSON.parse(note.tags || '[]')
    const filtered = tags.filter((t) => t !== tagName)
    if (filtered.length !== tags.length) {
      db.run('UPDATE notes SET tags = ? WHERE id = ?', [JSON.stringify(filtered), note.id])
    }
  }
  saveDatabase()
}

export function batchAddTag(filePaths: string[], tag: string) {
  const db = getDatabase()
  for (const fp of filePaths) {
    const note = getNoteByPath(fp)
    if (!note) continue
    const tags: string[] = JSON.parse(note.tags || '[]')
    if (!tags.includes(tag)) {
      tags.push(tag)
      db.run('UPDATE notes SET tags = ? WHERE path = ?', [JSON.stringify(tags), fp])
    }
  }
  saveDatabase()
}

// ====== Links & Backlinks ======

export function updateLinksForNote(filePath: string, links: { target: string; context: string }[]) {
  const db = getDatabase()
  // Remove old links from this note
  db.run('DELETE FROM links WHERE from_path = ?', [filePath])
  // Insert new links
  for (const link of links) {
    db.run('INSERT INTO links (from_path, to_path, context) VALUES (?, ?, ?)',
      [filePath, link.target, link.context])
  }
  saveDatabase()
}

export function getBacklinks(notePath: string): { from_path: string; context: string }[] {
  const db = getDatabase()
  try {
    const result = db.exec(
      'SELECT from_path, context FROM links WHERE to_path = ? ORDER BY from_path',
      [notePath]
    )
    if (result.length === 0) return []
    return result[0].values.map((row: any[]) => ({
      from_path: row[0] as string,
      context: row[1] as string,
    }))
  } catch {
    return []
  }
}

export function getForwardLinks(notePath: string): string[] {
  const db = getDatabase()
  try {
    const result = db.exec(
      'SELECT to_path FROM links WHERE from_path = ? ORDER BY to_path',
      [notePath]
    )
    if (result.length === 0) return []
    return result[0].values.map((row: any[]) => row[0] as string)
  } catch {
    return []
  }
}

// ====== Stats ======

export function getNoteStats(filePath: string): { wordCount: number; charCount: number } | null {
  const db = getDatabase()
  try {
    const result = db.exec(
      "SELECT LENGTH(content) - LENGTH(REPLACE(content, ' ', '')) + 1, LENGTH(content) FROM notes_fts WHERE title = ?",
      [filePath]
    )
    if (result.length === 0 || result[0].values.length === 0) return null
    return {
      wordCount: result[0].values[0][0] as number,
      charCount: result[0].values[0][1] as number,
    }
  } catch {
    return null
  }
}
