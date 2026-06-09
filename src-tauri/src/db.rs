use rusqlite::{Connection, params};
use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NoteRow {
    pub id: i64,
    pub path: String,
    pub title: String,
    pub created_at: String,
    pub updated_at: String,
    pub tags: String,
    pub is_diary: i32,
    pub diary_date: Option<String>,
    pub archived: i32,
    pub pinned: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Backlink {
    #[serde(rename = "from_path")]
    pub from_path: String,
    pub context: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NoteStats {
    #[serde(rename = "wordCount")]
    pub word_count: i64,
    #[serde(rename = "charCount")]
    pub char_count: i64,
}

// ── Database lifecycle ──

pub fn open_or_create_db(db_path: &str) -> Result<Connection, rusqlite::Error> {
    let exists = Path::new(db_path).exists();
    let conn = Connection::open(db_path)?;

    if !exists {
        create_schema(&conn)?;
    }

    // Run migrations
    let _ = conn.execute("ALTER TABLE notes ADD COLUMN archived INTEGER DEFAULT 0", []);
    let _ = conn.execute("ALTER TABLE notes ADD COLUMN pinned INTEGER DEFAULT 0", []);
    let _ = conn.execute("ALTER TABLE todos ADD COLUMN deadline TEXT", []);

    Ok(conn)
}

fn create_schema(conn: &Connection) -> Result<(), rusqlite::Error> {
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS notes (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            path        TEXT NOT NULL UNIQUE,
            title       TEXT NOT NULL,
            created_at  TEXT NOT NULL,
            updated_at  TEXT NOT NULL,
            tags        TEXT DEFAULT '[]',
            is_diary    INTEGER DEFAULT 0,
            diary_date  TEXT,
            archived    INTEGER DEFAULT 0,
            pinned      INTEGER DEFAULT 0
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

        CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
            title, content, tokenize='unicode61'
        );
        "
    )?;
    Ok(())
}

// ── Notes CRUD ──

pub fn upsert_note(conn: &Connection, note: &NoteRow) -> Result<i64, rusqlite::Error> {
    let existing = conn.query_row(
        "SELECT id FROM notes WHERE path = ?1",
        params![note.path],
        |row| row.get::<_, i64>(0),
    );
    match existing {
        Ok(id) => {
            conn.execute(
                "UPDATE notes SET title=?1, updated_at=?2, tags=?3, is_diary=?4, diary_date=?5 WHERE path=?6",
                params![note.title, note.updated_at, note.tags, note.is_diary, note.diary_date, note.path],
            )?;
            Ok(id)
        }
        Err(_) => {
            conn.execute(
                "INSERT INTO notes (path, title, created_at, updated_at, tags, is_diary, diary_date, archived, pinned)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                params![
                    note.path, note.title, note.created_at, note.updated_at,
                    note.tags, note.is_diary, note.diary_date, note.archived, note.pinned
                ],
            )?;
            Ok(conn.last_insert_rowid())
        }
    }
}

pub fn get_note_by_path(conn: &Connection, file_path: &str) -> Option<NoteRow> {
    conn.query_row(
        "SELECT id, path, title, created_at, updated_at, tags, is_diary, diary_date, archived, pinned FROM notes WHERE path = ?1",
        params![file_path],
        |row| {
            Ok(NoteRow {
                id: row.get(0)?,
                path: row.get(1)?,
                title: row.get(2)?,
                created_at: row.get(3)?,
                updated_at: row.get(4)?,
                tags: row.get(5)?,
                is_diary: row.get(6)?,
                diary_date: row.get(7)?,
                archived: row.get(8).unwrap_or(0),
                pinned: row.get(9).unwrap_or(0),
            })
        },
    ).ok()
}

pub fn get_all_notes(conn: &Connection) -> Vec<NoteRow> {
    let mut stmt = conn
        .prepare("SELECT id, path, title, created_at, updated_at, tags, is_diary, diary_date, archived, pinned FROM notes ORDER BY updated_at DESC")
        .ok();
    let mut rows = Vec::new();
    if let Some(ref mut stmt) = stmt {
        if let Ok(iter) = stmt.query_map([], |row| {
            Ok(NoteRow {
                id: row.get(0)?,
                path: row.get(1)?,
                title: row.get(2)?,
                created_at: row.get(3)?,
                updated_at: row.get(4)?,
                tags: row.get(5)?,
                is_diary: row.get(6)?,
                diary_date: row.get(7)?,
                archived: row.get(8).unwrap_or(0),
                pinned: row.get(9).unwrap_or(0),
            })
        }) {
            for note in iter.flatten() {
                rows.push(note);
            }
        }
    }
    rows
}

