use crate::db;
use crate::state::AppState;
use crate::vault;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::State;

#[derive(Debug, Serialize, Deserialize)]
pub struct NoteWriteRequest {
    pub path: String,
    pub content: String,
}

// ── notes_list ──

#[tauri::command]
pub fn notes_list(state: State<AppState>) -> Result<Vec<vault::NoteMeta>, String> {
    let vault_path = state.vault_path.lock().map_err(|e| e.to_string())?;
    let vp = match vault_path.as_ref() {
        Some(p) => p.clone(),
        None => return Ok(Vec::new()),
    };
    let db = state.db.lock().map_err(|e| e.to_string())?;

    // Sync vault → DB first
    if let Some(ref conn) = *db {
        sync_vault_to_db(&vp, conn);
    }

    // Try DB first
    if let Some(ref conn) = *db {
        let notes = db::get_all_notes(conn);
        if !notes.is_empty() {
            return Ok(notes.iter().filter(|n| !is_hidden_dir(&n.path)).map(|n| vault::NoteMeta {
                id: n.id,
                path: n.path.clone(),
                title: n.title.clone(),
                created_at: n.created_at.clone(),
                updated_at: n.updated_at.clone(),
                tags: serde_json::from_str(&n.tags).unwrap_or_default(),
                is_diary: n.is_diary != 0,
                diary_date: n.diary_date.clone(),
                archived: n.archived != 0,
                pinned: n.pinned != 0,
            }).collect());
        }
    }

    // Fallback: file system scan
    collect_notes_fs(&vp)
}

// ── notes_read ──

#[tauri::command]
pub fn notes_read(state: State<AppState>, path: String) -> Result<Option<vault::NoteContent>, String> {
    let vault_path = state.vault_path.lock().map_err(|e| e.to_string())?;
    let vp = match vault_path.as_ref() {
        Some(p) => p.clone(),
        None => return Err("Vault not initialized".into()),
    };
    let full_path = PathBuf::from(&vp).join(&path);

    if !full_path.exists() {
        // Try to clean up DB
        let db = state.db.lock().map_err(|e| e.to_string())?;
        if let Some(ref conn) = *db {
            let _ = db::delete_note_by_path(conn, &path);
        }
        return Ok(None);
    }

    let content = fs::read_to_string(&full_path).map_err(|e| e.to_string())?;
    let stat = fs::metadata(&full_path).map_err(|e| e.to_string())?;

    let db = state.db.lock().map_err(|e| e.to_string())?;
    let meta = if let Some(ref conn) = *db {
        if let Some(db_note) = db::get_note_by_path(conn, &path) {
            vault::NoteMeta {
                id: db_note.id,
                path: db_note.path.clone(),
                title: db_note.title.clone(),
                created_at: db_note.created_at.clone(),
                updated_at: db_note.updated_at.clone(),
                tags: serde_json::from_str(&db_note.tags).unwrap_or_default(),
                is_diary: db_note.is_diary != 0,
                diary_date: db_note.diary_date.clone(),
                archived: db_note.archived != 0,
                pinned: db_note.pinned != 0,
            }
        } else {
            build_meta_fs(&path, &content, &stat)?
        }
    } else {
        build_meta_fs(&path, &content, &stat)?
    };

    Ok(Some(vault::NoteContent { meta, content }))
}

// ── notes_write ──

#[tauri::command]
pub fn notes_write(state: State<AppState>, request: NoteWriteRequest) -> Result<(), String> {
    let vault_path = state.vault_path.lock().map_err(|e| e.to_string())?;
    let vp = match vault_path.as_ref() {
        Some(p) => p.clone(),
        None => return Err("Vault not initialized".into()),
    };
    let full_path = PathBuf::from(&vp).join(&request.path);

    // Ensure parent dir exists
    if let Some(parent) = full_path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    fs::write(&full_path, &request.content).map_err(|e| e.to_string())?;

    // Sync to DB
    let db = state.db.lock().map_err(|e| e.to_string())?;
    if let Some(ref conn) = *db {
        sync_note_to_db(conn, &request.path, &request.content, &vp);
    }

    Ok(())
}

// ── notes_create ──

