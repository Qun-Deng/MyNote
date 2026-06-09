use crate::db;
use crate::state::AppState;
use crate::vault;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{Emitter, State, Manager};
use tauri_plugin_dialog::DialogExt;

fn get_config_path(app: &tauri::AppHandle) -> PathBuf {
    app.path().app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .join("config.json")
}

fn load_config(app: &tauri::AppHandle) -> serde_json::Value {
    let config_path = get_config_path(app);
    if config_path.exists() {
        fs::read_to_string(&config_path)
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_else(|| serde_json::json!({}))
    } else {
        serde_json::json!({})
    }
}

fn save_config(app: &tauri::AppHandle, config: &serde_json::Value) {
    let config_path = get_config_path(app);
    if let Some(parent) = config_path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    let _ = fs::write(&config_path, serde_json::to_string_pretty(config).unwrap_or_default());
}

// ── vault_select ──

#[tauri::command]
pub async fn vault_select(app: tauri::AppHandle, state: State<'_, AppState>) -> Result<Option<String>, String> {
    let result = app.dialog()
        .file()
        .add_filter("All Files", &["*"])
        .blocking_pick_folder();

    match result {
        Some(path) => {
            let p = path.to_string();
            let mut vault_path = state.vault_path.lock().map_err(|e| e.to_string())?;
            *vault_path = Some(p.clone());
            Ok(Some(p))
        }
        None => Ok(None),
    }
}

// ── vault_get_path ──

#[tauri::command]
pub fn vault_get_path(state: State<AppState>) -> Result<Option<String>, String> {
    let vault_path = state.vault_path.lock().map_err(|e| e.to_string())?;
    Ok(vault_path.clone())
}

// ── vault_get_saved_path ──

#[tauri::command]
pub fn vault_get_saved_path(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let config = load_config(&app);
    if let Some(vp) = config.get("vaultPath").and_then(|v| v.as_str()) {
        if Path::new(vp).exists() {
            return Ok(Some(vp.to_string()));
        }
    }
    Ok(None)
}

// ── vault_init ──

#[tauri::command]
pub fn vault_init(app: tauri::AppHandle, state: State<AppState>, new_vault_path: String) -> Result<(), String> {
    // Set vault path
    {
        let mut vault_path = state.vault_path.lock().map_err(|e| e.to_string())?;
        *vault_path = Some(new_vault_path.clone());
    }

    // Create directory structure
    let dirs = ["notes", "diary", "assets"];
    for dir in &dirs {
        let dir_path = PathBuf::from(&new_vault_path).join(dir);
        if !dir_path.exists() {
            fs::create_dir_all(&dir_path).map_err(|e| e.to_string())?;
        }
    }

    // Initialize SQLite database
    let db_path = PathBuf::from(&new_vault_path).join(".mynote.db");
    let db_path_str = db_path.to_string_lossy().to_string();

    match db::open_or_create_db(&db_path_str) {
        Ok(conn) => {
            let mut db = state.db.lock().map_err(|e| e.to_string())?;
            *db = Some(conn);
        }
        Err(err) => {
            eprintln!("[DB] Failed to open database: {}", err);
            // If existing DB was corrupted, remove and retry
            if db_path.exists() {
                let _ = fs::remove_file(&db_path);
            }
            match db::open_or_create_db(&db_path_str) {
                Ok(conn) => {
                    let mut db = state.db.lock().map_err(|e| e.to_string())?;
                    *db = Some(conn);
                }
                Err(e) => {
                    eprintln!("[DB] Failed to recreate database: {}", e);
                }
            }
        }
    }

    // Save config
    let config = serde_json::json!({ "vaultPath": &new_vault_path });
    save_config(&app, &config);

    // Start vault watcher
    start_vault_watcher(app.clone(), new_vault_path.clone());

    Ok(())
}

// ── vault_tree ──

#[tauri::command]
pub fn vault_tree(state: State<AppState>) -> Result<Vec<vault::FileTreeNode>, String> {
    let vault_path = state.vault_path.lock().map_err(|e| e.to_string())?;
    let vp = match vault_path.as_ref() {
        Some(p) => PathBuf::from(p),
        None => return Ok(Vec::new()),
    };
    Ok(vault::scan_directory(&vp, &vp))
}

// ── vault_move ──

#[tauri::command]
pub fn vault_move(state: State<AppState>, from: String, to: String) -> Result<(), String> {
    let vault_path = state.vault_path.lock().map_err(|e| e.to_string())?;
    let vp = match vault_path.as_ref() {
        Some(p) => p.clone(),
        None => return Err("Vault not initialized".into()),
    };

    let from_full = PathBuf::from(&vp).join(&from);
    let to_full = PathBuf::from(&vp).join(&to);

    if from_full.exists() {
        if let Some(parent) = to_full.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        fs::rename(&from_full, &to_full).map_err(|e| e.to_string())?;
    }

    Ok(())
}

