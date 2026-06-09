use crate::db;
use crate::state::AppState;
use crate::vault;
use std::fs;
use tauri::State;

#[tauri::command]
pub fn search_query(state: State<AppState>, query: String) -> Result<Vec<vault::SearchResult>, String> {
    let vault_path = state.vault_path.lock().map_err(|e| e.to_string())?;
    let vp = match vault_path.as_ref() {
        Some(p) => p.clone(),
        None => return Ok(Vec::new()),
    };

    if query.trim().is_empty() {
        return Ok(Vec::new());
    }

    // Try FTS first
    let db = state.db.lock().map_err(|e| e.to_string())?;
    if let Some(ref conn) = *db {
        let results = db::search_notes_fts(conn, &query);
        if !results.is_empty() {
            return Ok(results.into_iter().enumerate().map(|(i, (_rowid, title, snippet))| {
                vault::SearchResult {
                    path: title.clone(),
                    title,
                    snippet,
                    rank: i as i64,
                }
            }).collect());
        }
    }

    // Fallback: file content scan
    let lower_query = query.to_lowercase();
    let mut results = Vec::new();
    scan_dir_for_search(&vp, &lower_query, &mut results);
    results.sort_by(|a, b| a.rank.cmp(&b.rank));
    results.truncate(20);
    Ok(results)
}

#[tauri::command]
pub fn search_reindex(state: State<AppState>) -> Result<(), String> {
    let vault_path = state.vault_path.lock().map_err(|e| e.to_string())?;
    let vp = match vault_path.as_ref() {
        Some(p) => p.clone(),
        None => return Ok(()),
    };

    let db = state.db.lock().map_err(|e| e.to_string())?;
    if let Some(ref conn) = *db {
        // Walk all .md files and update FTS
        use walkdir::WalkDir;
        for entry in WalkDir::new(&vp).into_iter().filter_map(|e| e.ok()) {
            let path = entry.path();
            if path.is_file() && path.extension().and_then(|e| e.to_str()) == Some("md") {
                if let Ok(rel) = path.strip_prefix(&vp) {
                    let rel = rel.to_string_lossy().replace('\\', "/");
                    if let Ok(content) = fs::read_to_string(path) {
                        let title = vault::get_title(&rel, &content);
                        db::update_fts_index(conn, &rel, &title, &content);
                    }
                }
            }
        }
    }

    Ok(())
}

fn scan_dir_for_search(vault_root: &str, lower_query: &str, results: &mut Vec<vault::SearchResult>) {
    use walkdir::WalkDir;
    let mut idx = 0i64;

    for entry in WalkDir::new(vault_root).into_iter().filter_map(|e| e.ok()) {
        let path = entry.path();
        if path.is_file() && path.extension().and_then(|e| e.to_str()) == Some("md") {
            if let Ok(rel) = path.strip_prefix(vault_root) {
                let rel = rel.to_string_lossy().replace('\\', "/");
                if let Ok(content) = fs::read_to_string(path) {
                    let lower_content = content.to_lowercase();
                    if let Some(pos) = lower_content.find(lower_query) {
                        let title = vault::get_title(&rel, &content);

                        let start = if pos >= 40 { pos - 40 } else { 0 };
                        let end = std::cmp::min(content.len(), pos + lower_query.len() + 40);
                        let mut snippet = content[start..end].to_string();
                        if start > 0 { snippet.insert_str(0, "..."); }
                        if end < content.len() { snippet.push_str("..."); }
                        let snippet = snippet.replace('\n', " ");

                        results.push(vault::SearchResult {
                            path: rel,
                            title,
                            snippet,
                            rank: idx,
                        });
                        idx += 1;
                    }
                }
            }
        }
    }
}