pub fn get_recent_notes(conn: &Connection, limit: i64) -> Vec<NoteRow> {
    let mut stmt = conn
        .prepare(
            "SELECT id, path, title, created_at, updated_at, tags, is_diary, diary_date, archived, pinned
             FROM notes WHERE is_diary = 0 ORDER BY updated_at DESC LIMIT ?1"
        )
        .ok();
    let mut rows = Vec::new();
    if let Some(ref mut stmt) = stmt {
        if let Ok(iter) = stmt.query_map(params![limit], |row| {
            Ok(NoteRow {
                id: row.get(0)?,
                path: row.get(1)?,
                title: row.get(2)?,
                created_at: row.get(3)?,
                updated_at: row.get(4)?,
                tags: row.get(5)?,
                is_diary: row.get(6)?,
                diary_date: row.get(7)?,
                archived: row.get(8).unwrap_or(0),
                pinned: row.get(9).unwrap_or(0),
            })
        }) {
            for note in iter.flatten() {
                rows.push(note);
            }
        }
    }
    rows
}

pub fn delete_note_by_path(conn: &Connection, file_path: &str) -> Result<(), rusqlite::Error> {
    conn.execute("DELETE FROM notes WHERE path = ?1", params![file_path])?;
    conn.execute("DELETE FROM todos WHERE note_path = ?1", params![file_path])?;
    let _ = conn.execute("DELETE FROM notes_fts WHERE title = ?1", params![file_path]);
    Ok(())
}

// ── FTS ──

pub fn update_fts_index(conn: &Connection, note_path: &str, title: &str, content: &str) {
    let _ = conn.execute("DELETE FROM notes_fts WHERE title = ?1", params![note_path]);
    let _ = conn.execute(
        "INSERT INTO notes_fts (title, content) VALUES (?1, ?2)",
        params![title, content],
    );
}

pub fn search_notes_fts(conn: &Connection, query: &str) -> Vec<(String, String, String)> {
    let mut stmt = conn.prepare(
        "SELECT rowid, title, snippet(notes_fts, 1, '<mark>', '</mark>', '...', 32) as snippet
         FROM notes_fts WHERE notes_fts MATCH ?1 ORDER BY rank LIMIT 20"
    ).ok();
    let mut results = Vec::new();
    if let Some(ref mut stmt) = stmt {
        if let Ok(iter) = stmt.query_map(params![query], |row| {
            Ok((
                row.get::<_, i64>(0).unwrap_or(0).to_string(),
                row.get::<_, String>(1).unwrap_or_default(),
                row.get::<_, String>(2).unwrap_or_default(),
            ))
        }) {
            for r in iter.flatten() {
                results.push(r);
            }
        }
    }
    results
}

// ── Archive & Pin ──

pub fn set_note_archived(conn: &Connection, file_path: &str, archived: bool) -> Result<(), rusqlite::Error> {
    conn.execute(
        "UPDATE notes SET archived = ?1 WHERE path = ?2",
        params![archived as i32, file_path],
    )?;
    Ok(())
}

pub fn set_note_pinned(conn: &Connection, file_path: &str, pinned: bool) -> Result<(), rusqlite::Error> {
    conn.execute(
        "UPDATE notes SET pinned = ?1 WHERE path = ?2",
        params![pinned as i32, file_path],
    )?;
    Ok(())
}

pub fn batch_archive_notes(conn: &Connection, file_paths: &[String], archived: bool) -> Result<(), rusqlite::Error> {
    for path in file_paths {
        let _ = set_note_archived(conn, path, archived);
    }
    Ok(())
}

pub fn batch_delete_notes(conn: &Connection, file_paths: &[String]) -> Result<(), rusqlite::Error> {
    for path in file_paths {
        let _ = conn.execute("DELETE FROM notes WHERE path = ?1", params![path]);
        let _ = conn.execute("DELETE FROM todos WHERE note_path = ?1", params![path]);
    }
    Ok(())
}

