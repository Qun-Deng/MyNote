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

type FileDialogMode = 'new-note' | 'new-folder'

interface FileDialogState {
  mode: FileDialogMode
  targetPath: string
  initialValue: string
}

const navItems: { id: ActiveView; label: string; icon: React.ReactNode }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: <LayoutDashboard className="w-4 h-4" /> },
  { id: 'diary', label: '日记', icon: <Calendar className="w-4 h-4" /> },
  { id: 'todo', label: '待办', icon: <CheckSquare className="w-4 h-4" /> },
  { id: 'knowledge', label: '知识库', icon: <Library className="w-4 h-4" /> },
]

function joinPath(parentPath: string, name: string) {
  return parentPath ? `${parentPath}/${name}` : name
}

function getRenamedPath(targetPath: string, nextName: string) {
  const cleanName = nextName.trim()
  const parts = targetPath.split('/')
  const currentName = parts[parts.length - 1]
  const isMarkdown = currentName.toLowerCase().endsWith('.md')
  parts[parts.length - 1] =
    isMarkdown && !cleanName.toLowerCase().endsWith('.md') ? `${cleanName}.md` : cleanName
  return parts.join('/')
}

function getTitleFromMarkdownPath(filePath: string) {
  return filePath.split('/').pop()?.replace(/\.md$/i, '') || 'Untitled'
}