#[tauri::command]
pub fn notes_create(state: State<AppState>, folder_path: String, title: String) -> Result<vault::NoteMeta, String> {
    let vault_path = state.vault_path.lock().map_err(|e| e.to_string())?;
    let vp = match vault_path.as_ref() {
        Some(p) => p.clone(),
        None => return Err("Vault not initialized".into()),
    };

    let file_name = vault::normalize_note_file_name(&title);
    let file_path = if folder_path.is_empty() {
        file_name.clone()
    } else {
        format!("{}/{}", folder_path, file_name)
    };

    let full_path = PathBuf::from(&vp).join(&file_path);
    if full_path.exists() {
        return Err(format!("Note already exists: {}", file_path));
    }

    if let Some(parent) = full_path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    let note_title = Path::new(&file_name).file_stem().and_then(|s| s.to_str()).unwrap_or("Untitled");
    let template = format!("# {}\n\n", note_title);
    fs::write(&full_path, &template).map_err(|e| e.to_string())?;

    let now = chrono::Utc::now().to_rfc3339();
    let db = state.db.lock().map_err(|e| e.to_string())?;
    if let Some(ref conn) = *db {
        sync_note_to_db(conn, &file_path, &template, &vp);
    }

    Ok(vault::NoteMeta {
        id: 0,
        path: file_path,
        title: note_title.to_string(),
        created_at: now.clone(),
        updated_at: now,
        tags: Vec::new(),
        is_diary: false,
        diary_date: None,
        archived: false,
        pinned: false,
    })
}

// ── notes_delete ──

#[tauri::command]
pub fn notes_delete(state: State<AppState>, path: String) -> Result<(), String> {
    let vault_path = state.vault_path.lock().map_err(|e| e.to_string())?;
    let vp = match vault_path.as_ref() {
        Some(p) => p.clone(),
        None => return Err("Vault not initialized".into()),
    };
    let full_path = PathBuf::from(&vp).join(&path);
    if full_path.exists() {
        fs::remove_file(&full_path).map_err(|e| e.to_string())?;
    }

    let db = state.db.lock().map_err(|e| e.to_string())?;
    if let Some(ref conn) = *db {
        let _ = db::delete_note_by_path(conn, &path);
    }

    Ok(())
}

// ── notes_rename ──

#[tauri::command]
pub fn notes_rename(state: State<AppState>, old_path: String, new_path: String) -> Result<String, String> {
    let vault_path = state.vault_path.lock().map_err(|e| e.to_string())?;
    let vp = match vault_path.as_ref() {
        Some(p) => p.clone(),
        None => return Err("Vault not initialized".into()),
    };

    let normalized = vault::normalize_note_path(&new_path);
    let old_full = PathBuf::from(&vp).join(&old_path);
    let new_full = PathBuf::from(&vp).join(&normalized);

    if old_full.exists() {
        if new_full.exists() && old_full != new_full {
            return Err(format!("Target already exists: {}", normalized));
        }
        if let Some(parent) = new_full.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        if old_full != new_full {
            fs::rename(&old_full, &new_full).map_err(|e| e.to_string())?;
        }

        let content = fs::read_to_string(&new_full).map_err(|e| e.to_string())?;
        let db = state.db.lock().map_err(|e| e.to_string())?;
        if let Some(ref conn) = *db {
            sync_note_to_db(conn, &normalized, &content, &vp);
            if old_path != normalized {
                let _ = db::delete_note_by_path(conn, &old_path);
            }
        }
    }

    Ok(normalized)
}

// ── notes_recent ──

#[tauri::command]
pub fn notes_recent(state: State<AppState>) -> Result<Vec<vault::NoteMeta>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    if let Some(ref conn) = *db {
        let notes = db::get_recent_notes(conn, 6);
        if !notes.is_empty() {
            return Ok(notes.iter().filter(|n| !is_hidden_dir(&n.path)).map(|n| vault::NoteMeta {
                id: n.id,
                path: n.path.clone(),
                title: n.title.clone(),
                created_at: n.created_at.clone(),
                updated_at: n.updated_at.clone(),
                tags: serde_json::from_str(&n.tags).unwrap_or_default(),
                is_diary: n.is_diary != 0,
                diary_date: n.diary_date.clone(),
                archived: n.archived != 0,
                pinned: n.pinned != 0,
            }).collect());
        }
    }

    // Fallback: file system
    let vault_path = state.vault_path.lock().map_err(|e| e.to_string())?;
    let vp = match vault_path.as_ref() {
        Some(p) => p.clone(),
        None => return Ok(Vec::new()),
    };

    let mut notes = collect_notes_fs(&vp)?;
    notes.retain(|n| !n.is_diary);
    notes.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    notes.truncate(6);
    Ok(notes)
}

