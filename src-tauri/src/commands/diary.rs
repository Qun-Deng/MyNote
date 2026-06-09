use crate::state::AppState;
use crate::vault;
use chrono::NaiveDate;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::State;

#[derive(Debug, Serialize, Deserialize)]
pub struct DiaryMonthData {
    pub date: String,
    pub has_entry: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct DiaryRangeEntry {
    pub path: String,
    pub date: String,
    pub title: String,
    pub preview: String,
    pub updated_at: String,
}

fn get_diary_path(date: &str) -> String {
    if let Ok(d) = NaiveDate::parse_from_str(date, "%Y-%m-%d") {
        let year = d.format("%Y").to_string();
        let date_str = d.format("%Y-%m-%d").to_string();
        format!("diary/{}/{}.md", year, date_str)
    } else {
        format!("diary/{}.md", date)
    }
}

fn get_weekday(date: &str) -> &'static str {
    if let Ok(d) = NaiveDate::parse_from_str(date, "%Y-%m-%d") {
        match d.format("%u").to_string().as_str() {
            "1" => "星期一",
            "2" => "星期二",
            "3" => "星期三",
            "4" => "星期四",
            "5" => "星期五",
            "6" => "星期六",
            "7" => "星期日",
            _ => "",
        }
    } else {
        ""
    }
}

// ── diary_get ──

#[tauri::command]
pub fn diary_get(state: State<AppState>, date: String) -> Result<Option<vault::NoteMeta>, String> {
    let vault_path = state.vault_path.lock().map_err(|e| e.to_string())?;
    let vp = match vault_path.as_ref() {
        Some(p) => p.clone(),
        None => return Ok(None),
    };

    let file_path = get_diary_path(&date);
    let full_path = PathBuf::from(&vp).join(&file_path);

    if !full_path.exists() {
        return Ok(None);
    }

    let stat = fs::metadata(&full_path).map_err(|e| e.to_string())?;
    let created = stat.created().map(|t| {
        chrono::DateTime::<chrono::Utc>::from(t).format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string()
    }).unwrap_or_default();
    let modified = stat.modified().map(|t| {
        chrono::DateTime::<chrono::Utc>::from(t).format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string()
    }).unwrap_or_default();

    Ok(Some(vault::NoteMeta {
        id: 0,
        path: file_path,
        title: format!("{} 日记", date),
        created_at: created,
        updated_at: modified,
        tags: vec!["diary".to_string()],
        is_diary: true,
        diary_date: Some(date),
        archived: false,
        pinned: false,
    }))
}

// ── diary_create ──

#[tauri::command]
pub fn diary_create(state: State<AppState>, date: String) -> Result<vault::NoteMeta, String> {
    let vault_path = state.vault_path.lock().map_err(|e| e.to_string())?;
    let vp = match vault_path.as_ref() {
        Some(p) => p.clone(),
        None => return Err("Vault not initialized".into()),
    };

    let file_path = get_diary_path(&date);
    let full_path = PathBuf::from(&vp).join(&file_path);

    if let Some(parent) = full_path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    let d = NaiveDate::parse_from_str(&date, "%Y-%m-%d").unwrap_or_else(|_| NaiveDate::from_ymd_opt(2024, 1, 1).unwrap());
    let date_cn = d.format("%Y年%-m月%-d日").to_string();
    let weekday = get_weekday(&date);
    let iso_date = d.format("%Y-%m-%d").to_string();

    let template = format!(
        "---\ndate: {}\ntags: [diary]\n---\n\n# {} {}\n\n## [待办事项]\n\n## [想法记录]\n",
        iso_date, date_cn, weekday
    );

    fs::write(&full_path, &template).map_err(|e| e.to_string())?;

    let now = chrono::Utc::now().to_rfc3339();
    Ok(vault::NoteMeta {
        id: 0,
        path: file_path,
        title: format!("{} 日记", date),
        created_at: now.clone(),
        updated_at: now,
        tags: vec!["diary".to_string()],
        is_diary: true,
        diary_date: Some(date),
        archived: false,
        pinned: false,
    })
}

// ── diary_get_month ──