// ── Tag Management ──

pub fn rename_tag_in_notes(conn: &Connection, old_name: &str, new_name: &str) -> Result<(), rusqlite::Error> {
    let notes = get_all_notes(conn);
    for note in notes {
        if let Ok(mut tags) = serde_json::from_str::<Vec<String>>(&note.tags) {
            if let Some(idx) = tags.iter().position(|t| t == old_name) {
                tags[idx] = new_name.to_string();
                let _ = conn.execute(
                    "UPDATE notes SET tags = ?1 WHERE id = ?2",
                    params![serde_json::to_string(&tags).unwrap_or_default(), note.id],
                );
            }
        }
    }
    Ok(())
}

pub fn delete_tag_from_notes(conn: &Connection, tag_name: &str) -> Result<(), rusqlite::Error> {
    let notes = get_all_notes(conn);
    for note in notes {
        if let Ok(tags) = serde_json::from_str::<Vec<String>>(&note.tags) {
            let filtered: Vec<String> = tags.iter().filter(|t| t != &tag_name).cloned().collect();
            if filtered.len() != tags.len() {
                let _ = conn.execute(
                    "UPDATE notes SET tags = ?1 WHERE id = ?2",
                    params![serde_json::to_string(&filtered).unwrap_or_default(), note.id],
                );
            }
        }
    }
    Ok(())
}

pub fn batch_add_tag(conn: &Connection, file_paths: &[String], tag: &str) -> Result<(), rusqlite::Error> {
    for fp in file_paths {
        if let Some(note) = get_note_by_path(conn, fp) {
            if let Ok(mut tags) = serde_json::from_str::<Vec<String>>(&note.tags) {
                if !tags.contains(&tag.to_string()) {
                    tags.push(tag.to_string());
                    let _ = conn.execute(
                        "UPDATE notes SET tags = ?1 WHERE path = ?2",
                        params![serde_json::to_string(&tags).unwrap_or_default(), fp],
                    );
                }
            }
        }
    }
    Ok(())
}

// ── Links & Backlinks ──

pub fn update_links_for_note(conn: &Connection, file_path: &str, links: &[(String, String)]) -> Result<(), rusqlite::Error> {
    let _ = conn.execute("DELETE FROM links WHERE from_path = ?1", params![file_path]);
    for (target, context) in links {
        let _ = conn.execute(
            "INSERT INTO links (from_path, to_path, context) VALUES (?1, ?2, ?3)",
            params![file_path, target, context],
        );
    }
    Ok(())
}

pub fn get_backlinks(conn: &Connection, note_path: &str) -> Vec<Backlink> {
    let mut stmt = conn
        .prepare("SELECT from_path, context FROM links WHERE to_path = ?1 ORDER BY from_path")
        .ok();
    let mut results = Vec::new();
    if let Some(ref mut stmt) = stmt {
        if let Ok(iter) = stmt.query_map(params![note_path], |row| {
            Ok(Backlink {
                from_path: row.get(0)?,
                context: row.get(1)?,
            })
        }) {
            for r in iter.flatten() {
                results.push(r);
            }
        }
    }
    results
}

pub fn get_forward_links(conn: &Connection, note_path: &str) -> Vec<String> {
    let mut stmt = conn
        .prepare("SELECT to_path FROM links WHERE from_path = ?1 ORDER BY to_path")
        .ok();
    let mut results = Vec::new();
    if let Some(ref mut stmt) = stmt {
        if let Ok(iter) = stmt.query_map(params![note_path], |row| {
            row.get::<_, String>(0)
        }) {
            for r in iter.flatten() {
                results.push(r);
            }
        }
    }
    results
}

pub fn get_note_stats(conn: &Connection, file_path: &str) -> Option<NoteStats> {
    conn.query_row(
        "SELECT LENGTH(content) - LENGTH(REPLACE(content, ' ', '')) + 1, LENGTH(content) FROM notes_fts WHERE title = ?1",
        params![file_path],
        |row| {
            Ok(NoteStats {
                word_count: row.get(0)?,
                char_count: row.get(1)?,
            })
        },
    ).ok()
}
