import { ipcMain, BrowserWindow, dialog } from 'electron'
import fs from 'fs'
import { marked } from 'marked'

function stripFrontmatter(md: string): string {
  // Remove YAML frontmatter (---\n...\n---)
  const match = md.match(/^---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/)
  if (match) return md.slice(match[0].length)
  // Remove diary meta line: [date: ... tags: [...]]
  const diaryMatch = md.match(/^(?:[ \t]*\r?\n)*\[?(?:#{1,6}\s*)?date:\s*\d{4}-\d{2}-\d{2}\s+tags:\s*(?:\\?\[[^\]\r\n]*\\?\])\s*\]?(?:\r?\n|$)/)
  if (diaryMatch) return md.slice(diaryMatch[0].length).replace(/^---[ \t]*(?:\r?\n|$)/, '')
  return md
}

function markdownToHtml(markdown: string, title: string): string {
  const clean = stripFrontmatter(markdown)
  const body = marked.parse(clean, { async: false }) as string

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>${title}</title>
<style>
  @page { margin: 2.2cm; size: A4; }

  body {
    font-family: "Noto Serif CJK SC", "Source Han Serif SC", "LXGW WenKai", Georgia, "Times New Roman", serif;
    font-size: 14px;
    line-height: 1.92;
    color: #24272b;
    max-width: 760px;
    margin: 0 auto;
    padding: 0;
    text-rendering: optimizeLegibility;
    -webkit-font-smoothing: antialiased;
  }

  h1 {
    font-size: 2em;
    font-weight: 650;
    margin: 0 0 0.8em;
    padding-bottom: 0.35em;
    border-bottom: 1px solid #dfe4e1;
    line-height: 1.35;
  }

  h2 {
    font-size: 1.45em;
    font-weight: 650;
    margin: 1.6em 0 0.6em;
    line-height: 1.35;
  }

  h3 {
    font-size: 1.2em;
    font-weight: 650;
    margin: 1.3em 0 0.5em;
    line-height: 1.35;
  }

  h4, h5, h6 {
    font-size: 1em;
    font-weight: 700;
    margin: 1em 0 0.4em;
    color: #8a9097;
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }

  p {
    margin: 0.8em 0;
    white-space: pre-wrap;
  }

  strong { color: #151719; font-weight: 700; }

  em { color: #3b3f45; font-style: italic; }

  del, s { color: #8a9097; }

  a { color: #365f68; }

  code {
    font-family: "JetBrains Mono", "Fira Code", "Cascadia Code", monospace;
    font-size: 0.88em;
    padding: 0.12em 0.38em;
    border: 1px solid rgba(185,182,175,0.45);
    border-radius: 4px;
    color: #7f3f2f;
    background: #f2f5f4;
  }

  pre {
    margin: 1.2em 0;
    padding: 1em 1.2em;
    border: 1px solid #282c31;
    border-radius: 8px;
    background: #202326;
    color: #eef2f2;
    font-family: "JetBrains Mono", "Fira Code", monospace;
    font-size: 0.88em;
    line-height: 1.78;
    overflow-x: auto;
  }

  pre code {
    padding: 0;
    border: 0;
    color: inherit;
    background: transparent;
    font-size: 1em;
  }

  blockquote {
    margin: 0.9em 0 1.25em;
    padding: 0.08em 0 0.08em 1.4em;
    border-left: 3px solid #aeb8b4;
    color: #464a50;
    font-style: italic;
  }

  blockquote p { margin: 0.6em 0; }

  ul, ol {
    margin: 0.8em 0;
    padding-left: 1.65em;
  }

  ul { list-style: disc; }
  ul ul { list-style: circle; }
  ul ul ul { list-style: square; }
  ol { list-style: decimal; }

  li {
    margin: 0.3em 0;
  }

  /* Task list checkboxes */
  input[type="checkbox"] {
    width: 1em;
    height: 1em;
    margin-right: 0.4em;
    accent-color: #7d8f8a;
    pointer-events: none;
  }

  li:has(input[type="checkbox"]) {
    list-style: none;
    margin-left: -1.4em;
  }

  hr {
    height: 1px;
    margin: 2em 0;
    border: 0;
    background: linear-gradient(90deg, transparent, #dfe4e1 16%, #dfe4e1 84%, transparent);
  }

  table {
    width: 100%;
    margin: 1.2em 0;
    border-collapse: collapse;
    font-size: 0.92em;
  }

  th, td {
    border: 1px solid #dfe4e1;
    padding: 0.55em 0.75em;
    text-align: left;
  }

  th {
    color: #383c41;
    font-size: 0.85em;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }

  tr:nth-child(even) td { background: #fafbfa; }

  img {
    display: block;
    max-width: 100%;
    height: auto;
    margin: 1.5em auto;
    border-radius: 6px;
  }

  kbd {
    padding: 0.1em 0.45em;
    border: 1px solid #d5ddda;
    border-bottom-width: 2px;
    border-radius: 4px;
    color: #555b62;
    background: #f7f9f8;
    font-family: "JetBrains Mono", monospace;
    font-size: 0.82em;
  }
</style>
</head>
<body>
${body}
</body>
</html>`
}

export function registerExportIPC() {
  ipcMain.handle('export:pdf', async (_event, markdown: string, title: string) => {
    const { filePath } = await dialog.showSaveDialog({
      title: '导出 PDF',
      defaultPath: `${title || 'note'}.pdf`,
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    })

    if (!filePath) return { success: false, output: 'Cancelled' }

    try {
      const html = markdownToHtml(markdown, title)

      const win = new BrowserWindow({
        width: 860,
        height: 700,
        show: false,
        webPreferences: { nodeIntegration: false, contextIsolation: true },
      })

      await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
      await new Promise((r) => setTimeout(r, 600))

      const pdfData = await win.webContents.printToPDF({
        printBackground: true,
        preferCSSPageSize: true,
        margins: { top: 0, bottom: 0, left: 0, right: 0 },
      })

      fs.writeFileSync(filePath, pdfData)
      win.close()

      return { success: true, output: filePath }
    } catch (err) {
      return { success: false, output: err instanceof Error ? err.message : 'Export failed' }
    }
  })
}
