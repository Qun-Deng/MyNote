import { useUIStore } from './stores/uiStore'
import { useNoteStore } from './stores/noteStore'
import { useVaultStore } from './stores/vaultStore'
import Titlebar from './components/layout/Titlebar'
import Sidebar from './components/layout/Sidebar'
import StatusBar from './components/layout/StatusBar'
import Dashboard from './components/dashboard/Dashboard'
import DiaryView from './components/diary/DiaryView'
import TodoView from './components/todo/TodoView'
import KnowledgeView from './components/knowledge/KnowledgeView'
import MilkdownEditor from './components/editor/MilkdownEditor'
import { useAutoSave } from './components/editor/useAutoSave'
import VaultPrompt from './components/layout/VaultPrompt'
import { useState, useEffect, useCallback } from 'react'
import { ArrowLeft } from 'lucide-react'

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

function App() {
  const activeView = useUIStore((s) => s.activeView)
  const openNotePath = useUIStore((s) => s.openNotePath)
  const setActiveView = useUIStore((s) => s.setActiveView)
  const setOpenNotePath = useUIStore((s) => s.setOpenNotePath)

  const currentMeta = useNoteStore((s) => s.currentMeta)
  const currentContent = useNoteStore((s) => s.currentContent)
  const setContent = useNoteStore((s) => s.setContent)
  const updateCurrentMeta = useNoteStore((s) => s.updateCurrentMeta)
  const saveNote = useNoteStore((s) => s.saveNote)
  const closeNote = useNoteStore((s) => s.closeNote)

  const vaultPath = useVaultStore((s) => s.vaultPath)
  const setVaultPath = useVaultStore((s) => s.setVaultPath)
  const refreshTree = useVaultStore((s) => s.refreshTree)

  const [vaultReady, setVaultReady] = useState(false)
  const [loading, setLoading] = useState(true)
  const [renamingTitle, setRenamingTitle] = useState(false)
  const [titleDraft, setTitleDraft] = useState('')
  const [editorRevision, setEditorRevision] = useState(0)

  useEffect(() => {
    async function checkVault() {
      try {
        // 1. Try current session vault path
        let path = await window.mynote.vault.getPath()
        // 2. Try saved path from previous session
        if (!path) {
          path = await window.mynote.vault.getSavedPath()
        }
        if (path) {
          await window.mynote.vault.init(path)
          setVaultPath(path)
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
      setVaultReady(true)
    }
  }

  // Auto-save logic
  const handleSave = useCallback(
    async (filePath: string, content: string) => {
      let savedPath = filePath
      await window.mynote.notes.write(filePath, content)
      const title = extractMarkdownTitle(content)
      if (title && currentMeta && !currentMeta.is_diary) {
        const newPath = renamePathByTitle(filePath, title)
        if (newPath !== filePath) {
          try {
            const normalizedPath = await window.mynote.notes.rename(filePath, newPath)
            savedPath = normalizedPath
            setOpenNotePath(normalizedPath)
            updateCurrentMeta({ path: normalizedPath, title })
            await refreshTree()
          } catch (err) {
            console.error('Failed to rename note from title:', err)
          }
        } else if (title !== currentMeta.title) {
          updateCurrentMeta({ title })
        }
      }
      try {
        await window.mynote.todos.extract(savedPath, content)
      } catch {
        // Todos extraction will be fully implemented in Phase 4
      }
    },
    [currentMeta, refreshTree, setOpenNotePath, updateCurrentMeta]
  )

  const { flush } = useAutoSave({
    content: currentContent,
    filePath: currentMeta?.path ?? null,
    delay: 800,
    onSave: handleSave,
  })

  const handleCloseNote = async () => {
    await flush()
    closeNote()
    setOpenNotePath(null)
  }

  // If a note is open, show the editor
  const isEditing = openNotePath && currentMeta

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
        <Sidebar />
        <div className="content-area">
          {isEditing ? (
            <div className="h-full flex flex-col">
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
                <span className="text-xs text-surface-400">
                  {currentMeta.path}
                </span>
              </div>
              {/* Editor — key ensures remount when switching notes */}
              <div className="flex-1 min-h-0 overflow-auto">
                <MilkdownEditor
                  key={`${currentMeta.path}:${editorRevision}`}
                  content={currentContent}
                  onContentChange={(markdown) => setContent(markdown)}
                />
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