// ── notes_tags ──

#[tauri::command]
pub fn notes_tags(state: State<AppState>) -> Result<Vec<String>, String> {
    let vault_path = state.vault_path.lock().map_err(|e| e.to_string())?;
    let vp = match vault_path.as_ref() {
        Some(p) => p.clone(),
        None => return Ok(Vec::new()),
    };

    let mut tag_set = std::collections::BTreeSet::new();

    // Try DB first
    let db = state.db.lock().map_err(|e| e.to_string())?;
    if let Some(ref conn) = *db {
        let notes = db::get_all_notes(conn);
        if !notes.is_empty() {
            for note in notes {
                if note.is_diary != 0 || is_hidden_dir(&note.path) { continue; }
                if let Ok(tags) = serde_json::from_str::<Vec<String>>(&note.tags) {
                    for t in tags { tag_set.insert(t); }
                }
            }
            if !tag_set.is_empty() {
                return Ok(tag_set.into_iter().collect());
            }
        }
    }

    // Fallback: scan filesystem
    scan_tags_fs(&vp, &mut tag_set);
    Ok(tag_set.into_iter().collect())
}

// ── notes_by_tag ──

#[tauri::command]
pub fn notes_by_tag(state: State<AppState>, tag: String) -> Result<Vec<vault::NoteMeta>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    if let Some(ref conn) = *db {
        let notes = db::get_all_notes(conn);
        return Ok(notes.iter()
            .filter(|n| {
                if is_hidden_dir(&n.path) { return false; }
                let tags: Vec<String> = serde_json::from_str(&n.tags).unwrap_or_default();
                tags.contains(&tag)
            })
            .map(|n| vault::NoteMeta {
                id: n.id,
                path: n.path.clone(),
                title: n.title.clone(),
                created_at: n.created_at.clone(),
                updated_at: n.updated_at.clone(),
                tags: serde_json::from_str(&n.tags).unwrap_or_default(),
                is_diary: n.is_diary != 0,
                diary_date: n.diary_date.clone(),
                archived: n.archived != 0,
                pinned: n.pinned != 0,
            })
            .collect());
    }
    Ok(Vec::new())
}

// ── Archive & Pin ──

