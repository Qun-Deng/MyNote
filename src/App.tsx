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
import { useAutoSave } from './components/editor/useAutoSave'
import VaultPrompt from './components/layout/VaultPrompt'
import { useState, useEffect, useCallback, useRef } from 'react'
import { ArrowLeft, X, PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen } from 'lucide-react'

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
  const prevActiveTabRef = useRef<string | null>(null)

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

  const submitTitleRename = useCallback(() => {
    if (!currentMeta) return
    const nextTitle = titleDraft.trim()
    if (!nextTitle) return
    if (nextTitle !== currentMeta.title) {
      const nextContent = replaceMarkdownTitle(currentContent, nextTitle)
      setContent(nextContent)
      updateCurrentMeta({ title: nextTitle })
      setEditorRevision((revision) => revision + 1)
    }
    setRenamingTitle(false)
  }, [currentContent, currentMeta, setContent, titleDraft, updateCurrentMeta])

  useEffect(() => {
    setTitleDraft(currentMeta?.title ?? '')
    setRenamingTitle(false)
  }, [currentMeta?.path, currentMeta?.title])

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
        {sidebarOpen && <Sidebar />}
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
                      const r = await window.mynote.export.pdf(currentContent, currentMeta.title)
                      if (r.success) alert(`已导出: ${r.output}`)
                      else if (r.output !== 'Cancelled') alert(`导出失败: ${r.output}`)
                    } catch { alert('导出失败') }
                  }}
                  className="text-xs text-surface-500 hover:text-accent-600 font-medium px-2 py-1 rounded hover:bg-surface-100 transition-colors ml-auto"
                  title="导出 PDF"
                >
                  📄 导出
                </button>
                <span className="text-xs text-surface-400">{currentMeta.path}</span>
                {/* Outline toggle */}
                <button
                  onClick={() => setOutlineOpen(!outlineOpen)}
                  className="p-1 hover:bg-surface-200 rounded transition-colors"
                  title={outlineOpen ? '折叠大纲' : '展开大纲'}
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

                {/* Outline sidebar */}
                {outlineOpen && <OutlineSidebar content={currentContent} />}
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
