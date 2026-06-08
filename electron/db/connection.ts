import initSqlJs, { Database } from 'sql.js'
import path from 'path'
import fs from 'fs'

let db: Database | null = null
let dbPath: string | null = null

function resolveWasmPath(): string | null {
  const candidates: string[] = []

  // Strategy 1: resolve from sql.js package location (most reliable)
  try {
    const sqljsDir = path.dirname(require.resolve('sql.js/package.json'))
    candidates.push(path.join(sqljsDir, 'dist', 'sql-wasm.wasm'))
  } catch {}

  // Strategy 2: from cwd (dev mode: project root)
  candidates.push(path.join(process.cwd(), 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm'))

  // Strategy 3: one level up from cwd
  candidates.push(path.join(process.cwd(), '..', 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm'))

  // Strategy 4: relative to execPath
  candidates.push(path.join(path.dirname(process.execPath), 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm'))

  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) {
        console.log('[DB] Found WASM at:', p)
        return p
      }
    } catch {}
  }

  console.warn('[DB] No local WASM found. Tried:', candidates)
  return null
}

export async function initDatabase(vaultPath: string): Promise<Database> {
  dbPath = path.join(vaultPath, '.mynote.db')
  console.log('[DB] Initializing database at:', dbPath)

  // Load SQL.js
  const wasmPath = resolveWasmPath()
  let SQL
  try {
    SQL = wasmPath
      ? await initSqlJs({ locateFile: () => wasmPath })
      : await initSqlJs()
    console.log('[DB] SQL.js loaded successfully')
  } catch (err) {
    console.error('[DB] Failed to load SQL.js WASM:', err)
    throw new Error(`SQL.js 加载失败: ${err instanceof Error ? err.message : String(err)}。请检查网络连接或 node_modules 是否完整。`)
  }

  if (fs.existsSync(dbPath)) {
    console.log('[DB] Loading existing database')
    const buffer = fs.readFileSync(dbPath)
    db = new SQL.Database(buffer)
  } else {
    console.log('[DB] Creating new database')
    db = new SQL.Database()
    createSchema(db)
    saveDatabase()
    console.log('[DB] New database saved to:', dbPath)
  }

  // Run migrations for both new and existing databases
  try { db.run('ALTER TABLE todos ADD COLUMN deadline TEXT') } catch {}
  try { db.run('ALTER TABLE notes ADD COLUMN archived INTEGER DEFAULT 0') } catch {}
  try { db.run('ALTER TABLE notes ADD COLUMN pinned INTEGER DEFAULT 0') } catch {}
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
