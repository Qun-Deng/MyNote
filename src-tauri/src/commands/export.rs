use crate::state::AppState;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use tauri::State;

#[derive(Debug, Serialize, Deserialize)]
pub struct ExportResult {
    pub success: bool,
    pub output: String,
}

/// Try to find a headless browser for HTML→PDF conversion.
fn find_headless_browser() -> Option<String> {
    #[cfg(target_os = "windows")]
    {
        let edge_paths = [
            r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
            r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
        ];
        for p in &edge_paths {
            if PathBuf::from(p).exists() {
                return Some(p.to_string());
            }
        }
    }

    #[cfg(target_os = "windows")]
    let chrome_paths = [
        r"C:\Program Files\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    ];
    #[cfg(target_os = "macos")]
    let chrome_paths = [
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    ];
    #[cfg(target_os = "linux")]
    let chrome_paths = [
        "/usr/bin/google-chrome",
        "/usr/bin/chromium-browser",
        "/usr/bin/chromium",
    ];

    #[cfg(not(target_os = "windows"))]
    for p in &chrome_paths {
        if PathBuf::from(p).exists() {
            return Some(p.to_string());
        }
    }

    #[cfg(target_os = "windows")]
    for p in &chrome_paths {
        if PathBuf::from(p).exists() {
            return Some(p.to_string());
        }
    }

    None
}

fn html_to_pdf(html_path: &Path, pdf_path: &Path) -> Result<(), String> {
    let browser =
        find_headless_browser().ok_or_else(|| "未找到 Edge 或 Chrome 浏览器".to_string())?;

    let status = Command::new(&browser)
        .args([
            "--headless",
            "--disable-gpu",
            "--no-sandbox",
            &format!("--print-to-pdf={}", pdf_path.to_string_lossy()),
            &html_path.to_string_lossy(),
        ])
        .status()
        .map_err(|e| format!("启动浏览器失败: {}", e))?;

    if !status.success() {
        return Err(format!("浏览器退出码: {}", status));
    }

    Ok(())
}

fn safe_filename(title: &str) -> String {
    let cleaned: String = title
        .chars()
        .map(|c| {
            if c.is_alphanumeric() || c == ' ' || c == '-' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .collect();
    if cleaned.is_empty() {
        "export".to_string()
    } else {
        cleaned
    }
}

/// Export HTML to PDF. The frontend is responsible for rendering markdown → HTML
/// (including image resolution). The backend only handles file writing and browser PDF conversion.
#[tauri::command]
pub fn export_html_to_pdf(
    state: State<AppState>,
    html: String,
    title: String,
) -> Result<ExportResult, String> {
    let vault_path = state.vault_path.lock().map_err(|e| e.to_string())?;
    let vp = match vault_path.as_ref() {
        Some(p) => p.clone(),
        None => return Err("Vault not initialized".into()),
    };

    let export_dir = PathBuf::from(&vp).join("exports");
    fs::create_dir_all(&export_dir).map_err(|e| e.to_string())?;

    let base_name = safe_filename(&title);
    let html_path = export_dir.join(format!("{}.html", base_name));
    let pdf_path = export_dir.join(format!("{}.pdf", base_name));

    // Write the HTML (already complete document from frontend)
    fs::write(&html_path, &html).map_err(|e| e.to_string())?;

    // Convert HTML → PDF via headless browser
    match html_to_pdf(&html_path, &pdf_path) {
        Ok(()) => {
            let _ = fs::remove_file(&html_path);
            Ok(ExportResult {
                success: true,
                output: pdf_path.to_string_lossy().to_string(),
            })
        }
        Err(e) => Ok(ExportResult {
            success: true,
            output: format!(
                "HTML已保存至: {}\n( PDF生成失败: {} )",
                html_path.to_string_lossy(),
                e
            ),
        }),
    }
}