#[tauri::command]
pub fn diary_get_month(state: State<AppState>, year: i32, month: u32) -> Result<Vec<DiaryMonthData>, String> {
    let vault_path = state.vault_path.lock().map_err(|e| e.to_string())?;
    let vp = match vault_path.as_ref() {
        Some(p) => p.clone(),
        None => return Ok(Vec::new()),
    };

    let diary_dir = PathBuf::from(&vp).join("diary").join(year.to_string());
    let first_of_month = NaiveDate::from_ymd_opt(year, month, 1).unwrap();
    let days_in_month = if month == 12 {
        NaiveDate::from_ymd_opt(year + 1, 1, 1).unwrap()
    } else {
        NaiveDate::from_ymd_opt(year, month + 1, 1).unwrap()
    }.signed_duration_since(first_of_month).num_days() as u32;

    let mut results = Vec::new();
    for day in 1..=days_in_month {
        let date_str = format!("{}-{:02}-{:02}", year, month, day);
        let file_path = diary_dir.join(&format!("{}.md", date_str));
        results.push(DiaryMonthData {
            date: date_str,
            has_entry: file_path.exists(),
        });
    }

    Ok(results)
}

// ── diary_get_range ──

#[tauri::command]
pub fn diary_get_range(state: State<AppState>, start_date: String, end_date: String) -> Result<Vec<DiaryRangeEntry>, String> {
    let vault_path = state.vault_path.lock().map_err(|e| e.to_string())?;
    let vp = match vault_path.as_ref() {
        Some(p) => p.clone(),
        None => return Ok(Vec::new()),
    };

    let start = NaiveDate::parse_from_str(&start_date, "%Y-%m-%d").map_err(|e| e.to_string())?;
    let end = NaiveDate::parse_from_str(&end_date, "%Y-%m-%d").map_err(|e| e.to_string())?;

    let diary_root = PathBuf::from(&vp).join("diary");
    if !diary_root.exists() {
        return Ok(Vec::new());
    }

    let mut results = Vec::new();
    walk_diary_dir(&diary_root, &vp, start, end, &mut results);

    results.sort_by(|a, b| b.date.cmp(&a.date));
    Ok(results)
}

fn walk_diary_dir(
    dir: &std::path::Path,
    vault_root: &str,
    start: NaiveDate,
    end: NaiveDate,
    results: &mut Vec<DiaryRangeEntry>,
) {
    if !dir.exists() { return; }
    if let Ok(entries) = fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                walk_diary_dir(&path, vault_root, start, end, results);
            } else if path.extension().and_then(|e| e.to_str()) == Some("md") {
                let date_str = path.file_stem()
                    .and_then(|s| s.to_str())
                    .unwrap_or("");
                if let Ok(entry_date) = NaiveDate::parse_from_str(date_str, "%Y-%m-%d") {
                    if entry_date >= start && entry_date <= end {
                        if let Ok(content) = fs::read_to_string(&path) {
                            let rel_path = path.strip_prefix(vault_root)
                                .unwrap_or(&path)
                                .to_string_lossy()
                                .replace('\\', "/");

                            // Extract first paragraph as preview
                            let preview = content.lines()
                                .skip_while(|l| l.starts_with('#') || l.trim().is_empty() || l.starts_with("---"))
                                .take_while(|l| !l.trim().is_empty())
                                .collect::<Vec<_>>()
                                .join(" ");
                            let preview = if preview.len() > 120 {
                                format!("{}...", &preview[..120])
                            } else {
                                preview
                            };

                            let modified = fs::metadata(&path)
                                .and_then(|m| m.modified())
                                .map(|t| {
                                    chrono::DateTime::<chrono::Utc>::from(t)
                                        .format("%Y-%m-%dT%H:%M:%S%.3fZ")
                                        .to_string()
                                })
                                .unwrap_or_default();

                            results.push(DiaryRangeEntry {
                                path: rel_path,
                                date: date_str.to_string(),
                                title: format!("{} 日记", date_str),
                                preview,
                                updated_at: modified,
                            });
                        }
                    }
                }
            }
        }
    }
}
