use crate::state::AppState;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::State;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TodoItem {
    pub id: i64,
    pub note_path: String,
    pub content: String,
    pub completed: bool,
    pub line_number: i64,
    pub created_at: String,
    pub completed_at: Option<String>,
    pub priority: i64,
    pub deadline: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TodoPageItem {
    pub id: String,
    pub content: String,
    pub completed: bool,
    pub section: String,
    pub created_date: String,
    pub created_at: String,
}

// ── Helpers ──

fn hash_id(note_path: &str, line: i64) -> i64 {
    let s = format!("{}:{}", note_path, line);
    let mut h: i64 = 0;
    for b in s.bytes() {
        h = h.wrapping_mul(31).wrapping_add(b as i64);
    }
    h.abs()
}

fn extract_todos_from_file(vault_root: &str, file_path: &str) -> Vec<TodoItem> {
    let full_path = PathBuf::from(vault_root).join(file_path);
    if !full_path.exists() {
        return Vec::new();
    }

    let content = match fs::read_to_string(&full_path) {
        Ok(c) => c,
        Err(_) => return Vec::new(),
    };
    let lines: Vec<&str> = content.lines().collect();
    let mut items = Vec::new();

    for (i, line) in lines.iter().enumerate() {
        let trimmed = line.trim();
        // Match markdown todo: - [ ] or - [x] or - [X]
        if let Some(rest) = trimmed.strip_prefix("- [ ]").or_else(|| trimmed.strip_prefix("* [ ]")).or_else(|| trimmed.strip_prefix("+ [ ]")) {
            let content = rest.trim().to_string();
            let mut deadline = None;
            let mut cleaned = content.clone();
            if let Some(ddl) = extract_deadline(&content) {
                deadline = Some(ddl);
                cleaned = remove_deadline(&content);
            }
            items.push(TodoItem {
                id: hash_id(file_path, (i + 1) as i64),
                note_path: file_path.to_string(),
                content: cleaned,
                completed: false,
                line_number: (i + 1) as i64,
                created_at: String::new(),
                completed_at: None,
                priority: 0,
                deadline,
            });
        } else if let Some(rest) = trimmed.strip_prefix("- [x]").or_else(|| trimmed.strip_prefix("* [x]")).or_else(|| trimmed.strip_prefix("+ [x]"))
            .or_else(|| trimmed.strip_prefix("- [X]")).or_else(|| trimmed.strip_prefix("* [X]")).or_else(|| trimmed.strip_prefix("+ [X]"))
        {
            let content = rest.trim().to_string();
            let mut deadline = None;
            let mut cleaned = content.clone();
            if let Some(ddl) = extract_deadline(&content) {
                deadline = Some(ddl);
                cleaned = remove_deadline(&content);
            }
            items.push(TodoItem {
                id: hash_id(file_path, (i + 1) as i64),
                note_path: file_path.to_string(),
                content: cleaned,
                completed: true,
                line_number: (i + 1) as i64,
                created_at: String::new(),
                completed_at: Some(String::new()),
                priority: 0,
                deadline,
            });
        }
    }

    items
}

fn extract_deadline(content: &str) -> Option<String> {
    let re = regex::Regex::new(r"📅(\d{4}-\d{2}-\d{2})").unwrap();
    re.captures(content)
        .and_then(|c| c.get(1))
        .map(|m| m.as_str().to_string())
}

fn remove_deadline(content: &str) -> String {
    let re = regex::Regex::new(r"\s*📅\d{4}-\d{2}-\d{2}").unwrap();
    re.replace(content, "").to_string()
}

fn walk_vault_and_collect(vault_root: &str, filter: Option<bool>) -> Vec<TodoItem> {
    use walkdir::WalkDir;
    let mut all = Vec::new();

    for entry in WalkDir::new(vault_root).into_iter().filter_map(|e| e.ok()) {
        let path = entry.path();
        if path.is_file() && path.extension().and_then(|e| e.to_str()) == Some("md") {
            if let Ok(rel) = path.strip_prefix(vault_root) {
                let rel = rel.to_string_lossy().replace('\\', "/");
                let todos = extract_todos_from_file(vault_root, &rel);
                for t in todos {
                    if let Some(completed_filter) = filter {
                        if t.completed != completed_filter {
                            continue;
                        }
                    }
                    all.push(t);
                }
            }
        }
    }

    all
}

fn find_todo(vault_root: &str, id: i64) -> Option<(String, i64)> {
    use walkdir::WalkDir;
    for entry in WalkDir::new(vault_root).into_iter().filter_map(|e| e.ok()) {
        let path = entry.path();
        if path.is_file() && path.extension().and_then(|e| e.to_str()) == Some("md") {
            if let Ok(rel) = path.strip_prefix(vault_root) {
                let rel = rel.to_string_lossy().replace('\\', "/");
                let todos = extract_todos_from_file(vault_root, &rel);
                if let Some(t) = todos.iter().find(|t| t.id == id) {
                    return Some((t.note_path.clone(), t.line_number));
                }
            }
        }
    }
    None
}

// ── Todo Page JSON storage ──

const TODO_PAGE_FILE: &str = ".mynote-todos.json";

pub(crate) fn read_todo_page(vault_root: &str) -> Vec<TodoPageItem> {
    let file_path = PathBuf::from(vault_root).join(TODO_PAGE_FILE);
    if !file_path.exists() {
        return Vec::new();
    }
    fs::read_to_string(&file_path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

pub(crate) fn write_todo_page(vault_root: &str, items: &[TodoPageItem]) {
    let file_path = PathBuf::from(vault_root).join(TODO_PAGE_FILE);
    if let Ok(json) = serde_json::to_string_pretty(items) {
        let _ = fs::write(file_path, json);
    }
}

// ── Commands ──

#[tauri::command]
pub fn todos_list(state: State<AppState>, filter: Option<serde_json::Value>) -> Result<Vec<TodoItem>, String> {
    let vault_path = state.vault_path.lock().map_err(|e| e.to_string())?;
    let vp = match vault_path.as_ref() {
        Some(p) => p.clone(),
        None => return Ok(Vec::new()),
    };

    let completed_filter = filter
        .as_ref()
        .and_then(|f| f.get("completed"))
        .and_then(|c| c.as_bool());

    Ok(walk_vault_and_collect(&vp, completed_filter))
}

#[tauri::command]
pub fn todos_toggle(state: State<AppState>, todo_id: i64) -> Result<(), String> {
    let vault_path = state.vault_path.lock().map_err(|e| e.to_string())?;
    let vp = match vault_path.as_ref() {
        Some(p) => p.clone(),
        None => return Ok(()),
    };

    let found = match find_todo(&vp, todo_id) {
        Some(f) => f,
        None => return Ok(()),
    };

    let full_path = PathBuf::from(&vp).join(&found.0);
    if !full_path.exists() { return Ok(()); }

    let content = fs::read_to_string(&full_path).map_err(|e| e.to_string())?;
    let mut lines: Vec<String> = content.lines().map(|s| s.to_string()).collect();
    let idx = (found.1 - 1) as usize;
    if idx >= lines.len() { return Ok(()); }

    if lines[idx].contains("[ ]") {
        lines[idx] = lines[idx].replace("[ ]", "[x]");
    } else if lines[idx].contains("[x]") || lines[idx].contains("[X]") {
        lines[idx] = lines[idx].replace("[x]", "[ ]").replace("[X]", "[ ]");
    }

    fs::write(&full_path, lines.join("\n")).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn todos_add(state: State<AppState>, note_path: String, content: String, deadline: Option<String>) -> Result<TodoItem, String> {
    let vault_path = state.vault_path.lock().map_err(|e| e.to_string())?;
    let vp = match vault_path.as_ref() {
        Some(p) => p.clone(),
        None => return Err("Vault not initialized".into()),
    };

    let full_path = PathBuf::from(&vp).join(&note_path);
    if !full_path.exists() {
        return Err("Note not found".into());
    }

    let mut line = format!("- [ ] {}", content);
    if let Some(ref ddl) = deadline {
        line.push_str(&format!(" 📅{}", ddl));
    }

    let file_content = fs::read_to_string(&full_path).map_err(|e| e.to_string())?;
    let new_content = if file_content.ends_with('\n') {
        format!("{}{}\n", file_content, line)
    } else {
        format!("{}\n{}\n", file_content, line)
    };
    fs::write(&full_path, new_content).map_err(|e| e.to_string())?;

    let todos = extract_todos_from_file(&vp, &note_path);
    todos.last().cloned().ok_or_else(|| "Failed to create todo".into())
}

#[tauri::command]
pub fn todos_delete(state: State<AppState>, todo_id: i64) -> Result<(), String> {
    let vault_path = state.vault_path.lock().map_err(|e| e.to_string())?;
    let vp = match vault_path.as_ref() {
        Some(p) => p.clone(),
        None => return Ok(()),
    };

    let found = match find_todo(&vp, todo_id) {
        Some(f) => f,
        None => return Err("Todo not found".into()),
    };

    let full_path = PathBuf::from(&vp).join(&found.0);
    if !full_path.exists() { return Ok(()); }

    let content = fs::read_to_string(&full_path).map_err(|e| e.to_string())?;
    let mut lines: Vec<String> = content.lines().map(|s| s.to_string()).collect();
    let idx = (found.1 - 1) as usize;
    if idx < lines.len() {
        lines.remove(idx);
        fs::write(&full_path, lines.join("\n")).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn todos_update_deadline(state: State<AppState>, todo_id: i64, deadline: Option<String>) -> Result<(), String> {
    let vault_path = state.vault_path.lock().map_err(|e| e.to_string())?;
    let vp = match vault_path.as_ref() {
        Some(p) => p.clone(),
        None => return Ok(()),
    };

    let found = match find_todo(&vp, todo_id) {
        Some(f) => f,
        None => return Ok(()),
    };

    let full_path = PathBuf::from(&vp).join(&found.0);
    if !full_path.exists() { return Ok(()); }

    let content = fs::read_to_string(&full_path).map_err(|e| e.to_string())?;
    let mut lines: Vec<String> = content.lines().map(|s| s.to_string()).collect();
    let idx = (found.1 - 1) as usize;
    if idx >= lines.len() { return Ok(()); }

    let mut cleaned = remove_deadline(&lines[idx]);
    if let Some(ref ddl) = deadline {
        cleaned = format!("{} 📅{}", cleaned.trim_end(), ddl);
    }
    lines[idx] = cleaned;

    fs::write(&full_path, lines.join("\n")).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn todos_sync_all() -> Result<(), String> {
    // No-op: file-based system
    Ok(())
}

#[tauri::command]
pub fn todos_extract() -> Result<(), String> {
    // No-op: file-based system
    Ok(())
}

// ── Todo Page Commands ──

#[tauri::command]
pub fn todo_page_list(state: State<AppState>) -> Result<Vec<TodoPageItem>, String> {
    let vault_path = state.vault_path.lock().map_err(|e| e.to_string())?;
    let vp = match vault_path.as_ref() {
        Some(p) => p.clone(),
        None => return Ok(Vec::new()),
    };
    Ok(read_todo_page(&vp))
}

#[tauri::command]
pub fn todo_page_add(state: State<AppState>, content: String, section: String) -> Result<TodoPageItem, String> {
    let vault_path = state.vault_path.lock().map_err(|e| e.to_string())?;
    let vp = match vault_path.as_ref() {
        Some(p) => p.clone(),
        None => return Err("Vault not initialized".into()),
    };

    let mut items = read_todo_page(&vp);
    let now = chrono::Local::now();
    let today = now.format("%Y-%m-%d").to_string();
    let item = TodoPageItem {
        id: uuid::Uuid::new_v4().to_string(),
        content,
        completed: false,
        section: section.clone(),
        created_date: today.clone(),
        created_at: now.to_rfc3339(),
    };
    items.push(item.clone());
    write_todo_page(&vp, &items);
    Ok(item)
}

#[tauri::command]
pub fn todo_page_delete(state: State<AppState>, id: String) -> Result<(), String> {
    let vault_path = state.vault_path.lock().map_err(|e| e.to_string())?;
    let vp = match vault_path.as_ref() {
        Some(p) => p.clone(),
        None => return Ok(()),
    };
    let items = read_todo_page(&vp);
    let filtered: Vec<TodoPageItem> = items.into_iter().filter(|t| t.id != id).collect();
    write_todo_page(&vp, &filtered);
    Ok(())
}

#[tauri::command]
pub fn todo_page_toggle(state: State<AppState>, id: String) -> Result<(), String> {
    let vault_path = state.vault_path.lock().map_err(|e| e.to_string())?;
    let vp = match vault_path.as_ref() {
        Some(p) => p.clone(),
        None => return Ok(()),
    };
    let mut items = read_todo_page(&vp);
    if let Some(item) = items.iter_mut().find(|t| t.id == id) {
        item.completed = !item.completed;
        write_todo_page(&vp, &items);
    }
    Ok(())
}

// ── DDL (Deadline) JSON storage ──

const DDL_FILE: &str = ".mynote-ddls.json";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DdlItem {
    pub id: String,
    pub content: String,
    pub deadline: String,
    pub created_at: String,
}

fn read_ddls(vault_root: &str) -> Vec<DdlItem> {
    let file_path = PathBuf::from(vault_root).join(DDL_FILE);
    if !file_path.exists() {
        return Vec::new();
    }
    fs::read_to_string(&file_path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn write_ddls(vault_root: &str, items: &[DdlItem]) {
    let file_path = PathBuf::from(vault_root).join(DDL_FILE);
    if let Ok(json) = serde_json::to_string_pretty(items) {
        let _ = fs::write(file_path, json);
    }
}

#[tauri::command]
pub fn ddl_list(state: State<AppState>) -> Result<Vec<DdlItem>, String> {
    let vault_path = state.vault_path.lock().map_err(|e| e.to_string())?;
    let vp = match vault_path.as_ref() {
        Some(p) => p.clone(),
        None => return Ok(Vec::new()),
    };
    Ok(read_ddls(&vp))
}

#[tauri::command]
pub fn ddl_add(state: State<AppState>, content: String, deadline: String) -> Result<DdlItem, String> {
    let vault_path = state.vault_path.lock().map_err(|e| e.to_string())?;
    let vp = match vault_path.as_ref() {
        Some(p) => p.clone(),
        None => return Err("Vault not initialized".into()),
    };
    let mut items = read_ddls(&vp);
    let item = DdlItem {
        id: uuid::Uuid::new_v4().to_string(),
        content,
        deadline,
        created_at: chrono::Utc::now().to_rfc3339(),
    };
    items.push(item.clone());
    write_ddls(&vp, &items);
    Ok(item)
}

#[tauri::command]
pub fn ddl_delete(state: State<AppState>, id: String) -> Result<(), String> {
    let vault_path = state.vault_path.lock().map_err(|e| e.to_string())?;
    let vp = match vault_path.as_ref() {
        Some(p) => p.clone(),
        None => return Ok(()),
    };
    let items = read_ddls(&vp);
    let filtered: Vec<DdlItem> = items.into_iter().filter(|t| t.id != id).collect();
    write_ddls(&vp, &filtered);
    Ok(())
}
