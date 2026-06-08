import initSqlJs, { Database } from 'sql.js'
import path from 'path'
import fs from 'fs'

let db: Database | null = null
let dbPath: string | null = null

export async function initDatabase(vaultPath: string): Promise<Database> {
  dbPath = path.join(vaultPath, '.mynote.db')

  // Load existing DB or create new one
  const SQL = await initSqlJs()

  if (fs.existsSync(dbPath)) {
    const buffer = fs.readFileSync(dbPath)
    db = new SQL.Database(buffer)
  } else {
    db = new SQL.Database()
    createSchema(db)
    saveDatabase()
  }

  // Run migrations for both new and existing databases
  try { db.run('ALTER TABLE todos ADD COLUMN deadline TEXT') } catch { /* column already exists */ }
  saveDatabase()

  return db
}

export function getDatabase(): Database {
  if (!db) throw new Error('Database not initialized')
  return db
}

export function saveDatabase() {
  if (!db || !dbPath) return
  const data = db.export()
  const buffer = Buffer.from(data)
  fs.writeFileSync(dbPath, buffer)
}

function createSchema(db: Database) {
  db.run(`
    CREATE TABLE IF NOT EXISTS notes (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      path        TEXT NOT NULL UNIQUE,
      title       TEXT NOT NULL,
      created_at  TEXT NOT NULL,
      updated_at  TEXT NOT NULL,
      tags        TEXT DEFAULT '[]',
      is_diary    INTEGER DEFAULT 0,
      diary_date  TEXT
    );

    CREATE TABLE IF NOT EXISTS todos (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      note_path   TEXT NOT NULL,
      content     TEXT NOT NULL,
      completed   INTEGER DEFAULT 0,
      line_number INTEGER,
      created_at  TEXT NOT NULL,
      completed_at TEXT,
      priority    INTEGER DEFAULT 0,
      deadline    TEXT
    );

    CREATE TABLE IF NOT EXISTS tags (
      id    INTEGER PRIMARY KEY AUTOINCREMENT,
      name  TEXT NOT NULL UNIQUE
    );

    CREATE TABLE IF NOT EXISTS note_tags (
      note_id INTEGER,
      tag_id  INTEGER,
      PRIMARY KEY (note_id, tag_id)
    );

    CREATE TABLE IF NOT EXISTS links (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      from_path TEXT NOT NULL,
      to_path   TEXT NOT NULL,
      context   TEXT
    );
  `)

  // Create FTS5 virtual table for full-text search
  try {
    db.run(`
      CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
        title, content, tokenize='unicode61'
      );
    `)
  } catch {
    // FTS5 might not be available in all sql.js builds
    console.warn('FTS5 not available, full-text search will use basic scan')
  }

  saveDatabase()
}

export { dbPath }
