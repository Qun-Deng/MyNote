import {
  LayoutDashboard,
  Calendar,
  CheckSquare,
  Library,
  FolderOpen,
  Plus,
  Search,
  FileText,
  ChevronRight,
  ChevronDown,
  Folder,
  Trash2,
  Sun,
  Moon,
  FilePlus,
  FolderPlus,
  Pencil,
} from 'lucide-react'
import { useUIStore, type ActiveView } from '../../stores/uiStore'
import { useVaultStore } from '../../stores/vaultStore'
import { useNoteStore } from '../../stores/noteStore'
import { useThemeStore } from '../../stores/themeStore'
import { useEffect, useState, useRef, useCallback } from 'react'
import type { FileTreeNode } from '../../../shared/types'

const navItems: { id: ActiveView; label: string; icon: React.ReactNode }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: <LayoutDashboard className="w-4 h-4" /> },
  { id: 'diary', label: '日记', icon: <Calendar className="w-4 h-4" /> },
  { id: 'todo', label: '待办', icon: <CheckSquare className="w-4 h-4" /> },
  { id: 'knowledge', label: '知识库', icon: <Library className="w-4 h-4" /> },
]

export default function Sidebar() {
  const activeView = useUIStore((s) => s.activeView)
  const setActiveView = useUIStore((s) => s.setActiveView)
  const setOpenNotePath = useUIStore((s) => s.setOpenNotePath)
  const searchOpen = useUIStore((s) => s.searchOpen)
  const setSearchOpen = useUIStore((s) => s.setSearchOpen)

  const tree = useVaultStore((s) => s.tree)
  const refreshTree = useVaultStore((s) => s.refreshTree)
  const createNote = useVaultStore((s) => s.createNote)
  const deleteNote = useVaultStore((s) => s.deleteNote)
  const vaultPath = useVaultStore((s) => s.vaultPath)

  const theme = useThemeStore((s) => s.theme)
  const toggleTheme = useThemeStore((s) => s.toggleTheme)

  const openNote = useNoteStore((s) => s.openNote)

  const [plusMenuOpen, setPlusMenuOpen] = useState(false)
  const plusRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  // Close [+] dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (
        plusMenuOpen &&
        menuRef.current &&
        !menuRef.current.contains(e.target as Node) &&
        plusRef.current &&
        !plusRef.current.contains(e.target as Node)
      ) {
        setPlusMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [plusMenuOpen])

  // Listen for context menu actions from main process
  useEffect(() => {
    const cleanup = window.mynote.vault.onContextMenuAction(async (action, targetPath) => {
      switch (action) {
        case 'new-note': {
          const name = prompt('笔记名称（不含扩展名）:')
          if (name) {
            await window.mynote.notes.create(targetPath, name)
            refreshTree()
          }
          break
        }
        case 'new-folder': {
          const name = prompt('文件夹名称:')
          if (name) {
            const folderPath = targetPath ? `${targetPath}/${name}` : name
            await window.mynote.vault.createFolder(folderPath)
            refreshTree()
          }
          break
        }
        case 'rename': {
          const newName = prompt('新名称:', targetPath.split('/').pop())
          if (newName) {
            const parts = targetPath.split('/')
            parts[parts.length - 1] = newName
            const newPath = parts.join('/')
            await window.mynote.notes.rename(targetPath, newPath)
            refreshTree()
          }
          break
        }
        case 'delete': {
          if (confirm(`确定删除 "${targetPath}" 吗？此操作不可撤销。`)) {
            await window.mynote.vault.deleteItem(targetPath)
            refreshTree()
          }
          break
        }
      }
    })
    return cleanup
  }, [refreshTree])

  useEffect(() => {
    if (vaultPath) refreshTree()
  }, [vaultPath])

  const handleOpenNote = async (filePath: string) => {
    await openNote(filePath)
    setOpenNotePath(filePath)
  }

  const handleNewNote = (folderPath: string) => {
    const name = prompt('笔记名称（不含扩展名）:')
    if (name) createNote(folderPath || 'notes', name)
  }

  const handleNewFolder = async (parentPath: string) => {
    const name = prompt('文件夹名称:')
    if (name) {
      const folderPath = parentPath ? `${parentPath}/${name}` : name
      await window.mynote.vault.createFolder(folderPath)
      refreshTree()
    }
  }

  const handleContextMenu = (e: React.MouseEvent, nodePath: string, nodeType: 'file' | 'directory') => {
    e.preventDefault()
    e.stopPropagation()
    window.mynote.vault.showContextMenu(nodePath, nodeType)
  }

  return (
    <div className="sidebar">
      {/* Quick Actions */}
      <div className="px-3 pt-3 pb-2">
        <button
          onClick={() => setSearchOpen(!searchOpen)}
          className="w-full flex items-center gap-2 px-3 py-1.5 rounded-md text-sm text-surface-500
                     bg-surface-100 hover:bg-surface-200 transition-colors"
        >
          <Search className="w-3.5 h-3.5" />
          <span className="text-xs">搜索笔记...</span>
          <kbd className="ml-auto text-[10px] bg-surface-200 px-1.5 py-0.5 rounded text-surface-400">
            Ctrl+K
          </kbd>
        </button>
      </div>

      {/* Navigation */}
      <nav className="py-1">
        {navItems.map((item) => (
          <button
            key={item.id}
            onClick={() => setActiveView(item.id)}
            className={`nav-item w-full ${activeView === item.id ? 'active' : ''}`}
          >
            <span className="nav-icon">{item.icon}</span>
            {item.label}
          </button>
        ))}
      </nav>

      {/* Divider */}
      <div className="mx-3 my-2 border-t border-surface-200" />

      {/* File Tree */}
      <div className="flex-1 overflow-auto px-3 pb-3">
        <div className="flex items-center justify-between mb-2 px-2">
          <div className="flex items-center gap-1.5 text-xs font-medium text-surface-500 uppercase tracking-wider">
            <FolderOpen className="w-3.5 h-3.5" />
            文件夹
          </div>

          {/* [+] Dropdown */}
          <div className="relative">
            <button
              ref={plusRef}
              onClick={() => setPlusMenuOpen(!plusMenuOpen)}
              className="p-0.5 hover:bg-surface-100 rounded transition-colors"
              title="新建"
            >
              <Plus className="w-3.5 h-3.5 text-surface-400" />
            </button>

            {plusMenuOpen && (
              <div
                ref={menuRef}
                className="absolute right-0 top-full mt-1 w-36 bg-white border border-surface-200
                           rounded-md shadow-lg py-1 z-50"
              >
                <button
                  onClick={() => { setPlusMenuOpen(false); handleNewNote('notes') }}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-surface-700
                             hover:bg-surface-50 transition-colors"
                >
                  <FilePlus className="w-3.5 h-3.5 text-surface-400" />
                  新建笔记
                </button>
                <button
                  onClick={() => { setPlusMenuOpen(false); handleNewFolder('') }}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-surface-700
                             hover:bg-surface-50 transition-colors"
                >
                  <FolderPlus className="w-3.5 h-3.5 text-surface-400" />
                  新建文件夹
                </button>
              </div>
            )}
          </div>
        </div>

        {tree.length === 0 ? (
          <div className="text-xs text-surface-400 px-2 py-2">
            暂无笔记
            <div className="mt-2 space-y-1">
              <button
                onClick={() => handleNewNote('notes')}
                className="block text-accent-600 hover:text-accent-700"
              >
                + 新建笔记
              </button>
              <button
                onClick={() => handleNewFolder('')}
                className="block text-accent-600 hover:text-accent-700"
              >
                + 新建文件夹
              </button>
            </div>
          </div>
        ) : (
          <FileTreeView
            nodes={tree}
            depth={0}
            onOpen={handleOpenNote}
            onContextMenu={handleContextMenu}
          />
        )}
      </div>

      {/* Theme Toggle */}
      <div className="px-3 pb-3 border-t border-surface-200 pt-2">
        <button
          onClick={toggleTheme}
          className="w-full flex items-center gap-2 px-2 py-1.5 text-xs text-surface-500
                     hover:bg-surface-100 rounded transition-colors"
        >
          {theme === 'light' ? (
            <>
              <Moon className="w-3.5 h-3.5" />
              暗色模式
            </>
          ) : (
            <>
              <Sun className="w-3.5 h-3.5" />
              亮色模式
            </>
          )}
        </button>
      </div>
    </div>
  )
}

