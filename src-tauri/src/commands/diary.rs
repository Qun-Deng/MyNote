use crate::commands::todos::{read_todo_page, write_todo_page, TodoPageItem};
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

// ── Todo Sync Helpers ──

/// Parse the `## [待办事项]` section from markdown content.
/// Returns list of (content, completed) tuples.
/// Handles Milkdown backslash-escaped brackets: `\[待办事项\]`
fn parse_diary_todo_section(content: &str) -> Vec<(String, bool)> {
    // Match ## [待办事项] or ## \[待办事项\] on original content
    let header_re = regex::Regex::new(r"(?m)^##\s*(?:\\\[|\[)待办事项(?:\\\]|\])").unwrap();
    let header_match = match header_re.find(content) {
        Some(m) => m,
        None => return Vec::new(),
    };

    // Find start of content after the header line
    let header_end = header_match.end();
    let after_header = content[header_end..].find('\n').map(|i| header_end + i + 1).unwrap_or(content.len());

    // Find end of section (next ## heading or EOF)
    let rest = &content[after_header..];
    let next_heading = regex::Regex::new(r"(?m)^##\s").unwrap();
    let section_end = match next_heading.find(rest) {
        Some(m) => after_header + m.start(),
        None => content.len(),
    };

    let section_text = &content[after_header..section_end];

    // Parse - [ ] / - [x] items from section text
    let mut items = Vec::new();
    for line in section_text.lines() {
        let trimmed = line.trim();
        if let Some(rest) = trimmed.strip_prefix("- [ ]").or_else(|| trimmed.strip_prefix("* [ ]")).or_else(|| trimmed.strip_prefix("+ [ ]")) {
            items.push((rest.trim().to_string(), false));
        } else if let Some(rest) = trimmed.strip_prefix("- [x]").or_else(|| trimmed.strip_prefix("* [x]")).or_else(|| trimmed.strip_prefix("+ [x]"))
            .or_else(|| trimmed.strip_prefix("- [X]")).or_else(|| trimmed.strip_prefix("* [X]")).or_else(|| trimmed.strip_prefix("+ [X]"))
        {
            items.push((rest.trim().to_string(), true));
        }
    }

    items
}

/// Check whether a line is a todo checkbox line: `- [ ]`, `- [x]`, `* [x]`, `+ [X]`, etc.
fn is_checkbox_line(line: &str) -> bool {
    let t = line.trim();
    t.starts_with("- [ ]") || t.starts_with("- [x]") || t.starts_with("- [X]")
        || t.starts_with("* [ ]") || t.starts_with("* [x]") || t.starts_with("* [X]")
        || t.starts_with("+ [ ]") || t.starts_with("+ [x]") || t.starts_with("+ [X]")
}

