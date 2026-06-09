import { useEffect, useState, useMemo, useCallback, useRef } from 'react'
import {
  Library, Search, FolderTree, Tag, FileText, Clock, X,
  ArrowUpDown, Plus, Archive, Pin, Trash2, CheckSquare,
  Square, History, Link2, Pencil, ChevronDown, MoreHorizontal
} from 'lucide-react'
import { format } from 'date-fns'
import type { NoteMeta, SearchResult, Backlink } from '../../../shared/types'
import { useNoteStore } from '../../stores/noteStore'
import { useUIStore } from '../../stores/uiStore'

// ── Recently Viewed (localStorage) ──

const RECENT_KEY = 'knowledge_recently_viewed'
const MAX_RECENT = 20

function loadRecentlyViewed(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY)
    return raw ? JSON.parse(raw) : []
  } catch { return [] }
}

function saveRecentlyViewed(paths: string[]) {
  localStorage.setItem(RECENT_KEY, JSON.stringify(paths))
}

function addRecentlyViewed(filePath: string) {
  const paths = loadRecentlyViewed().filter(p => p !== filePath)
  paths.unshift(filePath)
  saveRecentlyViewed(paths.slice(0, MAX_RECENT))
}

function isHiddenFolder(path: string) {
  return path === 'assets' || path.startsWith('assets/')
}

// ── Sort ──

type SortField = 'updated_at' | 'created_at' | 'title'
type SortDir = 'asc' | 'desc'

function sortNotes(notes: NoteMeta[], field: SortField, dir: SortDir): NoteMeta[] {
  return [...notes].sort((a, b) => {
    let cmp = 0
    if (field === 'title') {
      cmp = a.title.localeCompare(b.title, 'zh-CN')
    } else {
      cmp = new Date(a[field]).getTime() - new Date(b[field]).getTime()
    }
    return dir === 'desc' ? -cmp : cmp
  })
}

// ── Wikilink parser ──