function FileTreeView({
  nodes,
  depth,
  onOpen,
  onContextMenu,
}: {
  nodes: FileTreeNode[]
  depth: number
  onOpen: (path: string) => void
  onContextMenu: (e: React.MouseEvent, path: string, type: 'file' | 'directory') => void
}) {
  return (
    <>
      {nodes.map((node) => (
        <FileTreeItem
          key={node.path}
          node={node}
          depth={depth}
          onOpen={onOpen}
          onContextMenu={onContextMenu}
        />
      ))}
    </>
  )
}

function FileTreeItem({
  node,
  depth,
  onOpen,
  onContextMenu,
}: {
  node: FileTreeNode
  depth: number
  onOpen: (path: string) => void
  onContextMenu: (e: React.MouseEvent, path: string, type: 'file' | 'directory') => void
}) {
  const [expanded, setExpanded] = useState(depth < 1)

  if (node.type === 'directory') {
    return (
      <div>
        <button
          onClick={() => setExpanded(!expanded)}
          onContextMenu={(e) => onContextMenu(e, node.path, 'directory')}
          className="w-full flex items-center gap-1 px-2 py-1 text-xs text-surface-500
                     hover:bg-surface-100 rounded transition-colors"
          style={{ paddingLeft: `${8 + depth * 12}px` }}
        >
          {expanded ? (
            <ChevronDown className="w-3 h-3 flex-shrink-0" />
          ) : (
            <ChevronRight className="w-3 h-3 flex-shrink-0" />
          )}
          <Folder className="w-3 h-3 flex-shrink-0 text-amber-500" />
          <span className="truncate">{node.name}</span>
        </button>
        {expanded && node.children && (
          <FileTreeView
            nodes={node.children}
            depth={depth + 1}
            onOpen={onOpen}
            onContextMenu={onContextMenu}
          />
        )}
      </div>
    )
  }

  return (
    <div
      className="group flex items-center gap-2 px-2 py-1 text-xs text-surface-600
                 hover:bg-surface-100 rounded transition-colors cursor-pointer"
      style={{ paddingLeft: `${8 + depth * 12}px` }}
      onClick={() => onOpen(node.path)}
      onContextMenu={(e) => onContextMenu(e, node.path, 'file')}
    >
      <FileText className="w-3 h-3 flex-shrink-0 text-surface-400" />
      <span className="truncate flex-1">{node.name.replace('.md', '')}</span>
      <button
        onClick={(e) => {
          e.stopPropagation()
          if (confirm(`确定删除 "${node.name}" 吗？`)) {
            window.mynote.vault.deleteItem(node.path).then(() => {
              window.location.reload()
            })
          }
        }}
        className="opacity-0 group-hover:opacity-100 p-0.5 hover:bg-red-100 rounded transition-all"
        title="删除"
      >
        <Trash2 className="w-3 h-3 text-red-400" />
      </button>
    </div>
  )
}