#[tauri::command]
pub fn notes_set_archived(state: State<AppState>, file_path: String, archived: bool) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    if let Some(ref conn) = *db {
        db::set_note_archived(conn, &file_path, archived).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn notes_set_pinned(state: State<AppState>, file_path: String, pinned: bool) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    if let Some(ref conn) = *db {
        db::set_note_pinned(conn, &file_path, pinned).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn notes_batch_archive(state: State<AppState>, file_paths: Vec<String>, archived: bool) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    if let Some(ref conn) = *db {
        db::batch_archive_notes(conn, &file_paths, archived).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn notes_batch_delete(state: State<AppState>, file_paths: Vec<String>) -> Result<(), String> {
    let vault_path = state.vault_path.lock().map_err(|e| e.to_string())?;
    let vp = match vault_path.as_ref() {
        Some(p) => p.clone(),
        None => return Err("Vault not initialized".into()),
    };

    // Delete files from disk
    for fp in &file_paths {
        let full_path = PathBuf::from(&vp).join(fp);
        if full_path.exists() {
            let _ = fs::remove_file(&full_path);
        }
    }

    // Delete from DB
    let db = state.db.lock().map_err(|e| e.to_string())?;
    if let Some(ref conn) = *db {
        db::batch_delete_notes(conn, &file_paths).map_err(|e| e.to_string())?;
    }

    Ok(())
}

#[tauri::command]
pub fn notes_batch_tag(state: State<AppState>, file_paths: Vec<String>, tag: String) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    if let Some(ref conn) = *db {
        db::batch_add_tag(conn, &file_paths, &tag).map_err(|e| e.to_string())?;
    }
    Ok(())
}

// ── Tag Management ──

#[tauri::command]
pub fn tags_rename(state: State<AppState>, old_name: String, new_name: String) -> Result<Vec<String>, String> {
    let vault_path = state.vault_path.lock().map_err(|e| e.to_string())?;
    let vp = match vault_path.as_ref() {
        Some(p) => p.clone(),
        None => return Ok(Vec::new()),
    };

    let db = state.db.lock().map_err(|e| e.to_string())?;
    if let Some(ref conn) = *db {
        let notes = db::get_all_notes(conn);
        for note in notes {
            let tags: Vec<String> = serde_json::from_str(&note.tags).unwrap_or_default();
            if !tags.contains(&old_name) { continue; }

            let full_path = PathBuf::from(&vp).join(&note.path);
            if !full_path.exists() { continue; }

            let content = fs::read_to_string(&full_path).unwrap_or_default();
            let new_content = vault::replace_tag_in_content(&content, &old_name, &new_name);
            let _ = fs::write(&full_path, &new_content);
        }
        let _ = db::rename_tag_in_notes(conn, &old_name, &new_name);
    }

    // Return all tags
    let mut tag_set = std::collections::BTreeSet::new();
    scan_tags_fs(&vp, &mut tag_set);
    Ok(tag_set.into_iter().collect())
}

#[tauri::command]
pub fn tags_delete(state: State<AppState>, tag_name: String) -> Result<Vec<String>, String> {
    let vault_path = state.vault_path.lock().map_err(|e| e.to_string())?;
    let vp = match vault_path.as_ref() {
        Some(p) => p.clone(),
        None => return Ok(Vec::new()),
    };

    let db = state.db.lock().map_err(|e| e.to_string())?;
    if let Some(ref conn) = *db {
        let notes = db::get_all_notes(conn);
        for note in notes {
            let tags: Vec<String> = serde_json::from_str(&note.tags).unwrap_or_default();
            if !tags.contains(&tag_name) { continue; }

            let full_path = PathBuf::from(&vp).join(&note.path);
            if !full_path.exists() { continue; }

            let content = fs::read_to_string(&full_path).unwrap_or_default();
            let new_content = vault::remove_tag_from_content(&content, &tag_name);
            let _ = fs::write(&full_path, &new_content);
        }
        let _ = db::delete_tag_from_notes(conn, &tag_name);
    }

    let mut tag_set = std::collections::BTreeSet::new();
    scan_tags_fs(&vp, &mut tag_set);
    Ok(tag_set.into_iter().collect())
}

// ── Links & Backlinks ──

#[tauri::command]
pub fn notes_update_links(state: State<AppState>, file_path: String, links: Vec<(String, String)>) -> Result<(), String> {
    let vault_path = state.vault_path.lock().map_err(|e| e.to_string())?;
    let vp = match vault_path.as_ref() {
        Some(p) => p.clone(),
        None => return Err("Vault not initialized".into()),
    };

    // Resolve wikilink targets
    let all_paths = vault::collect_all_paths(Path::new(&vp));
    let resolved = vault::resolve_wikilink_targets(&links, &all_paths);

    let db = state.db.lock().map_err(|e| e.to_string())?;
    if let Some(ref conn) = *db {
        db::update_links_for_note(conn, &file_path, &resolved).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn notes_backlinks(state: State<AppState>, note_path: String) -> Result<Vec<db::Backlink>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    if let Some(ref conn) = *db {
        return Ok(db::get_backlinks(conn, &note_path));
    }
    Ok(Vec::new())
}

#[tauri::command]
pub fn notes_forward_links(state: State<AppState>, note_path: String) -> Result<Vec<String>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    if let Some(ref conn) = *db {
        return Ok(db::get_forward_links(conn, &note_path));
    }
    Ok(Vec::new())
}

#[tauri::command]
pub fn notes_stats(state: State<AppState>, file_path: String) -> Result<Option<db::NoteStats>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    if let Some(ref conn) = *db {
        return Ok(db::get_note_stats(conn, &file_path));
    }
    Ok(None)
}

// ── Helpers ──

fn is_hidden_dir(rel_path: &str) -> bool {
    rel_path == "assets" || rel_path.starts_with("assets/")
}

fn build_meta_fs(file_path: &str, content: &str, stat: &fs::Metadata) -> Result<vault::NoteMeta, String> {
    let created = stat.created().map(|t| {
        chrono::DateTime::<chrono::Utc>::from(t).format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string()
    }).unwrap_or_default();
    let modified = stat.modified().map(|t| {
        chrono::DateTime::<chrono::Utc>::from(t).format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string()
    }).unwrap_or_default();

    Ok(vault::NoteMeta {
        id: 0,
        path: file_path.to_string(),
        title: vault::get_title(file_path, content),
        created_at: created,
        updated_at: modified,
        tags: vault::extract_tags(content),
        is_diary: file_path.starts_with("diary/"),
        diary_date: vault::extract_diary_date(file_path),
        archived: false,
        pinned: false,
    })
}

fn sync_note_to_db(conn: &rusqlite::Connection, file_path: &str, content: &str, vault_root: &str) {
    let full_path = PathBuf::from(vault_root).join(file_path);
    let (created, modified) = match fs::metadata(&full_path) {
        Ok(meta) => (
            meta.created().map(|t| chrono::DateTime::<chrono::Utc>::from(t).format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string()).unwrap_or_default(),
            meta.modified().map(|t| chrono::DateTime::<chrono::Utc>::from(t).format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string()).unwrap_or_default(),
        ),
        Err(_) => {
            let now = chrono::Utc::now().to_rfc3339();
            (now.clone(), now)
        }
    };

    let tags = vault::extract_tags(content);
    let tags_json = serde_json::to_string(&tags).unwrap_or_else(|_| "[]".into());
    let title = vault::get_title(file_path, content);
    let is_diary = if file_path.starts_with("diary/") { 1 } else { 0 };
    let diary_date = vault::extract_diary_date(file_path);

    let _ = db::upsert_note(conn, &db::NoteRow {
        id: 0,
        path: file_path.to_string(),
        title,
        created_at: created,
        updated_at: modified,
        tags: tags_json,
        is_diary,
        diary_date,
        archived: 0,
        pinned: 0,
    });

    // Update FTS
    let content_for_fts = fs::read_to_string(&full_path).unwrap_or_default();
    db::update_fts_index(
        conn,
        file_path,
        &vault::get_title(file_path, &content_for_fts),
        &content_for_fts,
    );

    // Extract and store wikilinks
    let raw_links = vault::extract_wikilinks(content);
    let all_paths = vault::collect_all_paths(Path::new(vault_root));
    let resolved = vault::resolve_wikilink_targets(&raw_links, &all_paths);
    let _ = db::update_links_for_note(conn, file_path, &resolved);
}

fn sync_vault_to_db(vault_root: &str, conn: &rusqlite::Connection) {
    use walkdir::WalkDir;
    let mut existing = std::collections::HashSet::new();

    for entry in WalkDir::new(vault_root).into_iter().filter_map(|e| e.ok()) {
        let path = entry.path();
        if path.is_file() && path.extension().and_then(|e| e.to_str()) == Some("md") {
            if let Ok(rel) = path.strip_prefix(vault_root) {
                let rel = rel.to_string_lossy().replace('\\', "/");
                if is_hidden_dir(&rel) { continue; }
                if let Ok(content) = fs::read_to_string(path) {
                    sync_note_to_db(conn, &rel, &content, vault_root);
                    existing.insert(rel);
                }
            }
        }
    }

    // Remove DB entries for deleted files
    for note in db::get_all_notes(conn) {
        if is_hidden_dir(&note.path) { continue; }
        if !existing.contains(&note.path) {
            let _ = db::delete_note_by_path(conn, &note.path);
        }
    }
}

fn collect_notes_fs(vault_root: &str) -> Result<Vec<vault::NoteMeta>, String> {
    use walkdir::WalkDir;
    let mut notes = Vec::new();
    for entry in WalkDir::new(vault_root).into_iter().filter_map(|e| e.ok()) {
        let path = entry.path();
        if path.is_file() && path.extension().and_then(|e| e.to_str()) == Some("md") {
            if let Ok(rel) = path.strip_prefix(vault_root) {
                let rel = rel.to_string_lossy().replace('\\', "/");
                if is_hidden_dir(&rel) { continue; }
                if let Ok(content) = fs::read_to_string(path) {
                    if let Ok(meta) = fs::metadata(path) {
                        if let Ok(note_meta) = build_meta_fs(&rel, &content, &meta) {
                            notes.push(note_meta);
                        }
                    }
                }
            }
        }
    }
    Ok(notes)
}

fn scan_tags_fs(vault_root: &str, tag_set: &mut std::collections::BTreeSet<String>) {
    use walkdir::WalkDir;
    for entry in WalkDir::new(vault_root).into_iter().filter_map(|e| e.ok()) {
        let path = entry.path();
        if path.is_file() && path.extension().and_then(|e| e.to_str()) == Some("md") {
            if let Ok(rel) = path.strip_prefix(vault_root) {
                let rel = rel.to_string_lossy().replace('\\', "/");
                if rel.starts_with("diary/") || is_hidden_dir(&rel) { continue; }
                if let Ok(content) = fs::read_to_string(path) {
                    for tag in vault::extract_tags(&content) {
                        tag_set.insert(tag);
                    }
                }
            }
        }
    }
}