/// Replace or insert the `## [待办事项]` section in markdown content.
/// Preserves non-checkbox content (images, text, etc.) — only checkbox lines are replaced.
fn replace_diary_todo_section(content: &str, items: &[(String, bool)]) -> String {
    // Build the TODO block from page items
    let mut todo_block = String::new();
    for (text, completed) in items {
        let marker = if *completed { "[x]" } else { "[ ]" };
        todo_block.push_str(&format!("- {} {}\n", marker, text));
    }

    // Match ## [待办事项] or ## \[待办事项\] on original content
    let header_re = regex::Regex::new(r"(?m)^##\s*(?:\\\[|\[)待办事项(?:\\\]|\])").unwrap();
    if let Some(header_match) = header_re.find(content) {
        let section_start = header_match.start();
        let header_end = header_match.end();
        let after_header = content[header_end..].find('\n').map(|i| header_end + i + 1).unwrap_or(content.len());

        let rest = &content[after_header..];
        let next_heading = regex::Regex::new(r"(?m)^##\s").unwrap();
        let section_end = match next_heading.find(rest) {
            Some(m) => after_header + m.start(),
            None => content.len(),
        };

        let section_body = &content[after_header..section_end];

        // Preserve non-checkbox lines from the existing section
        let mut preserved = Vec::new();
        for line in section_body.lines() {
            if is_checkbox_line(line) {
                continue; // replaced by page items
            }
            preserved.push(line.to_string());
        }

        // Build new section body
        let mut new_body = String::new();
        for p in &preserved {
            new_body.push_str(p);
            new_body.push('\n');
        }
        new_body.push_str(&todo_block);

        // Ensure section body ends with a blank line before next heading
        if !new_body.ends_with('\n') {
            new_body.push('\n');
        }
        // If the preserved content already left a blank line, don't double up too much
        // but ensure at least one newline before next section
        if !new_body.ends_with("\n\n") {
            new_body.push('\n');
        }

        let new_section = format!("## [待办事项]\n{}", new_body);

        let mut end = section_end;
        while end > after_header && content.as_bytes().get(end - 1) == Some(&b'\n') {
            end -= 1;
        }

        format!("{}{}{}", &content[..section_start], new_section, &content[end..])
    } else {
        // No [待办事项] section — insert after the title (# header)
        let mut new_section = String::from("## [待办事项]\n");
        if items.is_empty() {
            new_section.push('\n');
        } else {
            new_section.push_str(&todo_block);
            new_section.push('\n');
        }

        let title_re = regex::Regex::new(r"(?m)^#\s+.+$").unwrap();
        if let Some(title_match) = title_re.find(content) {
            let title_end = title_match.end();
            let insert_pos = content[title_end..].find('\n').map(|i| title_end + i + 1).unwrap_or(content.len());
            format!("{}\n{}{}", &content[..insert_pos].trim_end(), new_section, &content[insert_pos..])
        } else {
            format!("{}\n{}", new_section, content)
        }
    }
}

// ── Sync Commands ──

/// Export todoPage items for a date into the diary's [待办事项] markdown section.
#[tauri::command]
pub fn diary_sync_from_page(state: State<AppState>, date: String) -> Result<(), String> {
    let vault_path = state.vault_path.lock().map_err(|e| e.to_string())?;
    let vp = match vault_path.as_ref() {
        Some(p) => p.clone(),
        None => return Ok(()),
    };

    let diary_file = get_diary_path(&date);
    let full_path = PathBuf::from(&vp).join(&diary_file);

    if !full_path.exists() {
        return Ok(());
    }

    let content = fs::read_to_string(&full_path).map_err(|e| e.to_string())?;

    let all_page_items = read_todo_page(&vp);
    let date_items: Vec<(String, bool)> = all_page_items
        .iter()
        .filter(|t| t.section == "today" && t.created_date == date)
        .map(|t| (t.content.clone(), t.completed))
        .collect();

    let new_content = replace_diary_todo_section(&content, &date_items);
    if new_content != content {
        fs::write(&full_path, new_content).map_err(|e| e.to_string())?;
    }

    Ok(())
}

/// Import diary [待办事项] markdown section into todoPage for a date.
/// Diary items replace the existing todoPage items for that date (section='today').
#[tauri::command]
pub fn diary_sync_to_page(state: State<AppState>, date: String) -> Result<(), String> {
    let vault_path = state.vault_path.lock().map_err(|e| e.to_string())?;
    let vp = match vault_path.as_ref() {
        Some(p) => p.clone(),
        None => return Ok(()),
    };

    let diary_file = get_diary_path(&date);
    let full_path = PathBuf::from(&vp).join(&diary_file);

    if !full_path.exists() {
        return Ok(());
    }

    let content = fs::read_to_string(&full_path).map_err(|e| e.to_string())?;
    let diary_items = parse_diary_todo_section(&content);

    // Read existing todoPage items, remove today's items, add diary items
    let mut all_items = read_todo_page(&vp);
    all_items.retain(|t| !(t.section == "today" && t.created_date == date));

    let now = chrono::Utc::now().to_rfc3339();
    for (text, completed) in &diary_items {
        all_items.push(TodoPageItem {
            id: uuid::Uuid::new_v4().to_string(),
            content: text.clone(),
            completed: *completed,
            section: "today".to_string(),
            created_date: date.clone(),
            created_at: now.clone(),
        });
    }

    write_todo_page(&vp, &all_items);
    Ok(())
}
