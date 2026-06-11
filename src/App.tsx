import { useUIStore } from './stores/uiStore'
import { useNoteStore } from './stores/noteStore'
import { useTabStore } from './stores/tabStore'
import { useVaultStore } from './stores/vaultStore'
import Titlebar from './components/layout/Titlebar'
import Sidebar from './components/layout/Sidebar'
import StatusBar from './components/layout/StatusBar'
import Dashboard from './components/dashboard/Dashboard'
import DiaryView from './components/diary/DiaryView'
import TodoView from './components/todo/TodoView'
import KnowledgeView from './components/knowledge/KnowledgeView'
import MilkdownEditor, { setEditorVaultPath } from './components/editor/MilkdownEditor'
import OutlineSidebar from './components/editor/OutlineSidebar'
import AgentSidebar from './components/agent/AgentSidebar'
import { useAutoSave } from './components/editor/useAutoSave'
import VaultPrompt from './components/layout/VaultPrompt'
import { useState, useEffect, useCallback, useRef } from 'react'
import { ArrowLeft, Bot, ListTree, X, PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen } from 'lucide-react'
import type { AgentSelection, AgentDraft, LinkedNoteContent } from '../shared/agent'
import type { Backlink } from '../shared/types'
import { truncateNoteContent } from './components/agent/agentClient'

function extractMarkdownTitle(content: string) {
  return content.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? null
}

function safeMarkdownFileName(title: string) {
  const cleaned = title
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  return `${cleaned || 'Untitled'}.md`
}

function renamePathByTitle(filePath: string, title: string) {
  const parts = filePath.split('/')
  parts[parts.length - 1] = safeMarkdownFileName(title)
  return parts.join('/')
}

