import { CalendarDays, CheckSquare, FileText, Plus, Clock, Trash2, Check, Square } from 'lucide-react'
import { format } from 'date-fns'
import { zhCN } from 'date-fns/locale'
import { useEffect, useState } from 'react'
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

export default function Dashboard() {
  const today = new Date()
  const greeting = getGreeting(today.getHours())
  const dateStr = format(today, 'yyyy年M月d日 EEEE', { locale: zhCN })

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

  const handleTodoToggle = async (item: TodoPageItem) => {
    await window.mynote.todoPage.toggle(item.id)
    loadData()
  }

  const handleTodoDelete = async (item: TodoPageItem) => {
    await window.mynote.todoPage.delete(item.id)
    loadData()
  }

  const handleTodoAdd = async () => {
    if (!newTodoContent.trim()) return
    await window.mynote.todoPage.add(newTodoContent.trim(), 'today')
    setNewTodoContent('')
    setAddingTodo(false)
    loadData()
  }

  useEffect(() => {
    loadData()
  }, [])

  const handleOpenNote = async (filePath: string) => {
    await openNote(filePath)
    setOpenNotePath(filePath)
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
      await openNote(meta.path)
      setOpenNotePath(meta.path)
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
        await openNote(diary.path)
        setOpenNotePath(diary.path)
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
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-surface-900">
            {greeting}
          </h1>
          <p className="text-surface-500 mt-1">{dateStr}</p>
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
            <h2 className="card-title">最近笔记</h2>
            <button
              onClick={() => setActiveView('knowledge')}
              className="text-xs text-accent-600 hover:text-accent-700 font-medium"
            >
              查看全部
            </button>
          </div>
          {recentNotes.length === 0 ? (
            <div className="grid grid-cols-2 gap-3">
              <EmptyCard
                icon={<FileText className="w-8 h-8 text-surface-300" />}
                text="还没有笔记，点击上方按钮创建你的第一篇笔记"
              />
              <EmptyCard
                icon={<FileText className="w-8 h-8 text-surface-300" />}
                text="笔记会在这里显示"
              />
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              {recentNotes.slice(0, 6).map((note) => (
                <button
                  key={note.path}
                  onClick={() => handleOpenNote(note.path)}
                  className="card text-left hover:border-accent-200 transition-colors"
                >
                  <div className="flex items-start gap-3">
                    <FileText className="w-4 h-4 text-surface-400 mt-0.5 flex-shrink-0" />
                    <div className="min-w-0">
                      <h3 className="text-sm font-medium text-surface-800 truncate">
                        {note.title}
                      </h3>
                      <p className="text-xs text-surface-400 mt-1 flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {format(new Date(note.updated_at), 'MM-dd HH:mm')}
                      </p>
                      {note.tags.length > 0 && (
                        <div className="flex gap-1 mt-2">
                          {note.tags.map((tag) => (
                            <span key={tag} className="text-[11px] bg-emerald-50 text-emerald-700 border border-emerald-200 px-2 py-0.5 rounded-md font-medium">
                              {tag}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </section>

        {/* Today + Todos row */}
        <div className="grid grid-cols-2 gap-6">
          {/* Today's Diary */}
          <section className="card">
            <div className="flex items-center justify-between mb-3">
              <h2 className="card-title">今日日记</h2>
              <button
                onClick={handleTodayDiary}
                className="p-1 hover:bg-surface-100 rounded transition-colors"
              >
                <Plus className="w-4 h-4 text-surface-400" />
              </button>
            </div>
            {todayDiary ? (
              <button
                onClick={handleTodayDiary}
                className="w-full text-left flex items-center gap-3 p-2 hover:bg-surface-50 rounded-md transition-colors"
              >
                <div className="w-10 h-10 bg-amber-50 rounded-lg flex items-center justify-center">
                  <CalendarDays className="w-5 h-5 text-amber-500" />
                </div>
                <div>
                  <p className="text-sm font-medium text-surface-700">{todayDiary.title}</p>
                  <p className="text-xs text-surface-400 mt-0.5">点击编辑今日日记</p>
                </div>
              </button>
            ) : (
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-amber-50 rounded-lg flex items-center justify-center">
                  <CalendarDays className="w-5 h-5 text-amber-500" />
                </div>
                <div>
                  <p className="text-sm font-medium text-surface-700">还没有今日日记</p>
                  <p className="text-xs text-surface-400 mt-0.5">点击右上角 + 开始写作</p>
                </div>
              </div>
            )}
          </section>

          {/* Today's Todos */}
          <section className="card">
            <div className="flex items-center justify-between mb-3">
              <h2 className="card-title">今日待办</h2>
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
                <CheckSquare className="w-8 h-8 text-surface-200 mx-auto mb-2" />
                <p className="text-xs text-surface-400">今日暂无待办 ✨</p>
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
  const colorClasses = {
    accent: 'bg-accent-50 text-accent-600 hover:bg-accent-100 border-accent-200',
    green: 'bg-emerald-50 text-emerald-600 hover:bg-emerald-100 border-emerald-200',
    amber: 'bg-amber-50 text-amber-600 hover:bg-amber-100 border-amber-200',
  }
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-3 px-4 py-3 rounded-lg border transition-colors ${colorClasses[color]}`}
    >
      {icon}
      <span className="text-sm font-medium">{label}</span>
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
