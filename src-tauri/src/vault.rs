use regex::Regex;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;

// ── Types ──

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NoteMeta {
    pub id: i64,
    pub path: String,
    pub title: String,
    pub created_at: String,
    pub updated_at: String,
    pub tags: Vec<String>,
    pub is_diary: bool,
    pub diary_date: Option<String>,
    pub archived: bool,
    pub pinned: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NoteContent {
    pub meta: NoteMeta,
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileTreeNode {
    pub name: String,
    pub path: String,
    #[serde(rename = "type")]
    pub node_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub children: Option<Vec<FileTreeNode>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchResult {
    pub path: String,
    pub title: String,
    pub snippet: String,
    pub rank: i64,
}

// ── Helpers ──

pub fn get_title(file_path: &str, content: &str) -> String {
    let re = Regex::new(r"^#\s+(.+)$").unwrap();
    if let Some(cap) = re.captures(content).and_then(|c| c.get(1)) {
        return cap.as_str().to_string();
    }
    // Fallback: filename without .md
    Path::new(file_path)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("Untitled")
        .to_string()
}

pub fn extract_diary_date(file_path: &str) -> Option<String> {
    let re = Regex::new(r"(\d{4}-\d{2}-\d{2})\.md$").unwrap();
    re.captures(file_path)
        .and_then(|c| c.get(1))
        .map(|m| m.as_str().to_string())
}

fn normalize_tag(tag: &str) -> String {
    let t = tag.trim();
    // Strip leading/trailing brackets, backslashes, hashes
    let t = Regex::new(r"^\\+|\\+$|^\[|\]$|^\\+|\\+$|^#").unwrap().replace_all(t, "");
    let t = Regex::new(r"[.,;:!?，。；：！？、）)]+$").unwrap().replace_all(&t, "");
    t.trim().to_lowercase()
}

fn add_tags_from_value(tags: &mut Vec<String>, value: &str) {
    let cleaned = value
        .replace('[', "")
        .replace(']', "")
        .replace(['\'', '"'], "")
        .trim()
        .to_string();
    for part in cleaned.split(&[',', '，', '、'][..]).flat_map(|s| s.split_whitespace()) {
        let t = normalize_tag(part);
        if !t.is_empty() && !tags.contains(&t) {
            tags.push(t);
        }
    }
}

/// Extract tags from markdown content (frontmatter + inline)
pub fn extract_tags(content: &str) -> Vec<String> {
    let mut tags: Vec<String> = Vec::new();

    // 1. Frontmatter tags
    let fm_re = Regex::new(r"(?s)^---\r?\n(.*?)\r?\n---").unwrap();
    if let Some(fm_match) = fm_re.captures(content) {
        let fm = fm_match.get(1).map(|m| m.as_str()).unwrap_or("");

        // YAML-style: tags: [tag1, tag2] or tags: tag1, tag2
        let yaml_line = Regex::new(r"(?im)^tags:\s*(.+)$").unwrap();
        if let Some(cap) = yaml_line.captures(fm).and_then(|c| c.get(1)) {
            let val = cap.as_str().trim();
            if !val.starts_with('\n') {
                add_tags_from_value(&mut tags, val);
            }
        }

        // YAML list: tags:\n  - tag1\n  - tag2
        let yaml_list = Regex::new(r"(?s)tags:\s*\n((?:\s*-\s*.+\n?)*)").unwrap();
        if let Some(cap) = yaml_list.captures(fm).and_then(|c| c.get(1)) {
            let list_items = Regex::new(r"-\s*(.+)").unwrap();
            for item_cap in list_items.captures_iter(cap.as_str()) {
                let t = normalize_tag(&item_cap.get(1).map(|m| m.as_str()).unwrap_or("").replace(['\'', '"'], ""));
                if !t.is_empty() && !tags.contains(&t) {
                    tags.push(t);
                }
            }
        }
    }

    // 2. Inline tags from body (exclude frontmatter and code blocks)
    let body = Regex::new(r"(?s)^---.*?---").unwrap()
        .replace(content, "")
        .to_string();
    let body = Regex::new(r"(?s)```.*?```").unwrap()
        .replace_all(&body, "")
        .to_string();
    let body = Regex::new(r"`[^`\n]*`").unwrap()
        .replace_all(&body, "")
        .to_string();

    // Bracket tags: [#tag] or escaped \[#tag\]
    let bracket_re = Regex::new(r#"\\?\[#([^\]\\#\s]+)\]"#).unwrap();
    for cap in bracket_re.captures_iter(&body) {
        let t = normalize_tag(cap.get(1).map(|m| m.as_str()).unwrap_or(""));
        if !t.is_empty() && !tags.contains(&t) {
            tags.push(t);
        }
    }

    // Declaration lines: tags: tag1, tag2 or 标签: tag1
    let decl_re = Regex::new(r"(?im)^\s*(?:tags|标签)\s*[:：]\s*(.+)$").unwrap();
    for cap in decl_re.captures_iter(&body) {
        if let Some(val) = cap.get(1) {
            add_tags_from_value(&mut tags, val.as_str());
        }
    }

    tags
}

/// Extract wikilinks from content
pub fn extract_wikilinks(content: &str) -> Vec<(String, String)> {
    let mut links = Vec::new();
    let re = Regex::new(r#"\[\[([^\]|#]+)(?:[|#][^\]]+)?\]\]"#).unwrap();
    for cap in re.captures_iter(content) {
        let target = cap.get(1).map(|m| m.as_str().trim().to_string()).unwrap_or_default();
        let match_start = cap.get(0).map(|m| m.start()).unwrap_or(0);
        let start = if match_start >= 20 { match_start - 20 } else { 0 };
        let end = std::cmp::min(content.len(), match_start + cap.get(0).map(|m| m.len()).unwrap_or(0) + 20);
        let context = content[start..end].replace('\n', " ");
        links.push((target, context));
    }
    links
}

/// Resolve wikilink targets to actual file paths
pub fn resolve_wikilink_targets(
    raw_links: &[(String, String)],
    all_paths: &[String],
) -> Vec<(String, String)> {
    raw_links.iter().map(|(raw, ctx)| {
        let raw_lower = raw.to_lowercase().replace(".md", "");

        // Strategy 1: Exact match
        if all_paths.iter().any(|p| p == raw || p == &format!("{}.md", raw)) {
            let target = if all_paths.contains(raw) {
                raw.clone()
            } else {
                format!("{}.md", raw)
            };
            return (target, ctx.clone());
        }

        // Strategy 2: Case-insensitive filename match
        if let Some(matched) = all_paths.iter().find(|p| {
            let name = Path::new(p)
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("")
                .to_lowercase();
            name == raw_lower
        }) {
            return (matched.clone(), ctx.clone());
        }

        // Strategy 3: Partial path match
        let raw_path = raw.replace('\\', "/").to_lowercase();
        if let Some(matched) = all_paths.iter().find(|p| {
            p.to_lowercase().contains(&raw_path)
        }) {
            return (matched.clone(), ctx.clone());
        }

        // Strategy 4: With .md appended
        if let Some(matched) = all_paths.iter().find(|p| {
            p.to_lowercase().contains(&format!("{}.md", raw_path))
        }) {
            return (matched.clone(), ctx.clone());
        }

        // No match — keep original
        (raw.clone(), ctx.clone())
    }).collect()
}

/// Scan directory tree for .md files and folders
pub fn scan_directory(dir: &Path, relative_to: &Path) -> Vec<FileTreeNode> {
    let mut entries = Vec::new();
    if !dir.exists() || !dir.is_dir() {
        return entries;
    }

    if let Ok(items) = fs::read_dir(dir) {
        for item in items.flatten() {
            let name = item.file_name().to_string_lossy().to_string();
            if name.starts_with('.') {
                continue;
            }
            let full_path = item.path();
            let Ok(rel_path) = full_path.strip_prefix(relative_to) else {
                continue;
            };
            let rel_str = rel_path.to_string_lossy().replace('\\', "/");

            if rel_str == "assets" || rel_str.starts_with("assets/") {
                continue;
            }

            if full_path.is_dir() {
                let children = scan_directory(&full_path, relative_to);
                entries.push(FileTreeNode {
                    name,
                    path: rel_str,
                    node_type: "directory".to_string(),
                    children: Some(children),
                });
            } else if name.ends_with(".md") {
                entries.push(FileTreeNode {
                    name,
                    path: rel_str,
                    node_type: "file".to_string(),
                    children: None,
                });
            }
        }
    }

    // Sort: directories first, then files, both alphabetically
    entries.sort_by(|a, b| {
        if a.node_type != b.node_type {
            if a.node_type == "directory" { std::cmp::Ordering::Less } else { std::cmp::Ordering::Greater }
        } else {
            a.name.cmp(&b.name)
        }
    });

    entries
}

/// Normalize a note file name (sanitize, ensure .md extension)
pub fn normalize_note_file_name(title: &str) -> String {
    let trimmed = title.trim();
    let base = if trimmed.to_lowercase().ends_with(".md") {
        &trimmed[..trimmed.len() - 3]
    } else {
        trimmed
    };
    let safe = Regex::new(r#"[<>:"/\\|?*\x00-\x1F]"#).unwrap()
        .replace_all(base, "-")
        .to_string();
    let safe = Regex::new(r"\s+").unwrap()
        .replace_all(&safe, " ")
        .to_string();
    let safe = Regex::new(r"[. ]+$").unwrap()
        .replace(&safe, "")
        .to_string();
    let safe = safe.trim().to_string();
    format!("{}.md", if safe.is_empty() { "Untitled" } else { &safe })
}

pub fn normalize_note_path(file_path: &str) -> String {
    let parent = Path::new(file_path).parent().and_then(|p| p.to_str()).unwrap_or(".");
    let file_name = normalize_note_file_name(
        Path::new(file_path).file_name().and_then(|f| f.to_str()).unwrap_or("Untitled.md")
    );
    if parent == "." {
        file_name
    } else {
        format!("{}/{}", parent, file_name)
    }
}

/// Collect all file paths in a vault (recursive walk, .md only)
pub fn collect_all_paths(vault_root: &Path) -> Vec<String> {
    let mut paths = Vec::new();
    use walkdir::WalkDir;
    for entry in WalkDir::new(vault_root).into_iter().filter_map(|e| e.ok()) {
        let path = entry.path();
        if path.is_file() {
            if let Some(ext) = path.extension() {
                if ext == "md" {
                    if let Ok(rel) = path.strip_prefix(vault_root) {
                        let rel = rel.to_string_lossy().replace('\\', "/");
                        if is_hidden_dir(&rel) {
                            continue;
                        }
                        paths.push(rel);
                    }
                }
            }
        }
    }
    paths
}

fn is_hidden_dir(rel_path: &str) -> bool {
    rel_path == "assets" || rel_path.starts_with("assets/")
}

// ── Tag operations on markdown files ──

fn escape_regex(s: &str) -> String {
    Regex::new(r"[.*+?^${}()|[\]\\]").unwrap().replace_all(s, r"\$0").to_string()
}

pub fn replace_tag_in_content(content: &str, old_tag: &str, new_tag: &str) -> String {
    // Replace in frontmatter
    let fm_re = Regex::new(r"(?s)^(---\r?\n)(.*?)(\r?\n---)").unwrap();
    let replaced_fm = fm_re.replace(content, |caps: &regex::Captures| {
        let prefix = caps.get(1).map(|m| m.as_str()).unwrap_or("");
        let fm = caps.get(2).map(|m| m.as_str()).unwrap_or("");
        let suffix = caps.get(3).map(|m| m.as_str()).unwrap_or("");

        let old_re = regex::escape(old_tag);
        let mut new_fm = fm.to_string();

        // YAML list: \n  - oldTag
        new_fm = Regex::new(&format!(r"(\s*-\s*){}(\s*\n|$)", old_re)).unwrap()
            .replace_all(&new_fm, format!("$1{}$2", new_tag)).to_string();
        // YAML array: [oldTag, other] or [other, oldTag]
        new_fm = Regex::new(&format!(r"(\[|,\s*){}(\s*,|\s*\])", old_re)).unwrap()
            .replace_all(&new_fm, format!("$1{}$2", new_tag)).to_string();
        // YAML single: tags: oldTag
        new_fm = Regex::new(&format!(r"(?m)^(\s*tags:\s*){}\s*$", old_re)).unwrap()
            .replace_all(&new_fm, format!("$1{}", new_tag)).to_string();

        format!("{}{}{}", prefix, new_fm, suffix)
    }).to_string();

    // Replace inline tags
    let old_re = escape_regex(old_tag);
    let body = Regex::new(&format!(r#"\\?\[#{}\\]"#, old_re)).unwrap()
        .replace_all(&replaced_fm, format!(r#"\[#{} \]"#, new_tag)).to_string();
    let body = Regex::new(&format!(r"(?m)(^|\s)#{}(?=\s|$|[.,;:!?，。；：！？])", old_re)).unwrap()
        .replace_all(&body, format!("$1#{}", new_tag)).to_string();

    body
}

pub fn remove_tag_from_content(content: &str, tag_name: &str) -> String {
    let tag_re = escape_regex(tag_name);

    // Remove from frontmatter
    let fm_re = Regex::new(r"(?s)^(---\r?\n)(.*?)(\r?\n---)").unwrap();
    let replaced_fm = fm_re.replace(content, |caps: &regex::Captures| {
        let prefix = caps.get(1).map(|m| m.as_str()).unwrap_or("");
        let fm = caps.get(2).map(|m| m.as_str()).unwrap_or("");
        let suffix = caps.get(3).map(|m| m.as_str()).unwrap_or("");

        let mut new_fm = fm.to_string();
        // YAML list item
        new_fm = Regex::new(&format!(r"\n\s*-\s*{}\s*\n?", tag_re)).unwrap()
            .replace_all(&new_fm, "\n").to_string();
        // YAML array
        new_fm = Regex::new(&format!(r",\s*{}\s*(?=,|\])", tag_re)).unwrap()
            .replace_all(&new_fm, "").to_string();
        new_fm = Regex::new(&format!(r"{}\s*,\s*", tag_re)).unwrap()
            .replace_all(&new_fm, "").to_string();
        new_fm = Regex::new(&format!(r"\[\s*{}\s*\]", tag_re)).unwrap()
            .replace_all(&new_fm, "[]").to_string();

        format!("{}{}{}", prefix, new_fm, suffix)
    }).to_string();

    // Remove inline tags
    let body = Regex::new(&format!(r#"\\?\[#{} \\]"#, tag_re)).unwrap()
        .replace_all(&replaced_fm, "").to_string();
    let body = Regex::new(&format!(r"(?m)(^|\s)#{}(?=\s|$|[.,;:!?，。；：！？])", tag_re)).unwrap()
        .replace_all(&body, "$1").to_string();

    body
}
