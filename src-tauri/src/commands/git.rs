use crate::state::AppState;
use serde::{Deserialize, Serialize};
use std::process::Command;
use tauri::State;

#[derive(Debug, Serialize, Deserialize)]
pub struct GitResult {
    pub success: bool,
    pub output: String,
}

fn run_git(vault_root: &str, args: &[&str]) -> GitResult {
    match Command::new("git")
        .args(args)
        .current_dir(vault_root)
        .output()
    {
        Ok(output) => {
            if output.status.success() {
                let stdout = String::from_utf8_lossy(&output.stdout).to_string();
                GitResult {
                    success: true,
                    output: if stdout.is_empty() { "OK".into() } else { stdout },
                }
            } else {
                let stderr = String::from_utf8_lossy(&output.stderr).to_string();
                GitResult {
                    success: false,
                    output: stderr,
                }
            }
        }
        Err(err) => GitResult {
            success: false,
            output: err.to_string(),
        },
    }
}

#[tauri::command]
pub fn git_status(state: State<AppState>) -> Result<GitResult, String> {
    let vault_path = state.vault_path.lock().map_err(|e| e.to_string())?;
    let vp = match vault_path.as_ref() {
        Some(p) => p.clone(),
        None => return Ok(GitResult { success: false, output: "Vault not initialized".into() }),
    };
    Ok(run_git(&vp, &["status", "--porcelain"]))
}

#[tauri::command]
pub fn git_pull(state: State<AppState>) -> Result<GitResult, String> {
    let vault_path = state.vault_path.lock().map_err(|e| e.to_string())?;
    let vp = match vault_path.as_ref() {
        Some(p) => p.clone(),
        None => return Ok(GitResult { success: false, output: "Vault not initialized".into() }),
    };
    Ok(run_git(&vp, &["pull", "--rebase"]))
}

#[tauri::command]
pub fn git_push(state: State<AppState>) -> Result<GitResult, String> {
    let vault_path = state.vault_path.lock().map_err(|e| e.to_string())?;
    let vp = match vault_path.as_ref() {
        Some(p) => p.clone(),
        None => return Ok(GitResult { success: false, output: "Vault not initialized".into() }),
    };
    Ok(run_git(&vp, &["push"]))
}
