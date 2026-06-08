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
} from 'lucide-react'
import { useUIStore, type ActiveView } from '../../stores/uiStore'
import { useVaultStore } from '../../stores/vaultStore'
import { useNoteStore } from '../../stores/noteStore'
import { useEffect, useState } from 'react'
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

  const openNote = useNoteStore((s) => s.openNote)

  useEffect(() => {
    if (vaultPath) {
      refreshTree()
    }
  }, [vaultPath])

  const handleOpenNote = async (filePath: string) => {
    await openNote(filePath)
    setOpenNotePath(filePath)
  }

  const handleCreateNote = () => {
    const name = prompt('笔记名称（不含扩展名）:')
    if (name) {
      createNote('notes', name)
    }
  }

  const handleDeleteNote = (filePath: string) => {
    if (confirm(`确定删除 "${filePath}" 吗？`)) {
      deleteNote(filePath)
    }
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
          <button
            onClick={handleCreateNote}
            className="p-0.5 hover:bg-surface-100 rounded transition-colors"
            title="新建笔记"
          >
            <Plus className="w-3.5 h-3.5 text-surface-400" />
          </button>
        </div>

        {tree.length === 0 ? (
          <div className="text-xs text-surface-400 px-2 py-2">暂无笔记</div>
        ) : (
          <FileTreeView
            nodes={tree}
            depth={0}
            onOpen={handleOpenNote}
            onDelete={handleDeleteNote}
          />
        )}
      </div>
    </div>
  )
}

function FileTreeView({
  nodes,
  depth,
  onOpen,
  onDelete,
}: {
  nodes: FileTreeNode[]
  depth: number
  onOpen: (path: string) => void
  onDelete: (path: string) => void
}) {
  return (
    <>
      {nodes.map((node) => (
        <FileTreeItem
          key={node.path}
          node={node}
          depth={depth}
          onOpen={onOpen}
          onDelete={onDelete}
        />
      ))}
    </>
  )
}

function FileTreeItem({
  node,
  depth,
  onOpen,
  onDelete,
}: {
  node: FileTreeNode
  depth: number
  onOpen: (path: string) => void
  onDelete: (path: string) => void
}) {
  const [expanded, setExpanded] = useState(depth < 1)

  if (node.type === 'directory') {
    return (
      <div>
        <button
          onClick={() => setExpanded(!expanded)}
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
            onDelete={onDelete}
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
    >
      <FileText className="w-3 h-3 flex-shrink-0 text-surface-400" />
      <span className="truncate flex-1">{node.name.replace('.md', '')}</span>
      <button
        onClick={(e) => {
          e.stopPropagation()
          onDelete(node.path)
        }}
        className="opacity-0 group-hover:opacity-100 p-0.5 hover:bg-red-100 rounded transition-all"
        title="删除"
      >
        <Trash2 className="w-3 h-3 text-red-400" />
      </button>
    </div>
  )
}