function replaceMarkdownTitle(content: string, title: string) {
  const nextTitle = `# ${title}`
  if (/^#\s+.*$/m.test(content)) {
    return content.replace(/^#\s+.*$/m, nextTitle)
  }
  return `${nextTitle}\n\n${content.trimStart()}`
}

async function runFileAction(action: () => Promise<void>) {
  try {
    await action()
  } catch (err) {
    console.error('File action failed:', err)
    alert(err instanceof Error ? err.message : '文件操作失败')
  }
}

export default function Sidebar() {
  const activeView = useUIStore((s) => s.activeView)
  const setActiveView = useUIStore((s) => s.setActiveView)
  const setOpenNotePath = useUIStore((s) => s.setOpenNotePath)
  const searchOpen = useUIStore((s) => s.searchOpen)
  const setSearchOpen = useUIStore((s) => s.setSearchOpen)

  const tree = useVaultStore((s) => s.tree)
  const refreshTree = useVaultStore((s) => s.refreshTree)
  const vaultPath = useVaultStore((s) => s.vaultPath)

  const theme = useThemeStore((s) => s.theme)
  const toggleTheme = useThemeStore((s) => s.toggleTheme)

  const openNote = useNoteStore((s) => s.openNote)
  const currentMeta = useNoteStore((s) => s.currentMeta)
  const currentContent = useNoteStore((s) => s.currentContent)
  const setContent = useNoteStore((s) => s.setContent)
  const updateCurrentMeta = useNoteStore((s) => s.updateCurrentMeta)

  const [plusMenuOpen, setPlusMenuOpen] = useState(false)
  const [fileDialog, setFileDialog] = useState<FileDialogState | null>(null)
  const [fileDialogValue, setFileDialogValue] = useState('')
  const [renamingPath, setRenamingPath] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const plusRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  const openFileDialog = useCallback((mode: FileDialogMode, targetPath: string, initialValue = '') => {
    setPlusMenuOpen(false)
    setFileDialog({ mode, targetPath, initialValue })
    setFileDialogValue(initialValue)
  }, [])

  const closeFileDialog = useCallback(() => {
    setFileDialog(null)
    setFileDialogValue('')
  }, [])

  const submitFileDialog = useCallback(async () => {
    if (!fileDialog) return
    const value = fileDialogValue.trim()
    if (!value) return

    await runFileAction(async () => {
      switch (fileDialog.mode) {
        case 'new-note':
          await window.mynote.notes.create(fileDialog.targetPath || 'notes', value)
          break
        case 'new-folder':
          await window.mynote.vault.createFolder(joinPath(fileDialog.targetPath, value))
          break
      }
      await refreshTree()
    })
    closeFileDialog()
  }, [closeFileDialog, fileDialog, fileDialogValue, refreshTree])

  const startInlineRename = useCallback((targetPath: string) => {
    setRenamingPath(targetPath)
    setRenameValue(targetPath.split('/').pop() ?? '')
  }, [])

  const cancelInlineRename = useCallback(() => {
    setRenamingPath(null)
    setRenameValue('')
  }, [])

  const moveMarkdownFile = useCallback(async (filePath: string, targetFolderPath: string) => {
    if (!filePath.toLowerCase().endsWith('.md')) return
    const fileName = filePath.split('/').pop()
    if (!fileName) return
    const nextPath = joinPath(targetFolderPath, fileName)
    if (nextPath === filePath) return

    await runFileAction(async () => {
      const normalizedPath = await window.mynote.notes.rename(filePath, nextPath)
      if (currentMeta?.path === filePath) {
        setOpenNotePath(normalizedPath)
        updateCurrentMeta({ path: normalizedPath })
      }
      await refreshTree()
    })
  }, [currentMeta?.path, refreshTree, setOpenNotePath, updateCurrentMeta])

  const submitInlineRename = useCallback(async () => {
    if (!renamingPath) return
    const value = renameValue.trim()
    if (!value) return

    const nextPath = getRenamedPath(renamingPath, value)
    await runFileAction(async () => {
      if (renamingPath.toLowerCase().endsWith('.md')) {
        const normalizedPath = await window.mynote.notes.rename(renamingPath, nextPath)
        const nextTitle = getTitleFromMarkdownPath(normalizedPath)
        if (currentMeta?.path === renamingPath) {
          const nextContent = replaceMarkdownTitle(currentContent, nextTitle)
          await window.mynote.notes.write(normalizedPath, nextContent)
          setContent(nextContent)
          setOpenNotePath(normalizedPath)
          updateCurrentMeta({ path: normalizedPath, title: nextTitle })
        } else {
          const result = await window.mynote.notes.read(normalizedPath)
          if (result) {
            await window.mynote.notes.write(
              normalizedPath,
              replaceMarkdownTitle(result.content, nextTitle)
            )
          }
        }
      } else {
        await window.mynote.vault.move(renamingPath, nextPath)
      }
      await refreshTree()
    })
    cancelInlineRename()
  }, [
    cancelInlineRename,
    currentMeta,
    currentContent,
    refreshTree,
    renameValue,
    renamingPath,
    setContent,
    setOpenNotePath,
    updateCurrentMeta,
  ])

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
          openFileDialog('new-note', targetPath || 'notes')
          break
        }
        case 'new-folder': {
          openFileDialog('new-folder', targetPath)
          break
        }
        case 'rename': {
          if (!targetPath) break
          startInlineRename(targetPath)
          break
        }
        case 'delete': {
          if (confirm(`确定删除 "${targetPath}" 吗？此操作不可撤销。`)) {
            await runFileAction(async () => {
              await window.mynote.vault.deleteItem(targetPath)
              await refreshTree()
            })
          }
          break
        }
      }
    })
    return cleanup
  }, [openFileDialog, refreshTree, startInlineRename])

  useEffect(() => {
    if (vaultPath) refreshTree()
  }, [vaultPath])

  const handleOpenNote = async (filePath: string) => {
    await openNote(filePath)
    setOpenNotePath(filePath)
  }

  const handleNewNote = (folderPath: string) => {
    openFileDialog('new-note', folderPath || 'notes')
  }

  const handleNewFolder = async (parentPath: string) => {
    openFileDialog('new-folder', parentPath)
  }

  const handleContextMenu = (e: React.MouseEvent, nodePath: string, nodeType: 'file' | 'directory') => {
    e.preventDefault()
    e.stopPropagation()
    window.mynote.vault.showContextMenu(nodePath, nodeType)
  }

  const handleRootContextMenu = (e: React.MouseEvent) => {
    e.preventDefault()
    window.mynote.vault.showContextMenu('', 'directory')
  }

  const handleRootDragOver = (e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes('text/plain')) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
  }

  const handleRootDrop = (e: React.DragEvent) => {
    e.preventDefault()
    const filePath = e.dataTransfer.getData('text/plain')
    if (filePath) void moveMarkdownFile(filePath, '')
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
      <div
        className="flex-1 overflow-auto px-3 pb-3"
        onContextMenu={handleRootContextMenu}
        onDragOver={handleRootDragOver}
        onDrop={handleRootDrop}
      >
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
            onRefresh={refreshTree}
            renamingPath={renamingPath}
            renameValue={renameValue}
            onRenameChange={setRenameValue}
            onRenameSubmit={submitInlineRename}
            onRenameCancel={cancelInlineRename}
            onMoveMarkdownFile={moveMarkdownFile}
          />
        )}
      </div>

      {fileDialog && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/20 px-4"
          onMouseDown={closeFileDialog}
        >
          <div
            className="w-80 rounded-lg border border-surface-200 bg-white p-4 shadow-xl"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <h3 className="text-sm font-semibold text-surface-800">
              {fileDialog.mode === 'new-note'
                ? '新建笔记'
                : fileDialog.mode === 'new-folder'
                  ? '新建文件夹'
                  : '重命名'}
            </h3>
            <input
              autoFocus
              value={fileDialogValue}
              onChange={(e) => setFileDialogValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submitFileDialog()
                if (e.key === 'Escape') closeFileDialog()
              }}
              placeholder={fileDialog.mode === 'new-folder' ? '文件夹名称' : '笔记名称'}
              className="mt-3 w-full rounded-md border border-surface-300 px-3 py-2 text-sm outline-none focus:border-accent-400"
            />
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={closeFileDialog}
                className="rounded-md px-3 py-1.5 text-sm text-surface-500 hover:bg-surface-100"
              >
                取消
              </button>
              <button
                onClick={submitFileDialog}
                disabled={!fileDialogValue.trim()}
                className="rounded-md bg-accent-600 px-3 py-1.5 text-sm text-white hover:bg-accent-700 disabled:opacity-40"
              >
                确定
              </button>
            </div>
          </div>
        </div>
      )}

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
  onRefresh,
  renamingPath,
  renameValue,
  onRenameChange,
  onRenameSubmit,
  onRenameCancel,
  onMoveMarkdownFile,
}: {
  nodes: FileTreeNode[]
  depth: number
  onOpen: (path: string) => void
  onContextMenu: (e: React.MouseEvent, path: string, type: 'file' | 'directory') => void
  onRefresh: () => Promise<void>
  renamingPath: string | null
  renameValue: string
  onRenameChange: (value: string) => void
  onRenameSubmit: () => void
  onRenameCancel: () => void
  onMoveMarkdownFile: (filePath: string, targetFolderPath: string) => void
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
          onRefresh={onRefresh}
          renamingPath={renamingPath}
          renameValue={renameValue}
          onRenameChange={onRenameChange}
          onRenameSubmit={onRenameSubmit}
          onRenameCancel={onRenameCancel}
          onMoveMarkdownFile={onMoveMarkdownFile}
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
  onRefresh,
  renamingPath,
  renameValue,
  onRenameChange,
  onRenameSubmit,
  onRenameCancel,
  onMoveMarkdownFile,
}: {
  node: FileTreeNode
  depth: number
  onOpen: (path: string) => void
  onContextMenu: (e: React.MouseEvent, path: string, type: 'file' | 'directory') => void
  onRefresh: () => Promise<void>
  renamingPath: string | null
  renameValue: string
  onRenameChange: (value: string) => void
  onRenameSubmit: () => void
  onRenameCancel: () => void
  onMoveMarkdownFile: (filePath: string, targetFolderPath: string) => void
}) {
  const [expanded, setExpanded] = useState(depth < 1)

  if (node.type === 'directory') {
    return (
      <div>
        <button
          onClick={() => setExpanded(!expanded)}
          onContextMenu={(e) => onContextMenu(e, node.path, 'directory')}
          onDragOver={(e) => {
            e.stopPropagation()
            if (e.dataTransfer.types.includes('text/plain')) {
              e.preventDefault()
              e.dataTransfer.dropEffect = 'move'
            }
          }}
          onDrop={(e) => {
            e.stopPropagation()
            e.preventDefault()
            const filePath = e.dataTransfer.getData('text/plain')
            if (filePath) onMoveMarkdownFile(filePath, node.path)
          }}
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
          {renamingPath === node.path ? (
            <input
              autoFocus
              value={renameValue}
              onChange={(e) => onRenameChange(e.target.value)}
              onClick={(e) => e.stopPropagation()}
              onBlur={onRenameSubmit}
              onKeyDown={(e) => {
                if (e.key === 'Enter') onRenameSubmit()
                if (e.key === 'Escape') onRenameCancel()
              }}
              className="min-w-0 flex-1 rounded border border-accent-300 bg-white px-1 py-0.5 text-xs text-surface-700 outline-none"
            />
          ) : (
            <span className="truncate">{node.name}</span>
          )}
        </button>
        {expanded && node.children && (
          <FileTreeView
            nodes={node.children}
            depth={depth + 1}
            onOpen={onOpen}
            onContextMenu={onContextMenu}
            onRefresh={onRefresh}
            renamingPath={renamingPath}
            renameValue={renameValue}
            onRenameChange={onRenameChange}
            onRenameSubmit={onRenameSubmit}
            onRenameCancel={onRenameCancel}
            onMoveMarkdownFile={onMoveMarkdownFile}
          />
        )}
      </div>
    )
  }

  return (
    <div
      draggable={node.path.toLowerCase().endsWith('.md')}
      className="group flex items-center gap-2 px-2 py-1 text-xs text-surface-600
                 hover:bg-surface-100 rounded transition-colors cursor-pointer"
      style={{ paddingLeft: `${8 + depth * 12}px` }}
      onClick={() => onOpen(node.path)}
      onContextMenu={(e) => onContextMenu(e, node.path, 'file')}
      onDragStart={(e) => {
        e.dataTransfer.setData('text/plain', node.path)
        e.dataTransfer.effectAllowed = 'move'
      }}
    >
      <FileText className="w-3 h-3 flex-shrink-0 text-surface-400" />
      {renamingPath === node.path ? (
        <input
          autoFocus
          value={renameValue}
          onChange={(e) => onRenameChange(e.target.value)}
          onClick={(e) => e.stopPropagation()}
          onBlur={onRenameSubmit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onRenameSubmit()
            if (e.key === 'Escape') onRenameCancel()
          }}
          className="min-w-0 flex-1 rounded border border-accent-300 bg-white px-1 py-0.5 text-xs text-surface-700 outline-none"
        />
      ) : (
        <span className="truncate flex-1">{node.name.replace(/\.md$/i, '')}</span>
      )}
      <button
        onClick={(e) => {
          e.stopPropagation()
          if (confirm(`确定删除 "${node.name}" 吗？`)) {
            runFileAction(async () => {
              await window.mynote.vault.deleteItem(node.path)
              await onRefresh()
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