function htmlEscape(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function splitStandardFrontmatter(markdown: string) {
  const frontmatter = markdown.match(/^---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/)
  if (!frontmatter) return { frontmatter: '', body: markdown }
  return {
    frontmatter: frontmatter[0],
    body: markdown.slice(frontmatter[0].length),
  }
}

function replaceMarkdownTitle(content: string, title: string) {
  const { frontmatter, body } = splitStandardFrontmatter(content)
  const nextTitle = `# ${title}`
  const nextBody = /^#\s+.*$/m.test(body)
    ? body.replace(/^#\s+.*$/m, nextTitle)
    : `${nextTitle}\n\n${body.trimStart()}`
  return `${frontmatter}${frontmatter && !nextBody.startsWith('\n') ? '\n' : ''}${nextBody}`
}

function normalizeTagName(tag: string) {
  return tag
    .trim()
    .replace(/^\\+|\\+$/g, '')
    .replace(/^#/, '')
    .replace(/^[\[]+|[\]]+$/g, '')
    .replace(/^\\+|\\+$/g, '')
    .replace(/[.,;:!?，。；：！？、）)]+$/g, '')
    .trim()
    .toLowerCase()
}

function addMarkdownTag(tags: string[], rawTag: string) {
  const tag = normalizeTagName(rawTag)
  if (tag && !tags.includes(tag)) tags.push(tag)
}

function addMarkdownTagsFromValue(tags: string[], value: string) {
  const cleaned = value
    .replace(/^\[/, '')
    .replace(/\]$/, '')
    .replace(/['"]/g, '')
    .trim()
  for (const part of cleaned.split(/[,，、\s]+/)) {
    addMarkdownTag(tags, part)
  }
}

function extractMarkdownTags(content: string) {
  const tags: string[] = []
  const frontmatter = content.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  if (frontmatter) {
    const yamlMatch = frontmatter[1].match(/^tags:\s*(.+)$/im)
    if (yamlMatch) addMarkdownTagsFromValue(tags, yamlMatch[1])

    const yamlListMatch = frontmatter[1].match(/tags:\s*\n((?:\s*-\s*.+\n?)*)/)
    if (yamlListMatch) {
      const listItems = yamlListMatch[1].matchAll(/-\s*(.+)/g)
      for (const item of listItems) addMarkdownTag(tags, item[1].replace(/['"]/g, ''))
    }
  }

  const body = content
    .replace(/^---[\s\S]*?---/, '')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`[^`\n]*`/g, '')

  const declarationLines = body.matchAll(/^\s*(?:tags|标签)\s*[:：]\s*(.+)$/gim)
  for (const match of declarationLines) addMarkdownTagsFromValue(tags, match[1])

  // Bracket tags: [#tag]
  const bracketMatches = body.matchAll(/\\?\[#([^\]#\\\s]+)\]/g)
  for (const match of bracketMatches) {
    addMarkdownTag(tags, match[1])
  }
  return tags
}

function App() {
  const activeView = useUIStore((s) => s.activeView)
  const openNotePath = useUIStore((s) => s.openNotePath)
  const setActiveView = useUIStore((s) => s.setActiveView)
  const setOpenNotePath = useUIStore((s) => s.setOpenNotePath)
  const sidebarOpen = useUIStore((s) => s.sidebarOpen)
  const toggleSidebar = useUIStore((s) => s.toggleSidebar)
  const setKnowledgeTag = useUIStore((s) => s.setKnowledgeTag)

  const currentMeta = useNoteStore((s) => s.currentMeta)
  const currentContent = useNoteStore((s) => s.currentContent)
  const setContent = useNoteStore((s) => s.setContent)
  const updateCurrentMeta = useNoteStore((s) => s.updateCurrentMeta)
  const saveNote = useNoteStore((s) => s.saveNote)
  const closeNote = useNoteStore((s) => s.closeNote)
  const openNote = useNoteStore((s) => s.openNote)

  // Tab store
  const tabs = useTabStore((s) => s.tabs)
  const activeTabPath = useTabStore((s) => s.activeTabPath)
  const openTab = useTabStore((s) => s.openTab)
  const closeTab = useTabStore((s) => s.closeTab)
  const updateTabPath = useTabStore((s) => s.updateTabPath)
  const setActiveTab = useTabStore((s) => s.setActiveTab)
  const updateTabTitle = useTabStore((s) => s.updateTabTitle)
  const cacheContent = useTabStore((s) => s.cacheContent)
  const getCached = useTabStore((s) => s.getCached)

  const vaultPath = useVaultStore((s) => s.vaultPath)
  const setVaultPath = useVaultStore((s) => s.setVaultPath)
  const refreshTree = useVaultStore((s) => s.refreshTree)

  const [vaultReady, setVaultReady] = useState(false)
  const [loading, setLoading] = useState(true)
  const [renamingTitle, setRenamingTitle] = useState(false)
  const [titleDraft, setTitleDraft] = useState('')
  const [editorRevision, setEditorRevision] = useState(0)
  const [outlineOpen, setOutlineOpen] = useState(true)
  const [rightPanelTab, setRightPanelTab] = useState<'outline' | 'ai'>('outline')
  const [agentSelection, setAgentSelection] = useState<AgentSelection | null>(null)
  const [linkedNoteContents, setLinkedNoteContents] = useState<LinkedNoteContent[]>([])
  const [linkedNotesLoading, setLinkedNotesLoading] = useState(false)
  const prevActiveTabRef = useRef<string | null>(null)

  // ── Resizable sidebars ──
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    try { return Number(localStorage.getItem('sidebarWidth')) || 224 } catch { return 224 }
  })
  const [outlineWidth, setOutlineWidth] = useState(() => {
    try { return Number(localStorage.getItem('outlineWidth')) || 200 } catch { return 200 }
  })
  const [resizeTarget, setResizeTarget] = useState<'sidebar' | 'outline' | null>(null)
  const sidebarWidthRef = useRef(sidebarWidth)
  const outlineWidthRef = useRef(outlineWidth)
  sidebarWidthRef.current = sidebarWidth
  outlineWidthRef.current = outlineWidth

  useEffect(() => {
    if (!resizeTarget) return
    const handleMouseMove = (e: MouseEvent) => {
      if (resizeTarget === 'sidebar') {
        setSidebarWidth(Math.max(160, Math.min(400, e.clientX)))
      } else {
        setOutlineWidth(Math.max(140, Math.min(400, window.innerWidth - e.clientX)))
      }
    }
    const handleMouseUp = () => {
      localStorage.setItem('sidebarWidth', String(sidebarWidthRef.current))
      localStorage.setItem('outlineWidth', String(outlineWidthRef.current))
      setResizeTarget(null)
    }
    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [resizeTarget])

  useEffect(() => {
    async function checkVault() {
      try {
        let path = await window.mynote.vault.getPath()
        if (!path) {
          path = await window.mynote.vault.getSavedPath()
        }
        if (path) {
          await window.mynote.vault.init(path)
          setVaultPath(path)
          setEditorVaultPath(path)
          setVaultReady(true)
        }
      } catch {
        // No vault available
      } finally {
        setLoading(false)
      }
    }
    checkVault()
  }, [])

  const handleVaultSelect = async () => {
    const path = await window.mynote.vault.select()
    if (path) {
      await window.mynote.vault.init(path)
      setVaultPath(path)
      setEditorVaultPath(path)
      setVaultReady(true)
    }
  }

  // ── Tab integration: when openNotePath changes, add/switch tab ──
  useEffect(() => {
    if (!openNotePath || !currentMeta) return
    openTab(openNotePath, currentMeta.title)
  }, [openNotePath, currentMeta?.path])

  // ── Tab switching: cache old content, load new ──
  useEffect(() => {
    const prev = prevActiveTabRef.current
    prevActiveTabRef.current = activeTabPath

    if (!activeTabPath) return
    if (prev === activeTabPath) return

    // Cache current content before switching
    if (prev && currentMeta) {
      cacheContent(prev, currentContent, useNoteStore.getState().dirty)
    }

    // Load new tab content
    const cached = getCached(activeTabPath)
    if (cached) {
      // Switch to cached tab without file reload
      setOpenNotePath(activeTabPath)
    } else {
      setOpenNotePath(activeTabPath)
    }
  }, [activeTabPath])

  // Keep tab title in sync
  useEffect(() => {
    if (currentMeta) {
      updateTabTitle(currentMeta.path, currentMeta.title)
    }
  }, [currentMeta?.title])

  // Auto-save logic
  const handleSave = useCallback(
    async (filePath: string, content: string) => {
      await window.mynote.notes.write(filePath, content)
      const tags = extractMarkdownTags(content)
      const title = extractMarkdownTitle(content)
      if (title && currentMeta && !currentMeta.is_diary) {
        if (title !== currentMeta.title || tags.join('\0') !== currentMeta.tags.join('\0')) {
          updateCurrentMeta({ title, tags })
        }
      } else if (currentMeta && tags.join('\0') !== currentMeta.tags.join('\0')) {
        updateCurrentMeta({ tags })
      }
      // Sync diary [待办事项] to todoPage on save
      if (currentMeta?.is_diary && currentMeta?.diary_date) {
        try { await window.mynote.diary.syncToPage(currentMeta.diary_date) } catch {}
      }
    },
    [currentMeta, refreshTree, setOpenNotePath, updateCurrentMeta, closeTab, openTab]
  )

  const { flush } = useAutoSave({
    content: currentContent,
    filePath: currentMeta?.path ?? null,
    delay: 800,
    onSave: handleSave,
  })

  const handleCloseNote = async () => {
    await flush()
    const path = currentMeta?.path
    if (path) closeTab(path)
    closeNote()
    if (tabs.length <= 1) {
      setOpenNotePath(null)
    }
  }

  const handleCloseTab = async (path: string) => {
    if (tabs.length <= 1) {
      await handleCloseNote()
      return
    }
    // If closing the active tab, save first
    if (path === activeTabPath) {
      await flush()
      if (currentMeta?.path === path) {
        closeNote()
      }
    }
    closeTab(path)
    // Switch to the new active tab (closeTab auto-selects adjacent)
    const newActive = useTabStore.getState().activeTabPath
    if (newActive && newActive !== path) {
      const opened = await openNote(newActive)
      if (opened) {
        setOpenNotePath(newActive)
      } else {
        closeTab(newActive)
        setOpenNotePath(null)
      }
    } else if (useTabStore.getState().tabs.length === 0) {
      setOpenNotePath(null)
    }
  }

  useEffect(() => {
    const cleanup = window.mynote.vault.onChanged(async () => {
      await refreshTree()
      let validPaths: Set<string> | null = null
      try {
        const allNotes = await window.mynote.notes.list()
        validPaths = new Set(allNotes.map((note: { path: string }) => note.path))
      } catch {
        return
      }
      if (!validPaths) return

      const tabState = useTabStore.getState()
      for (const tab of tabState.tabs) {
        if (!validPaths.has(tab.path)) closeTab(tab.path)
      }

      if (currentMeta && !validPaths.has(currentMeta.path)) {
        closeNote()
        const nextActive = useTabStore.getState().activeTabPath
        if (nextActive && validPaths.has(nextActive)) {
          const opened = await openNote(nextActive)
          setOpenNotePath(opened ? nextActive : null)
        } else {
          setOpenNotePath(null)
        }
      }
    })
    return cleanup
  }, [closeNote, closeTab, currentMeta?.path, openNote, refreshTree, setOpenNotePath])

  // If a note is open, show the editor
  const isEditing = !!(openNotePath && currentMeta)
  const hasTabs = tabs.length > 0

  const submitTitleRename = useCallback(async () => {
    if (!currentMeta) return
    const nextTitle = titleDraft.trim()
    if (!nextTitle || nextTitle === currentMeta.title) {
      setRenamingTitle(false)
      return
    }

    const nextPath = renamePathByTitle(currentMeta.path, nextTitle)

    try {
      // Flush pending saves to old path first
      await flush()
      // Rename file on disk
      const normalizedPath = await window.mynote.notes.rename(currentMeta.path, nextPath)
      // Update markdown content with new title
      const nextContent = replaceMarkdownTitle(currentContent, nextTitle)
      // Write updated content to the renamed file
      await window.mynote.notes.write(normalizedPath, nextContent)
      // Update in-memory state
      setContent(nextContent)
      updateCurrentMeta({ path: normalizedPath, title: nextTitle })
      setEditorRevision((revision) => revision + 1)
      refreshTree()
    } catch (err) {
      console.error('Rename failed:', err)
    }

    setRenamingTitle(false)
  }, [currentContent, currentMeta, setContent, titleDraft, updateCurrentMeta, flush, refreshTree])

  useEffect(() => {
    setTitleDraft(currentMeta?.title ?? '')
    setRenamingTitle(false)
    setAgentSelection(null)
  }, [currentMeta?.path, currentMeta?.title])

  // Fetch linked notes for AI enriched context (editor mode)
  useEffect(() => {
    if (!currentMeta) {
      setLinkedNoteContents([])
      setLinkedNotesLoading(false)
      return
    }

    let cancelled = false

    const fetchLinkedNotes = async () => {
      setLinkedNotesLoading(true)
      try {
        const [backlinks, forwardLinkPaths] = await Promise.all([
          window.mynote.notes.backlinks(currentMeta.path).catch(() => [] as Backlink[]),
          window.mynote.notes.forwardLinks(currentMeta.path).catch(() => [] as string[]),
        ])

        if (cancelled) return

        // Collect unique linked paths, excluding self
        const allLinkedPaths = new Set([
          ...backlinks.map((b: any) => b.from_path),
          ...forwardLinkPaths,
        ].filter((p: string) => p !== currentMeta.path))

        const MAX_LINKED = 8
        const pathsToFetch = Array.from(allLinkedPaths).slice(0, MAX_LINKED)
        const results: LinkedNoteContent[] = []

        for (const linkedPath of pathsToFetch) {
          const note = await window.mynote.notes.read(linkedPath).catch(() => null)
          if (!note || cancelled) continue
          results.push({
            path: linkedPath,
            title: note.meta.title,
            content: truncateNoteContent(note.content).content,
            relation: backlinks.some((b: any) => b.from_path === linkedPath) ? 'backlink' : 'forward_link',
          })
        }

        if (!cancelled) setLinkedNoteContents(results)
      } catch (err) {
        console.error('Failed to fetch linked notes for AI context:', err)
      } finally {
        if (!cancelled) setLinkedNotesLoading(false)
      }
    }

    const timer = setTimeout(fetchLinkedNotes, 300)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [currentMeta?.path])

  const handleApplyAgentDraft = useCallback(async (draft: AgentDraft) => {
    // Phase 3: create a new note
    if (draft.action === 'create_new_note') {
      const folder = draft.newNoteFolder || 'notes'
      const title = draft.newNoteTitle || '未命名笔记'
      try {
        const meta = await window.mynote.notes.create(folder, title)
        await window.mynote.notes.write(meta.path, draft.nextContent)
        await refreshTree()
        const opened = await openNote(meta.path)
        if (opened) setOpenNotePath(meta.path)
      } catch (err) {
        alert(err instanceof Error ? err.message : '创建笔记失败')
      }
      return
    }

    // Existing: modify current note
    if (!currentMeta) return
    setContent(draft.nextContent)
    await saveNote()
    setEditorRevision((revision) => revision + 1)
  }, [currentMeta, saveNote, setContent, openNote, setOpenNotePath, refreshTree])

  useEffect(() => {
    if (!isEditing) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'F2') return
      const target = event.target
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return
      event.preventDefault()
      setTitleDraft(currentMeta?.title ?? '')
      setRenamingTitle(true)
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [currentMeta?.title, isEditing])

  if (loading) {
    return (
      <div className="app-container">
        <div className="flex-1 flex items-center justify-center">
          <div className="text-surface-400 text-sm">Loading...</div>
        </div>
      </div>
    )
  }

  if (!vaultReady) {
    return <VaultPrompt onSelect={handleVaultSelect} />
  }

  return (
    <div className="app-container">
      <Titlebar />
      <div className="main-layout">
        {sidebarOpen && (
          <>
            <Sidebar width={sidebarWidth} />
            <div
              className="w-1 cursor-col-resize hover:bg-accent-400/40 active:bg-accent-400/60 transition-colors flex-shrink-0"
              onMouseDown={() => setResizeTarget('sidebar')}
            />
          </>
        )}
        <div className="content-area">
          {/* Sidebar toggle — visible when collapsed */}
          {!sidebarOpen && (
            <button
              onClick={toggleSidebar}
              className="absolute left-0 top-1/2 -translate-y-1/2 z-10 p-1 bg-surface-50 border border-surface-200 rounded-r-md hover:bg-surface-100 transition-colors"
              title="展开侧边栏"
            >
              <PanelLeftOpen className="w-4 h-4 text-surface-500" />
            </button>
          )}

          {isEditing ? (
            <div className="h-full flex flex-col">
              {/* ── Tab Bar ── */}
              {hasTabs && (
                <div className="tab-bar">
                  {/* Sidebar toggle in tab bar */}
                  <button
                    onClick={toggleSidebar}
                    className="px-2 py-1 hover:bg-surface-200 transition-colors flex-shrink-0"
                    title={sidebarOpen ? '折叠侧边栏' : '展开侧边栏'}
                  >
                    {sidebarOpen ? <PanelLeftClose className="w-3.5 h-3.5 text-surface-500" /> : <PanelLeftOpen className="w-3.5 h-3.5 text-surface-500" />}
                  </button>
                  {tabs.map((tab) => {
                    const isActive = tab.path === activeTabPath
                    const isDirty = getCached(tab.path)?.dirty ?? false
                    return (
                      <button
                        key={tab.path}
                        onClick={async () => {
                          if (tab.path !== activeTabPath) {
                            // Cache current before switching
                            if (currentMeta) {
                              cacheContent(currentMeta.path, currentContent, useNoteStore.getState().dirty)
                            }
                            // Load the tab's content
                            const opened = await openNote(tab.path)
                            if (opened) {
                              setOpenNotePath(tab.path)
                            } else {
                              closeTab(tab.path)
                              await refreshTree()
                            }
                          }
                        }}
                        className={`tab-item ${isActive ? 'active' : ''}`}
                      >
                        <span className="tab-title truncate">
                          {isDirty && <span className="tab-dirty">● </span>}
                          {tab.title}
                        </span>
                        <span
                          className="tab-close"
                          onClick={(e) => { e.stopPropagation(); handleCloseTab(tab.path) }}
                        >
                          <X className="w-3 h-3" />
                        </span>
                      </button>
                    )
                  })}
                </div>
              )}

              {/* Editor header */}
              <div className="flex items-center gap-3 px-4 py-2 border-b border-surface-200 bg-surface-50">
                <button
                  onClick={handleCloseNote}
                  className="p-1 hover:bg-surface-200 rounded transition-colors"
                  title="关闭笔记"
                >
                  <ArrowLeft className="w-4 h-4 text-surface-500" />
                </button>
                {renamingTitle ? (
                  <input
                    autoFocus
                    value={titleDraft}
                    onChange={(event) => setTitleDraft(event.target.value)}
                    onBlur={submitTitleRename}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') submitTitleRename()
                      if (event.key === 'Escape') {
                        setTitleDraft(currentMeta.title)
                        setRenamingTitle(false)
                      }
                    }}
                    className="min-w-48 rounded-md border border-accent-300 bg-white px-2 py-1 text-sm font-medium text-surface-700 outline-none"
                  />
                ) : (
                  <button
                    onDoubleClick={() => setRenamingTitle(true)}
                    className="rounded px-1 text-sm font-medium text-surface-700 hover:bg-surface-100"
                    title="F2 重命名"
                  >
                    {currentMeta.title}
                  </button>
                )}
                <button
                  onClick={async () => {
                    try {
                      // 1. Resolve vault asset images to base64 data URLs
                      const assetRe = /!\[([^\]]*)\]\(([^)]+)\)/g
                      let resolvedMd = currentContent
                      const promises: Promise<void>[] = []
                      for (const match of currentContent.matchAll(assetRe)) {
                        const url = match[2]
                        const normalized = url.replace(/\\/g, '/').replace(/^\.\//, '')
                        if (normalized.startsWith('assets/')) {
                          promises.push(
                            window.mynote.assets.readDataUrl(normalized).then(dataUrl => {
                              resolvedMd = resolvedMd.replace(url, dataUrl)
                            }).catch(() => {})
                          )
                        }
                      }
                      await Promise.all(promises)

                      // 2. Convert markdown → HTML using marked
                      const { marked } = await import('marked')
                      const body = marked.parse(resolvedMd) as string

                      // 3. Build complete HTML document
                      const title = htmlEscape(currentMeta.title)
                      const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title></title>
<style>
  @page { margin: 2.2cm; size: A4; }
  @page { @top-left     { content: ""; } }
  @page { @top-center   { content: ""; } }
  @page { @top-right    { content: ""; } }
  @page { @bottom-left  { content: ""; } }
  @page { @bottom-center { content: counter(page) " / " counter(pages); font-size: 9pt; color: #8a9097; } }
  @page { @bottom-right { content: ""; } }
  body {
    font-family: "Noto Serif CJK SC", "Source Han Serif SC", "Microsoft YaHei", Georgia, serif;
    font-size: 14px; line-height: 1.92; color: #24272b;
    max-width: 760px; margin: 0 auto; padding: 0;
  }
  h1 { font-size: 2em; font-weight: 650; margin: 0 0 0.8em; border-bottom: 1px solid #dfe4e1; }
  h2 { font-size: 1.45em; margin: 1.6em 0 0.6em; }
  h3 { font-size: 1.2em; margin: 1.3em 0 0.5em; }
  h4 { font-size: 1em; color: #8a9097; text-transform: uppercase; letter-spacing: 0.08em; }
  h5 { font-size: 0.9em; color: #8a9097; text-transform: uppercase; letter-spacing: 0.08em; }
  h6 { font-size: 0.82em; color: #8a9097; text-transform: uppercase; letter-spacing: 0.08em; }
  p { margin: 0.8em 0; }
  a { color: #3b82f6; text-decoration: none; }
  code { font-family: "JetBrains Mono", "Consolas", monospace; font-size: 0.88em; padding: 0.12em 0.38em; background: #f2f5f4; border-radius: 4px; }
  pre { margin: 1.2em 0; padding: 1em; background: #202326; color: #eef2f2; border-radius: 8px; overflow-x: auto; white-space: pre-wrap; word-wrap: break-word; }
  pre code { padding: 0; background: transparent; color: inherit; }
  blockquote { margin: 0.9em 0; padding: 0.08em 0 0.08em 1.4em; border-left: 3px solid #aeb8b4; color: #464a50; font-style: italic; }
  blockquote p { margin: 0.4em 0; }
  ul, ol { margin: 0.8em 0; padding-left: 1.65em; }
  li { margin: 0.3em 0; }
  hr { height: 1px; margin: 2em 0; border: 0; background: linear-gradient(90deg, transparent, #dfe4e1 16%, #dfe4e1 84%, transparent); }
  table { width: 100%; border-collapse: collapse; margin: 1em 0; }
  th, td { border: 1px solid #dfe4e1; padding: 0.55em 0.75em; text-align: left; }
  th { background: #f6f8f7; font-weight: 600; }
  img { display: block; max-width: 100%; height: auto; margin: 1.5em auto; border-radius: 6px; }
  input[type="checkbox"] { margin-right: 0.4em; }
  del { text-decoration: line-through; color: #8a9097; }
  strong { font-weight: 600; }
</style>
</head>
<body>
${body}
</body>
</html>`

                      // 4. Send to backend for PDF generation
                      const r = await window.mynote.export.htmlToPdf(html, currentMeta.title)
                      if (r.success) {
                        if (confirm(`PDF 已导出: ${r.output}\n\n是否打开所在文件夹？`)) {
                          const dir = r.output.replace(/[/\\][^/\\]*$/, '')
                          await window.mynote.vault.openInExplorer(dir)
                        }
                      } else {
                        alert(`导出失败: ${r.output}`)
                      }
                    } catch { alert('导出失败') }
                  }}
                  className="text-xs text-surface-500 hover:text-accent-600 font-medium px-2 py-1 rounded hover:bg-surface-100 transition-colors ml-auto"
                  title="导出 PDF"
                >
                  📄 导出
                </button>
                {/* Outline/AI tabs — inline in header when panel is open */}
                {outlineOpen && (
                  <div className="editor-side-tabs-inline">
                    <button
                      onClick={() => setRightPanelTab('outline')}
                      className={`editor-side-tab ${rightPanelTab === 'outline' ? 'active' : ''}`}
                      title="大纲"
                    >
                      <ListTree className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => setRightPanelTab('ai')}
                      className={`editor-side-tab ${rightPanelTab === 'ai' ? 'active' : ''}`}
                      title="AI"
                    >
                      <Bot className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
                {/* Outline toggle */}
                <button
                  onClick={() => setOutlineOpen(!outlineOpen)}
                  className="p-1 hover:bg-surface-200 rounded transition-colors"
                  title={outlineOpen ? '折叠右侧栏' : '展开右侧栏'}
                >
                  {outlineOpen ? <PanelRightClose className="w-3.5 h-3.5 text-surface-500" /> : <PanelRightOpen className="w-3.5 h-3.5 text-surface-500" />}
                </button>
              </div>

              {/* Editor + Outline */}
              <div className="flex-1 min-h-0 flex">
                {/* Editor */}
                <div className="flex-1 min-w-0 overflow-auto">
                  <MilkdownEditor
                    key={`${currentMeta.path}:${editorRevision}`}
                    content={currentContent}
                    onContentChange={(markdown) => setContent(markdown)}
                    onSelectionChange={setAgentSelection}
                    onNavigate={async (pageName: string) => {
                      try {
                        const allNotes = await window.mynote.notes.list()
                        const name = pageName.toLowerCase().replace(/\.md$/i, '')
                        const exact = allNotes.find((n: any) =>
                          n.path.toLowerCase() === pageName ||
                          n.path.toLowerCase() === pageName + '.md'
                        )
                        const byName = allNotes.find((n: any) => {
                          const fname = n.path.split('/').pop()?.replace(/\.md$/i, '')?.toLowerCase()
                          return fname === name
                        })
                        const target = exact || byName
                        if (target) {
                          await saveNote()
                          const opened = await openNote(target.path)
                          if (opened) setOpenNotePath(target.path)
                        } else {
                          const newNote = await window.mynote.notes.create('notes', pageName)
                          if (newNote) {
                            await saveNote()
                            const opened = await openNote(newNote.path)
                            if (opened) setOpenNotePath(newNote.path)
                          }
                        }
                      } catch (err) {
                        console.error('Failed to navigate wikilink:', err)
                      }
                    }}
                    onTagClick={async (tag: string) => {
                      await saveNote()
                      setKnowledgeTag(tag)
                      setActiveView('knowledge')
                    }}
                  />
                </div>

                {/* Shared right sidebar */}
                {outlineOpen && (
                  <>
                    <div
                      className="w-1 cursor-col-resize hover:bg-accent-400/40 active:bg-accent-400/60 transition-colors flex-shrink-0"
                      onMouseDown={() => setResizeTarget('outline')}
                    />
                    <aside className="editor-side-panel" style={{ width: outlineWidth }}>
                      <div className="editor-side-content">
                        {rightPanelTab === 'outline' ? (
                          <OutlineSidebar content={currentContent} embedded />
                        ) : (
                          <AgentSidebar
                            mode="editor"
                            currentNote={currentMeta}
                            currentContent={currentContent}
                            selectedText={agentSelection?.text ?? ''}
                            linkedNoteContents={linkedNoteContents}
                            contextLoading={linkedNotesLoading}
                            onApplyDraft={handleApplyAgentDraft}
                          />
                        )}
                      </div>
                    </aside>
                  </>
                )}
              </div>
            </div>
          ) : (
            <>
              {activeView === 'dashboard' && <Dashboard />}
              {activeView === 'diary' && <DiaryView />}
              {activeView === 'todo' && <TodoView />}
              {activeView === 'knowledge' && <KnowledgeView />}
            </>
          )}
        </div>
      </div>
      <StatusBar />
    </div>
  )
}

export default App
