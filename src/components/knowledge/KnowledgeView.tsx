import { useEffect, useState } from 'react'
import {
  Library, Search, FolderTree, Tag, FileText, Clock, X
} from 'lucide-react'
import { format } from 'date-fns'
import type { NoteMeta, SearchResult } from '../../../shared/types'
import { useNoteStore } from '../../stores/noteStore'
import { useUIStore } from '../../stores/uiStore'

export default function KnowledgeView() {
  const [notes, setNotes] = useState<NoteMeta[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<SearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null)

  const openNote = useNoteStore((s) => s.openNote)
  const setOpenNotePath = useUIStore((s) => s.setOpenNotePath)

  // Load all notes
  useEffect(() => {
    const loadNotes = async () => {
      try {
        const allNotes = await window.mynote.notes.list()
        setNotes(allNotes.filter((n: NoteMeta) => !n.is_diary))
      } catch {}
    }
    loadNotes()
  }, [])

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

  const handleOpenNote = async (filePath: string) => {
    await openNote(filePath)
    setOpenNotePath(filePath)
  }

  // Extract unique folders
  const folders = new Set<string>()
  for (const note of notes) {
    const parts = note.path.split('/')
    if (parts.length > 1) {
      folders.add(parts.slice(0, -1).join('/'))
    }
  }

  // Filter notes by selected folder
  const filteredNotes = selectedFolder
    ? notes.filter((n) => n.path.startsWith(selectedFolder + '/'))
    : notes

  // Show search results or folder view
  const showSearch = searchQuery.trim().length > 0

  return (
    <div className="h-full flex">
      {/* Left Panel: Folders */}
      <div className="w-56 flex-shrink-0 border-r border-surface-200 p-4 overflow-auto">
        <div className="flex items-center gap-2 mb-4">
          <FolderTree className="w-4 h-4 text-surface-500" />
          <h2 className="text-sm font-semibold text-surface-700">文件夹</h2>
        </div>

        <button
          onClick={() => setSelectedFolder(null)}
          className={`w-full text-left px-2 py-1.5 rounded text-sm mb-1 transition-colors ${
            selectedFolder === null
              ? 'bg-accent-50 text-accent-700 font-medium'
              : 'text-surface-600 hover:bg-surface-100'
          }`}
        >
          全部笔记 ({notes.length})
        </button>

        {Array.from(folders).sort().map((folder) => {
          const count = notes.filter((n) => n.path.startsWith(folder + '/')).length
          return (
            <button
              key={folder}
              onClick={() => setSelectedFolder(folder)}
              className={`w-full text-left px-2 py-1.5 rounded text-sm transition-colors flex items-center justify-between ${
                selectedFolder === folder
                  ? 'bg-accent-50 text-accent-700 font-medium'
                  : 'text-surface-600 hover:bg-surface-100'
              }`}
            >
              <span className="truncate">{folder}</span>
              <span className="text-xs text-surface-400">{count}</span>
            </button>
          )
        })}

        {folders.size === 0 && (
          <p className="text-xs text-surface-400 px-2 py-2">暂无文件夹</p>
        )}

        {/* Tags section */}
        <div className="mt-6">
          <div className="flex items-center gap-2 mb-3">
            <Tag className="w-4 h-4 text-surface-500" />
            <h2 className="text-sm font-semibold text-surface-700">标签</h2>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {Array.from(new Set(notes.flatMap((n) => n.tags)))
              .filter(Boolean)
              .slice(0, 15)
              .map((tag) => (
                <span
                  key={tag}
                  className="text-xs bg-surface-100 text-surface-600 px-2 py-0.5 rounded cursor-pointer hover:bg-accent-50 hover:text-accent-600 transition-colors"
                  onClick={() => setSearchQuery(`#${tag}`)}
                >
                  {tag}
                </span>
              ))}
            {notes.flatMap((n) => n.tags).length === 0 && (
              <p className="text-xs text-surface-400">暂无标签</p>
            )}
          </div>
        </div>
      </div>

      {/* Middle Panel: Search + Note List */}
      <div className="flex-1 flex flex-col">
        {/* Search Bar */}
        <div className="p-4 border-b border-surface-200">
          <div className="flex items-center gap-2 bg-surface-100 rounded-md px-3 py-2">
            <Search className="w-4 h-4 text-surface-400" />
            <input
              type="text"
              placeholder="搜索笔记... (标题、内容)"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="flex-1 text-sm bg-transparent outline-none placeholder:text-surface-300"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="p-0.5 hover:bg-surface-200 rounded transition-colors"
              >
                <X className="w-3.5 h-3.5 text-surface-400" />
              </button>
            )}
          </div>
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
                  <p className="text-xs text-surface-400 mb-3">
                    找到 {searchResults.length} 条结果
                  </p>
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
            <div className="p-4">
              {filteredNotes.length === 0 ? (
                <div className="text-center py-16 text-surface-400">
                  <Library className="w-10 h-10 text-surface-200 mx-auto mb-3" />
                  <p className="text-sm">暂无笔记</p>
                  <p className="text-xs mt-1">创建你的第一篇笔记吧</p>
                </div>
              ) : (
                <div className="space-y-1">
                  {filteredNotes.map((note) => (
                    <button
                      key={note.path}
                      onClick={() => handleOpenNote(note.path)}
                      className="w-full text-left flex items-center gap-3 px-3 py-2.5 rounded-md hover:bg-surface-50 transition-colors group"
                    >
                      <FileText className="w-4 h-4 text-surface-400 flex-shrink-0" />
                      <div className="min-w-0 flex-1">
                        <h3 className="text-sm font-medium text-surface-800 truncate">
                          {note.title}
                        </h3>
                        <p className="text-xs text-surface-400 mt-0.5 flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {format(new Date(note.updated_at), 'yyyy-MM-dd HH:mm')}
                        </p>
                      </div>
                      {note.tags.length > 0 && (
                        <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          {note.tags.slice(0, 3).map((tag) => (
                            <span
                              key={tag}
                              className="text-[10px] bg-surface-100 text-surface-500 px-1.5 py-0.5 rounded"
                            >
                              {tag}
                            </span>
                          ))}
                        </div>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
