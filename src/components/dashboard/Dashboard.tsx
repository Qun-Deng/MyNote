import { CalendarDays, CheckSquare, FileText, Plus, Trash2, Check, Square, Image } from 'lucide-react'
import { format } from 'date-fns'
import { zhCN } from 'date-fns/locale'
import { useEffect, useState, useRef, useCallback } from 'react'
import type { NoteMeta } from '../../../shared/types'
import { useUIStore } from '../../stores/uiStore'
import { useNoteStore } from '../../stores/noteStore'
import { useVaultStore } from '../../stores/vaultStore'

interface TodoPageItem {
  id: string
  content: string
  completed: boolean
  section: string
  created_date: string
  created_at: string
}

// ── Banner persistence ──

const BANNER_KEY = 'dashboard_banner'

interface BannerData {
  quote: string
  author: string
  image: string | null  // base64 data URL
}

function loadBanner(): BannerData {
  try {
    const raw = localStorage.getItem(BANNER_KEY)
    if (raw) return JSON.parse(raw)
  } catch {}
  return { quote: '千里之行，始于足下。', author: '老子', image: null }
}

function saveBanner(data: BannerData) {
  localStorage.setItem(BANNER_KEY, JSON.stringify(data))
}

export default function Dashboard() {
  const today = new Date()
  const greeting = getGreeting(today.getHours())
  const dateStr = format(today, 'yyyy年M月d日 EEEE', { locale: zhCN })
  const [banner, setBanner] = useState<BannerData>(loadBanner)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleImagePick = useCallback(() => {
    const input = fileInputRef.current
    if (!input) return
    input.click()
  }, [])

  const handleImageChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      const next = { ...banner, image: reader.result as string }
      setBanner(next)
      saveBanner(next)
    }
    reader.readAsDataURL(file)
    // Reset so same file can be re-selected
    e.target.value = ''
  }, [banner])

  const handleQuoteChange = useCallback((value: string) => {
    const next = { ...banner, quote: value }
    setBanner(next)
    saveBanner(next)
  }, [banner])

  const handleAuthorChange = useCallback((value: string) => {
    const next = { ...banner, author: value }
    setBanner(next)
    saveBanner(next)
  }, [banner])

  const [recentNotes, setRecentNotes] = useState<NoteMeta[]>([])
  const [todoItems, setTodoItems] = useState<TodoPageItem[]>([])
  const [todayDiary, setTodayDiary] = useState<NoteMeta | null>(null)
  const [newNoteDialogOpen, setNewNoteDialogOpen] = useState(false)
  const [newNoteTitle, setNewNoteTitle] = useState('')
  const [addingTodo, setAddingTodo] = useState(false)
  const [newTodoContent, setNewTodoContent] = useState('')

  const setActiveView = useUIStore((s) => s.setActiveView)
  const setOpenNotePath = useUIStore((s) => s.setOpenNotePath)
  const openNote = useNoteStore((s) => s.openNote)
  const refreshTree = useVaultStore((s) => s.refreshTree)

  const loadData = async () => {
    try {
      const [notes, diary, todoPage] = await Promise.all([
        window.mynote.notes.recent().catch(() => []),
        window.mynote.diary.get(format(today, 'yyyy-MM-dd')).catch(() => null),
        window.mynote.todoPage.list().catch(() => []),
      ])
      setRecentNotes(notes)
      setTodayDiary(diary)
      const allTodos = todoPage as TodoPageItem[]
      setTodoItems(allTodos.filter((t: TodoPageItem) => !t.completed && t.section === 'today'))
    } catch {
      // Silently fail — data will show as empty
    }
  }

  const todayStr = format(today, 'yyyy-MM-dd')

  const syncDiary = async () => {
    try { await window.mynote.diary.syncFromPage(todayStr) } catch {}
  }

  const handleTodoToggle = async (item: TodoPageItem) => {
    await window.mynote.todoPage.toggle(item.id)
    await syncDiary()
    loadData()
  }

  const handleTodoDelete = async (item: TodoPageItem) => {
    await window.mynote.todoPage.delete(item.id)
    await syncDiary()
    loadData()
  }

  const handleTodoAdd = async () => {
    if (!newTodoContent.trim()) return
    await window.mynote.todoPage.add(newTodoContent.trim(), 'today')
    await syncDiary()
    setNewTodoContent('')
    setAddingTodo(false)
    loadData()
  }

  useEffect(() => {
    loadData()
  }, [])

  const handleOpenNote = async (filePath: string) => {
    const opened = await openNote(filePath)
    if (opened) {
      setOpenNotePath(filePath)
    } else {
      await loadData()
      await refreshTree()
    }
  }

  const openNewNoteDialog = () => {
    setNewNoteTitle(`新笔记 ${format(today, 'MM-dd HHmm')}`)
    setNewNoteDialogOpen(true)
  }

  const handleNewNote = async () => {
    const title = newNoteTitle.trim()
    if (!title) return
    try {
      const meta = await window.mynote.notes.create('notes', title)
      await refreshTree()
      const opened = await openNote(meta.path)
      if (opened) setOpenNotePath(meta.path)
      setNewNoteDialogOpen(false)
      setNewNoteTitle('')
      await loadData()
    } catch (err) {
      alert(err instanceof Error ? err.message : '新建笔记失败')
    }
  }

  const handleTodayDiary = async () => {
    const dateStr = format(today, 'yyyy-MM-dd')
    try {
      let diary = todayDiary
      if (!diary) {
        diary = await window.mynote.diary.create(dateStr)
        refreshTree()
      }
      if (diary) {
        const opened = await openNote(diary.path)
        if (opened) setOpenNotePath(diary.path)
      }
    } catch {}
  }

  const handleTodoView = () => {
    setActiveView('todo')
  }

  return (
    <div className="h-full overflow-auto">
      <div className="max-w-4xl mx-auto p-8">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-surface-900">
            {greeting}
          </h1>
          <p className="text-surface-500 mt-1">{dateStr}</p>
        </div>

        {/* Editable Banner */}
        <div
          className="mb-8 rounded-2xl p-8 relative overflow-hidden shadow-md min-h-[180px] flex flex-col justify-center"
          style={{
            backgroundImage: banner.image
              ? `url(${banner.image})`
              : 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
            backgroundSize: 'cover',
            backgroundPosition: 'center',
          }}
        >
          {/* Dark overlay for readability when image is set */}
          {banner.image && (
            <div className="absolute inset-0 bg-black/35 rounded-2xl" />
          )}

          <div className="relative z-10">
            {/* Quote — editable */}
            <input
              type="text"
              value={banner.quote}
              onChange={(e) => handleQuoteChange(e.target.value)}
              placeholder="写下激励你的话…"
              className="w-full bg-transparent text-white text-2xl font-serif tracking-wide leading-relaxed placeholder:text-white/30 border-none outline-none"
              style={{
                fontFamily: '"Noto Serif CJK SC", "Source Han Serif SC", "Songti SC", Georgia, "Times New Roman", serif',
                textShadow: banner.image ? '0 1px 8px rgba(0,0,0,0.4)' : '0 1px 4px rgba(0,0,0,0.15)',
              }}
            />
            {/* Author — editable */}
            <input
              type="text"
              value={banner.author}
              onChange={(e) => handleAuthorChange(e.target.value)}
              placeholder="— 署名"
              className="w-full bg-transparent text-white/70 text-sm mt-3 tracking-wider placeholder:text-white/25 border-none outline-none"
              style={{
                fontFamily: '"Inter", "Noto Sans CJK SC", system-ui, sans-serif',
                textShadow: banner.image ? '0 1px 6px rgba(0,0,0,0.35)' : '0 1px 2px rgba(0,0,0,0.1)',
                letterSpacing: '0.08em',
              }}
            />
          </div>

          {/* Image picker — bottom right */}
          <div className="absolute right-4 bottom-4 z-10">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleImageChange}
            />
            <button
              onClick={handleImagePick}
              className="flex items-center gap-1.5 text-xs text-white/50 hover:text-white/80 bg-white/10 hover:bg-white/20 backdrop-blur px-2.5 py-1.5 rounded-lg transition-all"
              title="选择背景图片"
            >
              <Image className="w-3.5 h-3.5" />
              图片
            </button>
          </div>
        </div>

        {/* Quick Actions */}
        <div className="grid grid-cols-3 gap-3 mb-8">
          <QuickCard
            icon={<FileText className="w-4 h-4" />}
            label="新建笔记"
            color="accent"
            onClick={openNewNoteDialog}
          />
          <QuickCard
            icon={<CalendarDays className="w-4 h-4" />}
            label={todayDiary ? '编辑今日日记' : '今日日记'}
            color="green"
            onClick={handleTodayDiary}
          />
          <QuickCard
            icon={<CheckSquare className="w-4 h-4" />}
            label={`今日待办 (${todoItems.length})`}
            color="amber"
            onClick={handleTodoView}
          />
        </div>

        {/* Recent Notes */}
        <section className="mb-8">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xs font-semibold text-surface-500 uppercase tracking-wider">最近笔记</h2>
            <button
              onClick={() => setActiveView('knowledge')}
              className="text-xs text-accent-600 hover:text-accent-700 font-medium transition-colors"
            >
              查看全部 →
            </button>
          </div>
          {recentNotes.length === 0 ? (
            <div className="text-center py-6 text-sm text-surface-400">
              还没有笔记，点击上方「新建笔记」开始
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2.5">
              {recentNotes.slice(0, 4).map((note) => (
                <button
                  key={note.path}
                  onClick={() => handleOpenNote(note.path)}
                  className="card text-left hover:border-accent-200 hover:shadow-sm transition-all duration-200 py-3 px-4"
                >
                  <h3 className="text-sm font-medium text-surface-800 truncate">
                    {note.title}
                  </h3>
                  <p className="text-xs text-surface-400 mt-1">
                    {format(new Date(note.updated_at), 'yyyy-MM-dd HH:mm')}
                  </p>
                </button>
              ))}
            </div>
          )}
        </section>

        {/* Today + Todos row */}
        <div className="grid grid-cols-2 gap-6">
          {/* Today's Diary */}
          <section className="card hover:shadow-md transition-all duration-200">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-xs font-semibold text-surface-500 uppercase tracking-wider">今日日记</h2>
              <button
                onClick={handleTodayDiary}
                className="p-1.5 hover:bg-amber-50 rounded-lg transition-colors"
              >
                <Plus className="w-4 h-4 text-surface-400 hover:text-amber-500 transition-colors" />
              </button>
            </div>
            {todayDiary ? (
              <button
                onClick={handleTodayDiary}
                className="w-full text-left flex items-center gap-3 p-3 hover:bg-amber-50/50 rounded-lg transition-colors"
              >
                <div className="w-11 h-11 bg-amber-100 rounded-xl flex items-center justify-center flex-shrink-0">
                  <CalendarDays className="w-5 h-5 text-amber-600" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-surface-800 truncate">{todayDiary.title}</p>
                  <p className="text-xs text-surface-400 mt-0.5">点击编辑</p>
                </div>
              </button>
            ) : (
              <div
                onClick={handleTodayDiary}
                className="flex items-center gap-3 p-3 rounded-lg border-2 border-dashed border-surface-200 hover:border-amber-200 hover:bg-amber-50/30 cursor-pointer transition-all"
              >
                <div className="w-11 h-11 bg-amber-100 rounded-xl flex items-center justify-center flex-shrink-0">
                  <CalendarDays className="w-5 h-5 text-amber-500" />
                </div>
                <div>
                  <p className="text-sm font-medium text-surface-600">开始今日日记</p>
                  <p className="text-xs text-surface-400 mt-0.5">记录今天的想法</p>
                </div>
              </div>
            )}
          </section>

          {/* Today's Todos */}
          <section className="card hover:shadow-md transition-all duration-200">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-xs font-semibold text-surface-500 uppercase tracking-wider">今日待办</h2>
              <div className="flex items-center gap-2">
                <span className="text-xs text-surface-400">
                  {todoItems.length} 条
                </span>
                <button
                  onClick={() => { setAddingTodo(true); setNewTodoContent('') }}
                  className="p-1 hover:bg-surface-100 rounded transition-colors"
                  title="添加待办"
                >
                  <Plus className="w-4 h-4 text-surface-400" />
                </button>
              </div>
            </div>
            {todoItems.length === 0 && !addingTodo ? (
              <div className="text-center py-4">
                <p className="text-xs text-surface-400">今日暂无待办</p>
              </div>
            ) : (
              <div>
                <div className="space-y-0.5">
                  {todoItems.slice(0, 5).map((item) => (
                    <div
                      key={item.id}
                      className="flex items-center gap-2 py-1 text-sm text-surface-700 group hover:bg-surface-50 rounded px-1 transition-colors"
                    >
                      <button onClick={() => handleTodoToggle(item)} className="flex-shrink-0">
                        {item.completed ? (
                          <Check className="w-4 h-4 text-emerald-500" />
                        ) : (
                          <Square className="w-4 h-4 text-surface-300 hover:text-accent-500 transition-colors" />
                        )}
                      </button>
                      <span className={`truncate flex-1 ${item.completed ? 'line-through text-surface-400' : ''}`}>
                        {item.content}
                      </span>
                      <button
                        onClick={() => handleTodoDelete(item)}
                        className="flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded hover:bg-red-50 text-surface-400 hover:text-red-500"
                        title="删除"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                </div>
                {todoItems.length > 5 && (
                  <p className="text-xs text-surface-400 pt-1">
                    还有 {todoItems.length - 5} 条待办...
                  </p>
                )}
                {addingTodo && (
                  <div className="flex items-center gap-2 mt-2 pt-2 border-t border-surface-100">
                    <Square className="w-4 h-4 text-surface-300 flex-shrink-0" />
                    <input
                      type="text"
                      value={newTodoContent}
                      onChange={(e) => setNewTodoContent(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleTodoAdd()
                        if (e.key === 'Escape') { setAddingTodo(false); setNewTodoContent('') }
                      }}
                      placeholder="输入待办…"
                      className="flex-1 bg-white border border-surface-200 rounded-md px-2 py-1 text-sm placeholder:text-surface-400 focus:outline-none focus:border-accent-300"
                      autoFocus
                    />
                    <button
                      onClick={handleTodoAdd}
                      disabled={!newTodoContent.trim()}
                      className="text-xs bg-accent-500 text-white px-2 py-1 rounded font-medium hover:bg-accent-600 transition-colors disabled:opacity-50"
                    >
                      确认
                    </button>
                    <button
                      onClick={() => { setAddingTodo(false); setNewTodoContent('') }}
                      className="text-xs text-surface-400 hover:text-surface-600"
                    >
                      取消
                    </button>
                  </div>
                )}
              </div>
            )}
          </section>
        </div>
      </div>

      {newNoteDialogOpen && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/20 px-4"
          onClick={() => setNewNoteDialogOpen(false)}
        >
          <div
            className="w-80 rounded-lg border border-surface-200 bg-white p-4 shadow-xl"
            onClick={(event) => event.stopPropagation()}
          >
            <h3 className="text-sm font-semibold text-surface-800">新建笔记</h3>
            <input
              autoFocus
              value={newNoteTitle}
              onFocus={(event) => event.currentTarget.select()}
              onChange={(event) => setNewNoteTitle(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') handleNewNote()
                if (event.key === 'Escape') setNewNoteDialogOpen(false)
              }}
              placeholder="笔记名称"
              className="mt-3 w-full rounded-md border border-surface-300 px-3 py-2 text-sm outline-none focus:border-accent-400"
            />
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => setNewNoteDialogOpen(false)}
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
    </div>
  )
}

function QuickCard({
  icon,
  label,
  color,
  onClick,
}: {
  icon: React.ReactNode
  label: string
  color: 'accent' | 'green' | 'amber'
  onClick: () => void
}) {
  const styles = {
    accent: {
      card: 'bg-accent-50/60 text-accent-700 hover:bg-accent-100 hover:shadow-md border-accent-200/60',
      iconBg: 'bg-accent-100 text-accent-600',
    },
    green: {
      card: 'bg-emerald-50/60 text-emerald-700 hover:bg-emerald-100 hover:shadow-md border-emerald-200/60',
      iconBg: 'bg-emerald-100 text-emerald-600',
    },
    amber: {
      card: 'bg-amber-50/60 text-amber-700 hover:bg-amber-100 hover:shadow-md border-amber-200/60',
      iconBg: 'bg-amber-100 text-amber-600',
    },
  }
  const s = styles[color]
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-3 px-4 py-3.5 rounded-xl border transition-all duration-200 hover:-translate-y-0.5 active:translate-y-0 ${s.card}`}
    >
      <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${s.iconBg}`}>
        {icon}
      </div>
      <span className="text-sm font-semibold">{label}</span>
    </button>
  )
}

function EmptyCard({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div className="card flex flex-col items-center justify-center py-8 gap-3">
      {icon}
      <p className="text-xs text-surface-400 text-center">{text}</p>
    </div>
  )
}

function getGreeting(hour: number): string {
  if (hour < 6) return '夜深了 🌙'
  if (hour < 12) return '早上好 ☀️'
  if (hour < 14) return '中午好 🌤️'
  if (hour < 18) return '下午好 🌈'
  return '晚上好 🌆'
}
