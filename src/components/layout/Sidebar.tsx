import {
  LayoutDashboard,
  Calendar,
  CheckSquare,
  Library,
  FolderOpen,
  Plus,
  Search,
} from 'lucide-react'
import { useUIStore, type ActiveView } from '../../stores/uiStore'

const navItems: { id: ActiveView; label: string; icon: React.ReactNode }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: <LayoutDashboard className="w-4 h-4" /> },
  { id: 'diary', label: '日记', icon: <Calendar className="w-4 h-4" /> },
  { id: 'todo', label: '待办', icon: <CheckSquare className="w-4 h-4" /> },
  { id: 'knowledge', label: '知识库', icon: <Library className="w-4 h-4" /> },
]

export default function Sidebar() {
  const activeView = useUIStore((s) => s.activeView)
  const setActiveView = useUIStore((s) => s.setActiveView)
  const searchOpen = useUIStore((s) => s.searchOpen)
  const setSearchOpen = useUIStore((s) => s.setSearchOpen)

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
      <nav className="flex-1 py-1">
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

        {/* File Tree Section (placeholder) */}
        <div className="mt-4 mx-3">
          <div className="flex items-center justify-between mb-2 px-2">
            <div className="flex items-center gap-1.5 text-xs font-medium text-surface-500 uppercase tracking-wider">
              <FolderOpen className="w-3.5 h-3.5" />
              文件夹
            </div>
            <button className="p-0.5 hover:bg-surface-100 rounded transition-colors">
              <Plus className="w-3.5 h-3.5 text-surface-400" />
            </button>
          </div>
          <div className="text-xs text-surface-400 px-2 py-2">
            暂无笔记
          </div>
        </div>
      </nav>
    </div>
  )
}
