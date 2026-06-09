use crate::state::AppState;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::State;

#[derive(Debug, Serialize, Deserialize)]
pub struct ExportResult {
    pub success: bool,
    pub output: String,
}

fn strip_frontmatter(md: &str) -> String {
    // Remove YAML frontmatter
    let re = regex::Regex::new(r"(?s)^---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)").unwrap();
    if let Some(matched) = re.find(md) {
        return md[matched.end()..].to_string();
    }
    md.to_string()
}

fn markdown_to_html(markdown: &str, title: &str) -> String {
    let clean = strip_frontmatter(markdown);
    let body = clean
        .lines()
        .map(|line| {
            // Simple markdown → HTML conversion
            let trimmed = line.trim();
            if trimmed.starts_with("# ") {
                format!("<h1>{}</h1>", html_escape(&trimmed[2..]))
            } else if trimmed.starts_with("## ") {
                format!("<h2>{}</h2>", html_escape(&trimmed[3..]))
            } else if trimmed.starts_with("### ") {
                format!("<h3>{}</h3>", html_escape(&trimmed[4..]))
            } else if trimmed.starts_with("#### ") {
                format!("<h4>{}</h4>", html_escape(&trimmed[5..]))
            } else if trimmed.starts_with("- [ ] ") {
                format!("<li><input type='checkbox'>{}</li>", html_escape(&trimmed[6..]))
            } else if trimmed.starts_with("- [x] ") || trimmed.starts_with("- [X] ") {
                format!("<li><input type='checkbox' checked>{}</li>", html_escape(&trimmed[6..]))
            } else if trimmed.starts_with("- ") || trimmed.starts_with("* ") {
                format!("<li>{}</li>", html_escape(&trimmed[2..]))
            } else if trimmed.starts_with("> ") {
                format!("<blockquote>{}</blockquote>", html_escape(&trimmed[2..]))
            } else if trimmed.starts_with("```") {
                String::from("<pre><code>")
            } else if trimmed.is_empty() {
                String::from("<br>")
            } else {
                format!("<p>{}</p>", html_escape(trimmed))
            }
        })
        .collect::<Vec<_>>()
        .join("\n");

    format!(
        r#"<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>{title}</title>
<style>
  @page {{ margin: 2.2cm; size: A4; }}
  body {{
    font-family: "Noto Serif CJK SC", "Source Han Serif SC", Georgia, serif;
    font-size: 14px; line-height: 1.92; color: #24272b;
    max-width: 760px; margin: 0 auto; padding: 0;
  }}
  h1 {{ font-size: 2em; font-weight: 650; margin: 0 0 0.8em; border-bottom: 1px solid #dfe4e1; }}
  h2 {{ font-size: 1.45em; margin: 1.6em 0 0.6em; }}
  h3 {{ font-size: 1.2em; margin: 1.3em 0 0.5em; }}
  h4 {{ font-size: 1em; color: #8a9097; text-transform: uppercase; letter-spacing: 0.08em; }}
  p {{ margin: 0.8em 0; }}
  code {{ font-family: "JetBrains Mono", monospace; font-size: 0.88em; padding: 0.12em 0.38em; background: #f2f5f4; border-radius: 4px; }}
  pre {{ margin: 1.2em 0; padding: 1em; background: #202326; color: #eef2f2; border-radius: 8px; overflow-x: auto; }}
  pre code {{ padding: 0; background: transparent; color: inherit; }}
  blockquote {{ margin: 0.9em 0; padding: 0.08em 0 0.08em 1.4em; border-left: 3px solid #aeb8b4; color: #464a50; font-style: italic; }}
  ul, ol {{ margin: 0.8em 0; padding-left: 1.65em; }}
  li {{ margin: 0.3em 0; }}
  hr {{ height: 1px; margin: 2em 0; border: 0; background: linear-gradient(90deg, transparent, #dfe4e1 16%, #dfe4e1 84%, transparent); }}
  table {{ width: 100%; border-collapse: collapse; }}
  th, td {{ border: 1px solid #dfe4e1; padding: 0.55em 0.75em; text-align: left; }}
  img {{ display: block; max-width: 100%; height: auto; margin: 1.5em auto; border-radius: 6px; }}
</style>
</head>
<body>
{body}
</body>
</html>"#,
        title = html_escape(title),
        body = body,
    )
}

fn html_escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

#[tauri::command]
pub fn export_pdf(state: State<AppState>, markdown: String, title: String) -> Result<ExportResult, String> {
    let vault_path = state.vault_path.lock().map_err(|e| e.to_string())?;
    let vp = match vault_path.as_ref() {
        Some(p) => p.clone(),
        None => return Err("Vault not initialized".into()),
    };

    // Generate HTML
    let html = markdown_to_html(&markdown, &title);

    // Save HTML to a temp file in the vault and the frontend will handle printing
    let export_dir = PathBuf::from(&vp).join("exports");
    fs::create_dir_all(&export_dir).map_err(|e| e.to_string())?;

    let safe_title = title
        .chars()
        .map(|c| if c.is_alphanumeric() || c == ' ' || c == '-' || c == '_' { c } else { '_' })
        .collect::<String>();
    let file_name = format!("{}.html", if safe_title.is_empty() { "export" } else { &safe_title });
    let file_path = export_dir.join(&file_name);

    fs::write(&file_path, &html).map_err(|e| e.to_string())?;

    Ok(ExportResult {
        success: true,
        output: file_path.to_string_lossy().to_string(),
    })
}

/// Generate HTML from markdown (returns the HTML string for frontend to display/print)
#[tauri::command]
pub fn export_markdown_to_html(markdown: String, title: String) -> Result<String, String> {
    Ok(markdown_to_html(&markdown, &title))
}
