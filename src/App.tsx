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

function App() {
  const activeView = useUIStore((s) => s.activeView)
  const openNotePath = useUIStore((s) => s.openNotePath)
  const setActiveView = useUIStore((s) => s.setActiveView)
  const setOpenNotePath = useUIStore((s) => s.setOpenNotePath)

  const currentMeta = useNoteStore((s) => s.currentMeta)
  const currentContent = useNoteStore((s) => s.currentContent)
  const setContent = useNoteStore((s) => s.setContent)
  const saveNote = useNoteStore((s) => s.saveNote)
  const closeNote = useNoteStore((s) => s.closeNote)

  const vaultPath = useVaultStore((s) => s.vaultPath)
  const setVaultPath = useVaultStore((s) => s.setVaultPath)

  const [vaultReady, setVaultReady] = useState(false)
  const [loading, setLoading] = useState(true)

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
      await window.mynote.notes.write(filePath, content)
      try {
        await window.mynote.todos.extract(filePath, content)
      } catch {
        // Todos extraction will be fully implemented in Phase 4
      }
    },
    []
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

  // If a note is open, show the editor
  const isEditing = openNotePath && currentMeta

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
                <span className="text-sm font-medium text-surface-700">
                  {currentMeta.title}
                </span>
                <span className="text-xs text-surface-400 ml-auto">
                  {currentMeta.path}
                </span>
              </div>
              {/* Editor — key ensures remount when switching notes */}
              <div className="flex-1 overflow-auto">
                <MilkdownEditor
                  key={currentMeta.path}
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
