import { useUIStore } from './stores/uiStore'
import Titlebar from './components/layout/Titlebar'
import Sidebar from './components/layout/Sidebar'
import StatusBar from './components/layout/StatusBar'
import Dashboard from './components/dashboard/Dashboard'
import DiaryView from './components/diary/DiaryView'
import TodoView from './components/todo/TodoView'
import KnowledgeView from './components/knowledge/KnowledgeView'
import VaultPrompt from './components/layout/VaultPrompt'
import { useState, useEffect } from 'react'

function App() {
  const activeView = useUIStore((s) => s.activeView)
  const [vaultReady, setVaultReady] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function checkVault() {
      try {
        const vaultPath = await window.mynote.vault.getPath()
        if (vaultPath) {
          setVaultReady(true)
        }
      } catch {
        // No vault selected yet
      } finally {
        setLoading(false)
      }
    }
    checkVault()
  }, [])

  const handleVaultSelect = async () => {
    const vaultPath = await window.mynote.vault.select()
    if (vaultPath) {
      await window.mynote.vault.init(vaultPath)
      setVaultReady(true)
    }
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

  return (
    <div className="app-container">
      <Titlebar />
      <div className="main-layout">
        <Sidebar />
        <div className="content-area">
          {activeView === 'dashboard' && <Dashboard />}
          {activeView === 'diary' && <DiaryView />}
          {activeView === 'todo' && <TodoView />}
          {activeView === 'knowledge' && <KnowledgeView />}
        </div>
      </div>
      <StatusBar />
    </div>
  )
}

export default App
