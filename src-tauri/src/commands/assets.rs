use crate::state::AppState;
use base64::Engine;
use std::fs;
use std::path::PathBuf;
use tauri::State;

#[tauri::command]
pub fn assets_save_image(state: State<AppState>, buffer: Vec<u8>, filename: String) -> Result<String, String> {
    let vault_path = state.vault_path.lock().map_err(|e| e.to_string())?;
    let vp = match vault_path.as_ref() {
        Some(p) => p.clone(),
        None => return Err("Vault not initialized".into()),
    };

    let assets_dir = PathBuf::from(&vp).join("assets");
    fs::create_dir_all(&assets_dir).map_err(|e| e.to_string())?;

    // Generate unique filename
    let ext = PathBuf::from(&filename)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("png")
        .to_lowercase();
    let base_name = PathBuf::from(&filename)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("image")
        .chars()
        .map(|c| if c.is_alphanumeric() || c == '-' || c == '_' { c } else { '-' })
        .collect::<String>();
    let hash = uuid::Uuid::new_v4().to_string()[..8].to_string();
    let final_name = format!("{}-{}.{}", &base_name[..base_name.len().min(40)], hash, ext);
    let file_path = assets_dir.join(&final_name);

    fs::write(&file_path, &buffer).map_err(|e| e.to_string())?;

    Ok(format!("assets/{}", final_name))
}

/// Read an image from the vault and return as a data URL (data:image/...;base64,...)
#[tauri::command]
pub fn assets_read_data_url(state: State<AppState>, rel_path: String) -> Result<String, String> {
    let vault_path = state.vault_path.lock().map_err(|e| e.to_string())?;
    let vp = match vault_path.as_ref() {
        Some(p) => p.clone(),
        None => return Err("Vault not initialized".into()),
    };
    let full_path = PathBuf::from(&vp).join(&rel_path);
    let data = fs::read(&full_path).map_err(|e| e.to_string())?;
    let ext = full_path.extension()
        .and_then(|e| e.to_str())
        .unwrap_or("png")
        .to_lowercase();
    let mime = match ext.as_str() {
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        "bmp" => "image/bmp",
        _ => "image/png",
    };
    let b64 = base64::engine::general_purpose::STANDARD.encode(&data);
    Ok(format!("data:{};base64,{}", mime, b64))
}

/// Read a PDF file and return as base64
#[tauri::command]
pub fn pdf_read(state: State<AppState>, file_path: String) -> Result<String, String> {
    let vault_path = state.vault_path.lock().map_err(|e| e.to_string())?;
    let vp = match vault_path.as_ref() {
        Some(p) => p.clone(),
        None => return Err("Vault not initialized".into()),
    };

    let full_path = PathBuf::from(&vp).join(&file_path);
    let data = fs::read(&full_path).map_err(|e| e.to_string())?;
    Ok(base64::engine::general_purpose::STANDARD.encode(&data))
}

/// Read PDF annotations (JSON file alongside the PDF)
#[tauri::command]
pub fn pdf_read_annotations(state: State<AppState>, pdf_path: String) -> Result<serde_json::Value, String> {
    let vault_path = state.vault_path.lock().map_err(|e| e.to_string())?;
    let vp = match vault_path.as_ref() {
        Some(p) => p.clone(),
        None => return Err("Vault not initialized".into()),
    };

    let annot_path = PathBuf::from(&vp).join(format!("{}.annotations.json", pdf_path));
    if annot_path.exists() {
        let content = fs::read_to_string(&annot_path).map_err(|e| e.to_string())?;
        serde_json::from_str(&content).map_err(|e| e.to_string())
    } else {
        Ok(serde_json::json!([]))
    }
}

/// Write PDF annotations
#[tauri::command]
pub fn pdf_write_annotations(state: State<AppState>, pdf_path: String, data: serde_json::Value) -> Result<(), String> {
    let vault_path = state.vault_path.lock().map_err(|e| e.to_string())?;
    let vp = match vault_path.as_ref() {
        Some(p) => p.clone(),
        None => return Err("Vault not initialized".into()),
    };

    let annot_path = PathBuf::from(&vp).join(format!("{}.annotations.json", pdf_path));
    let json_str = serde_json::to_string_pretty(&data).map_err(|e| e.to_string())?;
    fs::write(&annot_path, json_str).map_err(|e| e.to_string())?;
    Ok(())
}