// ── vault_create_folder ──

#[tauri::command]
pub fn vault_create_folder(state: State<AppState>, folder_path: String) -> Result<(), String> {
    let vault_path = state.vault_path.lock().map_err(|e| e.to_string())?;
    let vp = match vault_path.as_ref() {
        Some(p) => p.clone(),
        None => return Err("Vault not initialized".into()),
    };

    let full_path = PathBuf::from(&vp).join(&folder_path);
    if !full_path.exists() {
        fs::create_dir_all(&full_path).map_err(|e| e.to_string())?;
    }

    Ok(())
}

// ── vault_delete_item ──

#[tauri::command]
pub fn vault_delete_item(state: State<AppState>, item_path: String) -> Result<(), String> {
    let vault_path = state.vault_path.lock().map_err(|e| e.to_string())?;
    let vp = match vault_path.as_ref() {
        Some(p) => p.clone(),
        None => return Err("Vault not initialized".into()),
    };

    let full_path = PathBuf::from(&vp).join(&item_path);
    if full_path.exists() {
        if full_path.is_dir() {
            fs::remove_dir_all(&full_path).map_err(|e| e.to_string())?;
        } else {
            fs::remove_file(&full_path).map_err(|e| e.to_string())?;
        }
    }

    Ok(())
}

// ── vault_open_in_explorer ──

#[tauri::command]
pub fn vault_open_in_explorer(state: State<AppState>, item_path: String) -> Result<(), String> {
    let vault_path = state.vault_path.lock().map_err(|e| e.to_string())?;
    let vp = match vault_path.as_ref() {
        Some(p) => p.clone(),
        None => return Err("Vault not initialized".into()),
    };

    // Support both absolute paths (e.g. export output) and vault-relative paths
    let p = std::path::Path::new(&item_path);
    let full_path = if p.is_absolute() {
        p.to_path_buf()
    } else {
        PathBuf::from(&vp).join(&item_path)
    };

    #[cfg(target_os = "windows")]
    {
        // Normalize separators to backslashes for Explorer
        let path_str = full_path.to_string_lossy().replace('/', "\\");
        if full_path.is_dir() {
            std::process::Command::new("explorer")
                .arg(&*path_str)
                .spawn()
                .map_err(|e| e.to_string())?;
        } else {
            std::process::Command::new("explorer")
                .arg("/select,")
                .arg(&*path_str)
                .spawn()
                .map_err(|e| e.to_string())?;
        }
    }

    #[cfg(target_os = "macos")]
    {
        if full_path.is_dir() {
            std::process::Command::new("open")
                .arg(full_path.to_string_lossy().as_ref())
                .spawn()
                .map_err(|e| e.to_string())?;
        } else {
            std::process::Command::new("open")
                .arg("-R")
                .arg(full_path.to_string_lossy().as_ref())
                .spawn()
                .map_err(|e| e.to_string())?;
        }
    }

    #[cfg(target_os = "linux")]
    {
        let parent = full_path.parent().unwrap_or(&full_path);
        std::process::Command::new("xdg-open")
            .arg(parent.to_string_lossy().as_ref())
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    Ok(())
}

// ── Vault Watcher ──

fn start_vault_watcher(app: tauri::AppHandle, vault_root: String) {
    use notify::{Event, RecursiveMode, Watcher};
    use std::sync::mpsc;
    use std::time::{Duration, Instant};

    let app_handle = app.clone();
    let root = vault_root.clone();

    // Use a channel-based watcher with manual debounce
    let (tx, rx) = mpsc::channel::<Result<Event, notify::Error>>();

    let mut watcher = match notify::recommended_watcher(move |res| {
        let _ = tx.send(res);
    }) {
        Ok(w) => w,
        Err(_) => return,
    };

    if watcher.watch(Path::new(&root), RecursiveMode::Recursive).is_err() {
        return;
    }

    // Spawn a thread to debounce events and emit to frontend
    std::thread::spawn(move || {
        let mut last_emit = Instant::now();
        let debounce = Duration::from_millis(150);

        for event in rx {
            if let Ok(event) = event {
                let now = Instant::now();
                if now.duration_since(last_emit) < debounce {
                    continue;
                }

                for path in &event.paths {
                    let rel = path
                        .strip_prefix(&root)
                        .unwrap_or(path)
                        .to_string_lossy()
                        .replace('\\', "/");
                    if rel.starts_with('.') || rel.starts_with("assets/") {
                        continue;
                    }
                    let _ = app_handle.emit("vault:changed", ());
                    last_emit = now;
                    break;
                }
            }
        }
    });

    // Keep watcher alive
    std::mem::forget(watcher);
}
