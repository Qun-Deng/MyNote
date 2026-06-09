use rusqlite::Connection;
use std::sync::Mutex;

/// Application state shared across all Tauri commands
pub struct AppState {
    /// Path to the currently active vault directory
    pub vault_path: Mutex<Option<String>>,
    /// SQLite database connection (stored in vault/.mynote.db)
    pub db: Mutex<Option<Connection>>,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            vault_path: Mutex::new(None),
            db: Mutex::new(None),
        }
    }
}