function extractWikilinks(content: string): { target: string; context: string }[] {
  const links: { target: string; context: string }[] = []
  const regex = /\[\[([^\]|#]+)(?:[|#][^\]]+)?\]\]/g
  let match: RegExpExecArray | null
  while ((match = regex.exec(content)) !== null) {
    const target = match[1].trim()
    // Get surrounding context (up to 30 chars before and after)
    const start = Math.max(0, match.index - 20)
    const end = Math.min(content.length, match.index + match[0].length + 20)
    const context = content.slice(start, end).replace(/\n/g, ' ')
    links.push({ target, context })
  }
  return links
}

// ── Component ──

export default function KnowledgeView() {
  const [notes, setNotes] = useState<NoteMeta[]>([])
  const [allTags, setAllTags] = useState<string[]>([])
  const [activeTag, setActiveTag] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<SearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null)
  const [showArchived, setShowArchived] = useState(false)
  const [sortField, setSortField] = useState<SortField>('updated_at')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [sortMenuOpen, setSortMenuOpen] = useState(false)
  const [batchMode, setBatchMode] = useState(false)
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set())
  const [tagMenuOpen, setTagMenuOpen] = useState<string | null>(null)
  const [tagRename, setTagRename] = useState<string | null>(null)
  const [tagRenameValue, setTagRenameValue] = useState('')
  const [newNoteDialogOpen, setNewNoteDialogOpen] = useState(false)
  const [newNoteTitle, setNewNoteTitle] = useState('')
  const [newNoteFolder, setNewNoteFolder] = useState('notes')
  const [batchTagDialogOpen, setBatchTagDialogOpen] = useState(false)
  const [batchTagValue, setBatchTagValue] = useState('')
  const [recentlyViewed, setRecentlyViewed] = useState<string[]>([])
  const [backlinksFor, setBacklinksFor] = useState<string | null>(null)
  const [backlinks, setBacklinks] = useState<Backlink[]>([])

  const sortRef = useRef<HTMLDivElement>(null)
  const tagMenuRef = useRef<HTMLDivElement>(null)

  const openNote = useNoteStore((s) => s.openNote)
  const setOpenNotePath = useUIStore((s) => s.setOpenNotePath)
  const knowledgeTag = useUIStore((s) => s.knowledgeTag)
  const setKnowledgeTag = useUIStore((s) => s.setKnowledgeTag)

  // Sync global knowledgeTag → local activeTag (from editor #tag click)
  useEffect(() => {
    if (knowledgeTag !== null && knowledgeTag !== activeTag) {
      setActiveTag(knowledgeTag)
    }
  }, [knowledgeTag])

  // Sync local activeTag → global
  useEffect(() => {
    setKnowledgeTag(activeTag)
  }, [activeTag])

  // Load all notes and tags
  const loadData = useCallback(async () => {
    try {
      const [allNotes, tags] = await Promise.all([
        window.mynote.notes.list(),
        window.mynote.notes.tags(),
      ])
      setNotes(allNotes.filter((n: NoteMeta) => !n.is_diary))
      setAllTags(tags)
    } catch { console.error('Failed to load knowledge base data') }
  }, [])

  useEffect(() => {
    loadData()
    setRecentlyViewed(loadRecentlyViewed())
  }, [loadData])

  useEffect(() => {
    const cleanup = window.mynote.vault.onChanged(() => {
      void loadData()
      setRecentlyViewed(loadRecentlyViewed())
    })
    return cleanup
  }, [loadData])

  // Search
  useEffect(() => {
    if (!searchQuery.trim()) {
      setSearchResults([])
      return
    }
    const timer = setTimeout(async () => {
      setSearching(true)
      try {
        const results = await window.mynote.search.query(searchQuery)
        setSearchResults(results)
      } catch {
        setSearchResults([])
      } finally {
        setSearching(false)
      }
    }, 300)
    return () => clearTimeout(timer)
  }, [searchQuery])

  // Load backlinks when selected
  useEffect(() => {
    if (!backlinksFor) { setBacklinks([]); return }
    window.mynote.notes.backlinks(backlinksFor).then(setBacklinks).catch(() => setBacklinks([]))
  }, [backlinksFor])

  // Close sort menu on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (sortRef.current && !sortRef.current.contains(e.target as Node)) {
        setSortMenuOpen(false)
      }
      if (tagMenuRef.current && !tagMenuRef.current.contains(e.target as Node)) {
        setTagMenuOpen(null)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const handleOpenNote = async (filePath: string) => {
    const opened = await openNote(filePath)
    if (opened) {
      setOpenNotePath(filePath)
      addRecentlyViewed(filePath)
      setRecentlyViewed(loadRecentlyViewed())
    } else {
      await loadData()
    }
  }

  // Extract unique folders
  const folders = useMemo(() => {
    const set = new Set<string>()
    for (const note of notes) {
      const parts = note.path.split('/')
      if (parts.length > 1) {
        const folder = parts.slice(0, -1).join('/')
        if (!isHiddenFolder(folder)) set.add(folder)
      }
    }
    return set
  }, [notes])

  // Toggle pin
  const handleTogglePin = async (e: React.MouseEvent, note: NoteMeta) => {
    e.stopPropagation()
    const newPinned = !note.pinned
    try {
      if (typeof window.mynote?.notes?.setPinned !== 'function') {
        throw new Error('API not available — 请完全退出并重启应用')
      }
      await window.mynote.notes.setPinned(note.path, newPinned)
      setNotes(prev => prev.map(n => n.path === note.path ? { ...n, pinned: newPinned } : n))
    } catch (err) {
      console.error('Failed to toggle pin:', err)
      alert(`置顶失败: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  // Toggle archive
  const handleToggleArchive = async (e: React.MouseEvent, note: NoteMeta) => {
    e.stopPropagation()
    const newArchived = !note.archived
    try {
      if (typeof window.mynote?.notes?.setArchived !== 'function') {
        throw new Error('API not available — 请完全退出并重启应用')
      }
      await window.mynote.notes.setArchived(note.path, newArchived)
      setNotes(prev => prev.map(n => n.path === note.path ? { ...n, archived: newArchived } : n))
    } catch (err) {
      console.error('Failed to toggle archive:', err)
      alert(`归档失败: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  // Batch selection
  const toggleSelect = (path: string) => {
    setSelectedPaths(prev => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  const selectAll = () => {
    if (selectedPaths.size === filteredNotes.length) {
      setSelectedPaths(new Set())
    } else {
      setSelectedPaths(new Set(filteredNotes.map(n => n.path)))
    }
  }

  const handleBatchArchive = async () => {
    const paths = Array.from(selectedPaths)
    try {
      await window.mynote.notes.batchArchive(paths, true)
      await loadData()
      setSelectedPaths(new Set())
      setBatchMode(false)
    } catch (err) { console.error('Failed to batch archive:', err) }
  }

  const handleBatchDelete = async () => {
    const paths = Array.from(selectedPaths)
    if (!confirm(`确定删除 ${paths.length} 篇笔记吗？此操作不可撤销。`)) return
    try {
      await window.mynote.notes.batchDelete(paths)
      await loadData()
      setSelectedPaths(new Set())
      setBatchMode(false)
    } catch (err) {
      alert(err instanceof Error ? err.message : '删除失败')
    }
  }

  const handleBatchTag = async () => {
    if (!batchTagValue.trim()) return
    const paths = Array.from(selectedPaths)
    try {
      await window.mynote.notes.batchTag(paths, batchTagValue.trim())
      await loadData()
      setBatchTagValue('')
      setBatchTagDialogOpen(false)
    } catch (err) { console.error('Failed to batch tag:', err) }
  }

  // Tag management
  const handleRenameTag = async () => {
    if (!tagRename || !tagRenameValue.trim()) return
    try {
      const updated = await window.mynote.tags.rename(tagRename, tagRenameValue.trim())
      setAllTags(updated)
      if (activeTag === tagRename) setActiveTag(tagRenameValue.trim())
      setTagRename(null)
      setTagRenameValue('')
      setTagMenuOpen(null)
      await loadData()
    } catch (err) { console.error('Failed to rename tag:', err) }
  }

  const handleDeleteTag = async (tagName: string) => {
    if (!confirm(`确定删除标签 "[#${tagName}]" 吗？将从所有笔记中移除此标签。`)) return
    try {
      const updated = await window.mynote.tags.delete(tagName)
      setAllTags(updated)
      if (activeTag === tagName) setActiveTag(null)
      setTagMenuOpen(null)
      await loadData()
    } catch (err) { console.error('Failed to delete tag:', err) }
  }

  // Create note
  const handleNewNote = async () => {
    const title = newNoteTitle.trim()
    if (!title) return
    try {
      const meta = await window.mynote.notes.create(newNoteFolder, title)
      await loadData()
      const opened = await openNote(meta.path)
      if (opened) setOpenNotePath(meta.path)
      setNewNoteDialogOpen(false)
      setNewNoteTitle('')
    } catch (err) {
      alert(err instanceof Error ? err.message : '新建笔记失败')
    }
  }

  // Show backlinks for a note
  const handleShowBacklinks = (e: React.MouseEvent, notePath: string) => {
    e.stopPropagation()
    setBacklinksFor(prev => prev === notePath ? null : notePath)
  }

  // Filter + sort + partition notes
  const { pinnedNotes, activeNotes, archivedNotes, recentlyViewedNotes } = useMemo(() => {
    let filtered = notes
    if (selectedFolder) {
      filtered = filtered.filter((n) => n.path.startsWith(selectedFolder + '/'))
    }
    if (activeTag) {
      filtered = filtered.filter((n) => n.tags.includes(activeTag))
    }

    const pinned: NoteMeta[] = []
    const active: NoteMeta[] = []
    const archived: NoteMeta[] = []

    for (const note of filtered) {
      if (note.archived) archived.push(note)
      else if (note.pinned) pinned.push(note)
      else active.push(note)
    }

    const sortedPinned = sortNotes(pinned, sortField, sortDir)
    const sortedActive = sortNotes(active, sortField, sortDir)
    const sortedArchived = sortNotes(archived, sortField, sortDir)

    // Recently viewed (only from active non-pinned)
    const recent = loadRecentlyViewed()
    const recentMetas = recent
      .map(p => sortedActive.find(n => n.path === p))
      .filter(Boolean) as NoteMeta[]

    return {
      pinnedNotes: sortedPinned,
      activeNotes: sortedActive,
      archivedNotes: sortedArchived,
      recentlyViewedNotes: recentMetas.slice(0, 8),
    }
  }, [notes, selectedFolder, activeTag, sortField, sortDir])

  // Combined list for display (pinned + recently viewed + active + archived)
  // But we need to avoid duplicating recently viewed that are already in pinned/active
  const recentlyViewedNotPinned = useMemo(() => {
    const pinnedPaths = new Set(pinnedNotes.map(n => n.path))
    return recentlyViewedNotes.filter(n => !pinnedPaths.has(n.path))
  }, [recentlyViewedNotes, pinnedNotes])

  const filteredNotes = showArchived
    ? [...pinnedNotes, ...activeNotes, ...archivedNotes]
    : [...pinnedNotes, ...activeNotes]

  // Show search results or folder view
  const showSearch = searchQuery.trim().length > 0

  const sortLabel: Record<SortField, string> = {
    updated_at: '更新日期',
    created_at: '创建日期',
    title: '标题',
  }

  return (
    <div className="h-full flex">
      {/* Left Panel: Folders + Tags + Archive */}
      <div className="w-56 flex-shrink-0 border-r border-surface-200 overflow-auto flex flex-col">
        {/* Header: New Note + Sort */}
        <div className="p-3 border-b border-surface-200 space-y-2">
          <button
            onClick={() => {
              setNewNoteFolder(selectedFolder || 'notes')
              setNewNoteTitle('')
              setNewNoteDialogOpen(true)
            }}
            className="w-full flex items-center justify-center gap-2 px-3 py-1.5 rounded-md text-xs font-medium
                       bg-accent-500 text-white hover:bg-accent-600 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            新建笔记
          </button>

          {/* Sort dropdown */}
          <div className="relative" ref={sortRef}>
            <button
              onClick={() => setSortMenuOpen(!sortMenuOpen)}
              className="w-full flex items-center justify-between gap-1 px-2 py-1 rounded text-xs text-surface-500
                         hover:bg-surface-100 transition-colors"
            >
              <span className="flex items-center gap-1">
                <ArrowUpDown className="w-3 h-3" />
                {sortLabel[sortField]}
              </span>
              <ChevronDown className={`w-3 h-3 transition-transform ${sortMenuOpen ? 'rotate-180' : ''}`} />
            </button>
            {sortMenuOpen && (
              <div className="absolute left-0 top-full mt-1 w-40 bg-white border border-surface-200 rounded-md shadow-lg py-1 z-40">
                {(['updated_at', 'created_at', 'title'] as SortField[]).map(field => (
                  <div key={field}>
                    <button
                      onClick={() => { setSortField(field); setSortDir('desc') }}
                      className={`w-full text-left px-3 py-1.5 text-xs hover:bg-surface-50 transition-colors flex items-center justify-between ${
                        sortField === field ? 'text-accent-600 font-medium' : 'text-surface-600'
                      }`}
                    >
                      {sortLabel[field]}
                      {sortField === field && <span className="text-[10px] text-surface-400">{sortDir === 'desc' ? '↓' : '↑'}</span>}
                    </button>
                    {sortField === field && (
                      <button
                        onClick={() => setSortDir(d => d === 'desc' ? 'asc' : 'desc')}
                        className="w-full text-left px-3 py-1 text-[11px] text-surface-400 hover:bg-surface-50"
                      >
                        {sortDir === 'desc' ? '降序 ↓' : '升序 ↑'}
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Folders */}
        <div className="p-3 border-b border-surface-200">
          <div className="flex items-center gap-2 mb-2">
            <FolderTree className="w-3.5 h-3.5 text-surface-500" />
            <h2 className="text-xs font-semibold text-surface-700">文件夹</h2>
          </div>
          <button
            onClick={() => setSelectedFolder(null)}
            className={`w-full text-left px-2 py-1 rounded text-xs mb-0.5 transition-colors ${
              selectedFolder === null
                ? 'bg-accent-50 text-accent-700 font-medium'
                : 'text-surface-600 hover:bg-surface-100'
            }`}
          >
            全部笔记 ({notes.filter(n => !n.archived || showArchived).length})
          </button>
          {Array.from(folders).sort().map((folder) => {
            const count = notes.filter((n) => n.path.startsWith(folder + '/')).length
            return (
              <button
                key={folder}
                onClick={() => setSelectedFolder(folder)}
                className={`w-full text-left px-2 py-1 rounded text-xs transition-colors flex items-center justify-between ${
                  selectedFolder === folder
                    ? 'bg-accent-50 text-accent-700 font-medium'
                    : 'text-surface-600 hover:bg-surface-100'
                }`}
              >
                <span className="truncate">{folder.split('/').pop()}</span>
                <span className="text-[10px] text-surface-400">{count}</span>
              </button>
            )
          })}
        </div>

        {/* Tags */}
        <div className="p-3 border-b border-surface-200" ref={tagMenuRef}>
          <div className="flex items-center gap-2 mb-2">
            <Tag className="w-3.5 h-3.5 text-surface-500" />
            <h2 className="text-xs font-semibold text-surface-700">标签</h2>
            {activeTag && (
              <button
                onClick={() => setActiveTag(null)}
                className="text-[10px] text-accent-600 hover:text-accent-700 bg-accent-50 px-1.5 py-0.5 rounded ml-auto"
              >
                清除
              </button>
            )}
          </div>
          {allTags.length === 0 ? (
            <p className="text-[11px] text-surface-400">暂无标签</p>
          ) : (
            <div className="flex flex-wrap gap-1">
              {allTags.map((tag) => (
                <div key={tag} className="relative group">
                  <span
                    onClick={() => setActiveTag(activeTag === tag ? null : tag)}
                    onContextMenu={(e) => {
                      e.preventDefault()
                      setTagMenuOpen(tag === tagMenuOpen ? null : tag)
                    }}
                    className={`text-[11px] px-2 py-0.5 rounded-md cursor-pointer transition-all font-medium border inline-block ${
                      activeTag === tag
                        ? 'bg-emerald-100 text-emerald-800 border-emerald-300 ring-1 ring-emerald-400'
                        : 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100 hover:text-emerald-800'
                    }`}
                  >
                    [#{tag}]
                  </span>
                  {/* Tag context menu */}
                  {tagMenuOpen === tag && (
                    <div className="absolute left-0 top-full mt-1 w-28 bg-white border border-surface-200 rounded-md shadow-lg py-1 z-50">
                      {tagRename === tag ? (
                        <div className="px-2 py-1">
                          <input
                            autoFocus
                            value={tagRenameValue}
                            onChange={(e) => setTagRenameValue(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') handleRenameTag()
                              if (e.key === 'Escape') { setTagRename(null); setTagRenameValue('') }
                            }}
                            className="w-full rounded border border-surface-300 px-1.5 py-0.5 text-[11px] outline-none focus:border-accent-400"
                          />
                        </div>
                      ) : (
                        <>
                          <button
                            onClick={() => { setTagRename(tag); setTagRenameValue(tag) }}
                            className="w-full text-left px-2.5 py-1 text-[11px] text-surface-600 hover:bg-surface-50 flex items-center gap-1.5"
                          >
                            <Pencil className="w-3 h-3" />
                            重命名
                          </button>
                          <button
                            onClick={() => handleDeleteTag(tag)}
                            className="w-full text-left px-2.5 py-1 text-[11px] text-red-600 hover:bg-red-50 flex items-center gap-1.5"
                          >
                            <Trash2 className="w-3 h-3" />
                            删除
                          </button>
                        </>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Archive Toggle */}
        <div className="p-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Archive className="w-3.5 h-3.5 text-surface-500" />
              <h2 className="text-xs font-semibold text-surface-700">归档</h2>
            </div>
            <button
              onClick={() => setShowArchived(!showArchived)}
              className={`relative w-8 h-4 rounded-full transition-colors ${
                showArchived ? 'bg-accent-400' : 'bg-surface-300'
              }`}
            >
              <span
                className={`absolute top-0.5 w-3 h-3 rounded-full bg-white shadow transition-all ${
                  showArchived ? 'right-0.5' : 'left-0.5'
                }`}
              />
            </button>
          </div>
          <p className="text-[10px] text-surface-400 mt-1">
            {archivedNotes.length} 篇已归档
          </p>
        </div>
      </div>

      {/* Middle Panel: Search + Note List */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Search + Batch Bar */}
        <div className="p-3 border-b border-surface-200 space-y-2">
          {/* Search Row */}
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-2 bg-surface-100 rounded-md px-3 py-1.5 flex-1">
              <Search className="w-4 h-4 text-surface-400" />
              <input
                type="text"
                placeholder="搜索笔记... (标题、内容)"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="flex-1 text-sm bg-transparent outline-none placeholder:text-surface-300"
              />
              {searchQuery && (
                <button onClick={() => setSearchQuery('')} className="p-0.5 hover:bg-surface-200 rounded">
                  <X className="w-3.5 h-3.5 text-surface-400" />
                </button>
              )}
            </div>
            {!showSearch && (
              <button
                onClick={() => { setBatchMode(!batchMode); setSelectedPaths(new Set()) }}
                className={`px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors ${
                  batchMode
                    ? 'bg-accent-100 text-accent-700'
                    : 'text-surface-500 hover:bg-surface-100'
                }`}
              >
                <CheckSquare className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Batch actions bar */}
          {batchMode && selectedPaths.size > 0 && (
            <div className="flex items-center gap-2 px-2 py-1.5 bg-accent-50 rounded-md">
              <span className="text-xs text-accent-700 font-medium">
                已选 {selectedPaths.size} 篇
              </span>
              <div className="flex-1" />
              <button
                onClick={handleBatchArchive}
                className="flex items-center gap-1 text-[11px] text-surface-600 hover:text-accent-600 bg-white px-2 py-1 rounded border border-surface-200 transition-colors"
              >
                <Archive className="w-3 h-3" />
                归档
              </button>
              <button
                onClick={() => setBatchTagDialogOpen(true)}
                className="flex items-center gap-1 text-[11px] text-surface-600 hover:text-accent-600 bg-white px-2 py-1 rounded border border-surface-200 transition-colors"
              >
                <Tag className="w-3 h-3" />
                打标签
              </button>
              <button
                onClick={handleBatchDelete}
                className="flex items-center gap-1 text-[11px] text-red-600 hover:bg-red-50 bg-white px-2 py-1 rounded border border-red-200 transition-colors"
              >
                <Trash2 className="w-3 h-3" />
                删除
              </button>
            </div>
          )}
        </div>

        {/* Note List / Search Results */}
        <div className="flex-1 overflow-auto">
          {showSearch ? (
            <div className="p-4">
              {searching ? (
                <p className="text-sm text-surface-400 text-center py-8">搜索中...</p>
              ) : searchResults.length === 0 ? (
                <div className="text-center py-16 text-surface-400">
                  <Search className="w-10 h-10 text-surface-200 mx-auto mb-3" />
                  <p className="text-sm">未找到匹配的笔记</p>
                </div>
              ) : (
                <div className="space-y-2">
                  <p className="text-xs text-surface-400 mb-3">找到 {searchResults.length} 条结果</p>
                  {searchResults.map((result) => (
                    <button
                      key={result.path}
                      onClick={() => handleOpenNote(result.path)}
                      className="w-full text-left p-3 rounded-md hover:bg-surface-50 border border-surface-200 transition-colors"
                    >
                      <h3 className="text-sm font-medium text-surface-800">{result.title}</h3>
                      <p className="text-xs text-surface-500 mt-1">{result.path}</p>
                      <p
                        className="text-xs text-surface-400 mt-1 line-clamp-2"
                        dangerouslySetInnerHTML={{ __html: result.snippet }}
                      />
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="p-3">
              {/* Active filters indicator */}
              {(selectedFolder || activeTag) && (
                <div className="flex items-center gap-2 mb-2 text-[11px] text-surface-500">
                  <span>筛选:</span>
                  {selectedFolder && (
                    <span
                      className="bg-accent-50 text-accent-700 px-2 py-0.5 rounded cursor-pointer"
                      onClick={() => setSelectedFolder(null)}
                    >
                      📁 {selectedFolder} ✕
                    </span>
                  )}
                  {activeTag && (
                    <span
                      className="bg-accent-50 text-accent-700 px-2 py-0.5 rounded cursor-pointer"
                      onClick={() => setActiveTag(null)}
                    >
                      [#{activeTag}] ✕
                    </span>
                  )}
                  <span className="text-surface-400">({filteredNotes.length} 条)</span>
                  {batchMode && (
                    <button onClick={selectAll} className="text-accent-600 hover:text-accent-700 ml-auto">
                      {selectedPaths.size === filteredNotes.length ? '取消全选' : '全选'}
                    </button>
                  )}
                </div>
              )}

              {filteredNotes.length === 0 ? (
                <div className="text-center py-16 text-surface-400">
                  <Library className="w-10 h-10 text-surface-200 mx-auto mb-3" />
                  <p className="text-sm">暂无笔记</p>
                  <p className="text-xs mt-1">创建你的第一篇笔记吧</p>
                </div>
              ) : (
                <div className="space-y-0.5">
                  {/* Pinned section */}
                  {pinnedNotes.length > 0 && !showSearch && (
                    <>
                      <div className="text-[10px] text-amber-600 font-medium px-2 py-1 uppercase tracking-wider">
                        📌 已置顶
                      </div>
                      {pinnedNotes.map((note) => (
                        <NoteRow
                          key={note.path}
                          note={note}
                          batchMode={batchMode}
                          selected={selectedPaths.has(note.path)}
                          onToggleSelect={() => toggleSelect(note.path)}
                          onOpen={() => handleOpenNote(note.path)}
                          onTogglePin={(e) => handleTogglePin(e, note)}
                          onToggleArchive={(e) => handleToggleArchive(e, note)}
                          onBacklinks={(e) => handleShowBacklinks(e, note.path)}
                          onTagClick={(tag) => setActiveTag(tag)}
                        />
                      ))}
                    </>
                  )}

                  {/* Recently viewed section */}
                  {!selectedFolder && !activeTag && recentlyViewedNotPinned.length > 0 && (
                    <>
                      <div className="text-[10px] text-surface-500 font-medium px-2 py-1 uppercase tracking-wider mt-2">
                        <History className="w-3 h-3 inline mr-1" />
                        最近浏览
                      </div>
                      {recentlyViewedNotPinned.map((note) => (
                        <NoteRow
                          key={`recent-${note.path}`}
                          note={note}
                          batchMode={batchMode}
                          selected={selectedPaths.has(note.path)}
                          onToggleSelect={() => toggleSelect(note.path)}
                          onOpen={() => handleOpenNote(note.path)}
                          onTogglePin={(e) => handleTogglePin(e, note)}
                          onToggleArchive={(e) => handleToggleArchive(e, note)}
                          onBacklinks={(e) => handleShowBacklinks(e, note.path)}
                          onTagClick={(tag) => setActiveTag(tag)}
                          subtle
                        />
                      ))}
                    </>
                  )}

                  {/* Active notes section */}
                  {activeNotes.length > 0 && (
                    <>
                      {(pinnedNotes.length > 0 || (!selectedFolder && !activeTag && recentlyViewedNotPinned.length > 0)) && (
                        <div className="text-[10px] text-surface-400 font-medium px-2 py-1 uppercase tracking-wider mt-1">
                          全部笔记
                        </div>
                      )}
                      {activeNotes.map((note) => (
                        <NoteRow
                          key={note.path}
                          note={note}
                          batchMode={batchMode}
                          selected={selectedPaths.has(note.path)}
                          onToggleSelect={() => toggleSelect(note.path)}
                          onOpen={() => handleOpenNote(note.path)}
                          onTogglePin={(e) => handleTogglePin(e, note)}
                          onToggleArchive={(e) => handleToggleArchive(e, note)}
                          onBacklinks={(e) => handleShowBacklinks(e, note.path)}
                          onTagClick={(tag) => setActiveTag(tag)}
                        />
                      ))}
                    </>
                  )}

                  {/* Archived section */}
                  {showArchived && archivedNotes.length > 0 && (
                    <>
                      <div className="text-[10px] text-surface-400 font-medium px-2 py-1 uppercase tracking-wider mt-2">
                        📦 已归档
                      </div>
                      {archivedNotes.map((note) => (
                        <NoteRow
                          key={note.path}
                          note={note}
                          batchMode={batchMode}
                          selected={selectedPaths.has(note.path)}
                          onToggleSelect={() => toggleSelect(note.path)}
                          onOpen={() => handleOpenNote(note.path)}
                          onTogglePin={(e) => handleTogglePin(e, note)}
                          onToggleArchive={(e) => handleToggleArchive(e, note)}
                          onBacklinks={(e) => handleShowBacklinks(e, note.path)}
                          onTagClick={(tag) => setActiveTag(tag)}
                        />
                      ))}
                    </>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Backlinks footer panel */}
        {backlinksFor && backlinks.length > 0 && (
          <div className="border-t border-surface-200 bg-surface-50 p-3 max-h-40 overflow-auto">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-xs font-semibold text-surface-600 flex items-center gap-1.5">
                <Link2 className="w-3.5 h-3.5" />
                反向链接 ({backlinks.length})
              </h3>
              <button onClick={() => setBacklinksFor(null)} className="p-0.5 hover:bg-surface-200 rounded">
                <X className="w-3.5 h-3.5 text-surface-400" />
              </button>
            </div>
            <div className="space-y-1">
              {backlinks.map((bl) => (
                <button
                  key={bl.from_path}
                  onClick={() => handleOpenNote(bl.from_path)}
                  className="w-full text-left px-2 py-1.5 rounded hover:bg-surface-100 transition-colors text-xs"
                >
                  <span className="text-surface-700 font-medium">{bl.from_path}</span>
                  <span className="text-surface-400 ml-2 truncate block">{bl.context}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* New Note Dialog */}
      {newNoteDialogOpen && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/20 px-4"
          onClick={() => setNewNoteDialogOpen(false)}
        >
          <div
            className="w-80 rounded-lg border border-surface-200 bg-white p-4 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-sm font-semibold text-surface-800">新建笔记</h3>
            <div className="mt-3 space-y-2">
              <input
                autoFocus
                value={newNoteTitle}
                onFocus={(e) => e.currentTarget.select()}
                onChange={(e) => setNewNoteTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleNewNote()
                  if (e.key === 'Escape') { setNewNoteDialogOpen(false); setNewNoteTitle('') }
                }}
                placeholder="笔记名称"
                className="w-full rounded-md border border-surface-300 px-3 py-2 text-sm outline-none focus:border-accent-400"
              />
              <select
                value={newNoteFolder}
                onChange={(e) => setNewNoteFolder(e.target.value)}
                className="w-full rounded-md border border-surface-300 px-3 py-1.5 text-xs text-surface-600 outline-none focus:border-accent-400"
              >
                <option value="notes">notes/</option>
                {Array.from(folders).sort().map(f => (
                  <option key={f} value={f}>{f}/</option>
                ))}
              </select>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => { setNewNoteDialogOpen(false); setNewNoteTitle('') }}
                className="rounded-md px-3 py-1.5 text-sm text-surface-500 hover:bg-surface-100"
              >
                取消
              </button>
              <button
                onClick={handleNewNote}
                disabled={!newNoteTitle.trim()}
                className="rounded-md bg-accent-600 px-3 py-1.5 text-sm text-white hover:bg-accent-700 disabled:opacity-40"
              >
                确定
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Batch Tag Dialog */}
      {batchTagDialogOpen && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/20 px-4"
          onClick={() => setBatchTagDialogOpen(false)}
        >
          <div
            className="w-80 rounded-lg border border-surface-200 bg-white p-4 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-sm font-semibold text-surface-800">批量打标签</h3>
            <p className="text-xs text-surface-400 mt-1">为 {selectedPaths.size} 篇笔记添加标签</p>
            <input
              autoFocus
              value={batchTagValue}
              onChange={(e) => setBatchTagValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleBatchTag()
                if (e.key === 'Escape') setBatchTagDialogOpen(false)
              }}
              placeholder="输入标签名"
              className="mt-3 w-full rounded-md border border-surface-300 px-3 py-2 text-sm outline-none focus:border-accent-400"
            />
            <div className="mt-3 flex flex-wrap gap-1">
              {allTags.slice(0, 10).map(tag => (
                <button
                  key={tag}
                  onClick={() => setBatchTagValue(tag)}
                  className="text-[11px] px-2 py-0.5 rounded bg-surface-100 text-surface-600 hover:bg-emerald-50 hover:text-emerald-700 transition-colors"
                >
                  {tag}
                </button>
              ))}
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => setBatchTagDialogOpen(false)}
                className="rounded-md px-3 py-1.5 text-sm text-surface-500 hover:bg-surface-100"
              >
                取消
              </button>
              <button
                onClick={handleBatchTag}
                disabled={!batchTagValue.trim()}
                className="rounded-md bg-accent-600 px-3 py-1.5 text-sm text-white hover:bg-accent-700 disabled:opacity-40"
              >
                确定
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Note Row Component ──

function NoteRow({
  note,
  batchMode,
  selected,
  onToggleSelect,
  onOpen,
  onTogglePin,
  onToggleArchive,
  onBacklinks,
  onTagClick,
  subtle,
}: {
  note: NoteMeta
  batchMode: boolean
  selected: boolean
  onToggleSelect: () => void
  onOpen: () => void
  onTogglePin: (e: React.MouseEvent) => void
  onToggleArchive: (e: React.MouseEvent) => void
  onBacklinks: (e: React.MouseEvent) => void
  onTagClick: (tag: string) => void
  subtle?: boolean
}) {
  return (
    <div
      className={`group flex items-center gap-2 px-2 py-2 rounded-md transition-colors cursor-pointer ${
        subtle
          ? 'text-surface-500 hover:bg-surface-50'
          : selected
            ? 'bg-accent-50 text-surface-800 hover:bg-accent-100'
            : 'text-surface-700 hover:bg-surface-50'
      }`}
      onClick={batchMode ? onToggleSelect : onOpen}
    >
      {/* Batch checkbox or icon */}
      {batchMode ? (
        <button onClick={(e) => { e.stopPropagation(); onToggleSelect() }} className="flex-shrink-0">
          {selected ? (
            <CheckSquare className="w-4 h-4 text-accent-500" />
          ) : (
            <Square className="w-4 h-4 text-surface-300" />
          )}
        </button>
      ) : (
        <>
          {note.pinned && (
            <Pin className="w-3.5 h-3.5 text-amber-500 flex-shrink-0" />
          )}
          {!note.pinned && (
            <FileText className={`w-4 h-4 flex-shrink-0 ${subtle ? 'text-surface-300' : 'text-surface-400'}`} />
          )}
        </>
      )}

      {/* Title + Date */}
      <div className="min-w-0 flex-1">
        <h3 className={`text-sm truncate ${subtle ? 'font-normal' : 'font-medium'} ${note.archived ? 'text-surface-400' : ''}`}>
          {note.title}
          {note.archived && <Archive className="w-3 h-3 inline ml-1 text-surface-400" />}
        </h3>
        <p className="text-[11px] text-surface-400 mt-0.5 flex items-center gap-1">
          <Clock className="w-3 h-3" />
          {format(new Date(note.updated_at), 'yyyy-MM-dd HH:mm')}
        </p>
      </div>

      {/* Tags */}
      {note.tags.length > 0 && (
        <div className="hidden sm:flex gap-1 flex-shrink-0">
          {note.tags.slice(0, 4).map((tag) => (
            <span
              key={tag}
              onClick={(e) => { e.stopPropagation(); onTagClick(tag) }}
              className="text-[10px] bg-surface-100 text-surface-500 px-1.5 py-0.5 rounded
                         hover:bg-accent-100 hover:text-accent-600 transition-colors cursor-pointer"
            >
              {tag}
            </span>
          ))}
          {note.tags.length > 4 && (
            <span className="text-[10px] text-surface-400">+{note.tags.length - 4}</span>
          )}
        </div>
      )}

      {/* Action buttons — always visible */}
      {!batchMode && (
        <div className="flex gap-0.5 flex-shrink-0">
          <button
            onClick={onTogglePin}
            className="p-1 hover:bg-amber-100 rounded transition-colors"
            title={note.pinned ? '取消置顶' : '置顶'}
          >
            <Pin className={`w-3 h-3 ${note.pinned ? 'text-amber-500 fill-amber-500' : 'text-surface-300 hover:text-amber-400'}`} />
          </button>
          <button
            onClick={onBacklinks}
            className="p-1 hover:bg-blue-100 rounded transition-colors"
            title="反向链接"
          >
            <Link2 className="w-3 h-3 text-surface-300 hover:text-blue-500" />
          </button>
          <button
            onClick={onToggleArchive}
            className="p-1 hover:bg-surface-200 rounded transition-colors"
            title={note.archived ? '取消归档' : '归档'}
          >
            <Archive className={`w-3 h-3 ${note.archived ? 'text-amber-500' : 'text-surface-300 hover:text-amber-500'}`} />
          </button>
        </div>
      )}
    </div>
  )
}
