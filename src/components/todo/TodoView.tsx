import { useEffect, useState, useCallback } from 'react'
import { CheckSquare, RefreshCw, Check, Square, Plus, Trash2, Clock } from 'lucide-react'

// ====== Types ======

interface TodoPageItem {
  id: string
  content: string
  completed: boolean
  section: 'today' | 'week' | 'month'
  created_date: string   // 'YYYY-MM-DD'
  created_at: string
}

type PageView = 'current' | 'history'

// ====== Date helpers ======

const WEEKDAY_NAMES = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

function fmtISODate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function getMonday(d: Date): Date {
  const copy = new Date(d)
  const day = copy.getDay()
  const diff = day === 0 ? -6 : 1 - day
  copy.setDate(copy.getDate() + diff)
  copy.setHours(0, 0, 0, 0)
  return copy
}

function getSunday(d: Date): Date {
  const monday = getMonday(d)
  const sunday = new Date(monday)
  sunday.setDate(monday.getDate() + 6)
  return sunday
}

function getISOWeek(d: Date): number {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
  const dayNum = date.getUTCDay() || 7
  date.setUTCDate(date.getUTCDate() + 4 - dayNum)
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1))
  return Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7)
}

function fmtWeekLabel(dateStr: string): string {
  const d = new Date(dateStr)
  const monday = getMonday(d)
  const sunday = getSunday(d)
  return `${monday.getMonth() + 1}/${monday.getDate()}-${sunday.getMonth() + 1}/${sunday.getDate()}`
}

// ====== Component ======

export default function TodoView() {
  const [items, setItems] = useState<TodoPageItem[]>([])
  const [loading, setLoading] = useState(true)
  const [pageView, setPageView] = useState<PageView>('current')
  const [historyFilter, setHistoryFilter] = useState<'all' | 'pending' | 'completed'>('all')

  // Add state
  const [addingSection, setAddingSection] = useState<string | null>(null)
  const [newContent, setNewContent] = useState('')

  const loadItems = useCallback(async () => {
    try {
      const data = await window.mynote.todoPage.list()
      setItems(data)
    } catch {
      setItems([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    setLoading(true)
    loadItems()
  }, [loadItems])

  const handleToggle = async (item: TodoPageItem) => {
    await window.mynote.todoPage.toggle(item.id)
    setItems((prev) =>
      prev.map((t) => (t.id === item.id ? { ...t, completed: !t.completed } : t))
    )
  }

  const handleDelete = async (item: TodoPageItem) => {
    await window.mynote.todoPage.delete(item.id)
    setItems((prev) => prev.filter((t) => t.id !== item.id))
  }

  const handleAdd = async (section: string) => {
    if (!newContent.trim()) return
    try {
      const created = await window.mynote.todoPage.add(newContent.trim(), section)
      setNewContent('')
      setAddingSection(null)
      setItems((prev) => [...prev, created])
    } catch (err) {
      alert(err instanceof Error ? err.message : '添加失败')
    }
  }

  // ── Partition items ──

  const today = fmtISODate(new Date())
  const monday = fmtISODate(getMonday(new Date()))
  const sunday = fmtISODate(getSunday(new Date()))
  const thisMonth = today.slice(0, 7)
  const currentWeek = `${today.slice(0, 4)}-W${String(getISOWeek(new Date())).padStart(2, '0')}`

  // Current view: items belonging to this day/week/month
  const todayItems = items.filter(
    (t) => t.section === 'today' && t.created_date === today
  )
  const weekItems = items.filter(
    (t) => t.section === 'week' && t.created_date >= monday && t.created_date <= sunday
  )
  const monthItems = items.filter(
    (t) => t.section === 'month' && t.created_date.startsWith(thisMonth)
  )

  const pendingCount = todayItems.filter((t) => !t.completed).length +
    weekItems.filter((t) => !t.completed).length +
    monthItems.filter((t) => !t.completed).length

  // History view: items from previous periods
  const isCurrentPeriod = (t: TodoPageItem) => {
    if (t.section === 'today') return t.created_date === today
    if (t.section === 'week') return t.created_date >= monday && t.created_date <= sunday
    if (t.section === 'month') return t.created_date.startsWith(thisMonth)
    return false
  }

  let historyItems = items.filter((t) => !isCurrentPeriod(t))
  if (historyFilter === 'pending') historyItems = historyItems.filter((t) => !t.completed)
  if (historyFilter === 'completed') historyItems = historyItems.filter((t) => t.completed)

  // Group history items by date
  const historyGroups = new Map<string, TodoPageItem[]>()
  for (const item of historyItems) {
    const key = item.created_date
    const arr = historyGroups.get(key) || []
    arr.push(item)
    historyGroups.set(key, arr)
  }
  const sortedHistoryGroups = [...historyGroups.entries()].sort(([a], [b]) => b.localeCompare(a))

  // ── Render helpers ──

  const renderTodoRow = (item: TodoPageItem) => (
    <div
      key={item.id}
      className="flex items-center gap-3 px-3 py-2 rounded-md group hover:bg-surface-50 transition-colors"
    >
      <button onClick={() => handleToggle(item)} className="flex-shrink-0">
        {item.completed ? (
          <Check className="w-4 h-4 text-emerald-500" />
        ) : (
          <Square className="w-4 h-4 text-surface-300 hover:text-accent-500 transition-colors" />
        )}
      </button>
      <span
        className={`flex-1 text-sm truncate ${
          item.completed ? 'line-through text-surface-400' : 'text-surface-700'
        }`}
      >
        {item.content}
      </span>
      <button
        onClick={() => handleDelete(item)}
        className="flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-red-50 text-surface-400 hover:text-red-500"
        title="删除"
      >
        <Trash2 className="w-3.5 h-3.5" />
      </button>
    </div>
  )

  const renderEmpty = (text: string) => (
    <div className="text-center py-4">
      <p className="text-xs text-surface-400">{text}</p>
    </div>
  )

  const renderAddRow = (section: string) => (
    <div className="flex items-center gap-2 px-3 py-2 border-t border-surface-100 bg-accent-50/30">
      <Square className="w-4 h-4 text-surface-300 flex-shrink-0" />
      <input
        type="text"
        value={newContent}
        onChange={(e) => setNewContent(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') handleAdd(section)
          if (e.key === 'Escape') { setAddingSection(null); setNewContent('') }
        }}
        placeholder="输入待办内容…"
        className="flex-1 bg-white border border-surface-200 rounded-md px-2.5 py-1.5 text-sm placeholder:text-surface-400 focus:outline-none focus:border-accent-300 focus:ring-1 focus:ring-accent-200"
        autoFocus
      />
      <button
        onClick={() => handleAdd(section)}
        disabled={!newContent.trim()}
        className="text-xs bg-accent-500 text-white px-2.5 py-1.5 rounded-md font-medium hover:bg-accent-600 transition-colors disabled:opacity-50"
      >
        确认
      </button>
      <button
        onClick={() => { setAddingSection(null); setNewContent('') }}
        className="text-xs text-surface-400 hover:text-surface-600 px-1.5 py-1.5"
      >
        取消
      </button>
    </div>
  )

  const renderSection = (
    sectionKey: string,
    title: string,
    subtitle: string,
    sectionItems: TodoPageItem[],
    emptyText: string,
  ) => {
    const done = sectionItems.filter((t) => t.completed).length
    const isAdding = addingSection === sectionKey

    return (
      <section className="card">
        <div className="flex items-center justify-between mb-3">
          <h2 className="card-title">{title}</h2>
          <div className="flex items-center gap-2">
            <span className="text-xs text-surface-400">
              {subtitle} · {sectionItems.length}
              {done > 0 && <span className="text-emerald-600 ml-1">✓{done}</span>}
            </span>
            <button
              onClick={() => { setAddingSection(sectionKey); setNewContent('') }}
              className="p-1 hover:bg-surface-100 rounded transition-colors"
              title="添加待办"
            >
              <Plus className="w-4 h-4 text-surface-400" />
            </button>
          </div>
        </div>
        {sectionItems.length === 0 && !isAdding ? (
          renderEmpty(emptyText)
        ) : (
          <div>
            {sectionItems.length > 0 && (
              <div className="space-y-0.5">
                {sectionItems.map(renderTodoRow)}
              </div>
            )}
            {isAdding && renderAddRow(sectionKey)}
          </div>
        )}
      </section>
    )
  }

  if (loading) {
    return (
      <div className="h-full overflow-auto">
        <div className="max-w-4xl mx-auto p-8 text-center py-16 text-surface-400">
          <p className="text-sm">加载中...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="h-full overflow-auto">
      <div className="max-w-4xl mx-auto p-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-surface-900">待办事项</h1>
            <p className="text-surface-500 mt-1">
              {pageView === 'current' ? `${pendingCount} 个待完成` : '过往待办'}
            </p>
          </div>
          <div className="flex gap-1 bg-surface-100 rounded-lg p-1">
            <button
              onClick={() => setPageView('current')}
              className={`px-4 py-1.5 text-sm rounded-md font-medium transition-all ${
                pageView === 'current'
                  ? 'bg-white text-surface-800 shadow-sm'
                  : 'text-surface-500 hover:text-surface-700'
              }`}
            >
              当前
            </button>
            <button
              onClick={() => setPageView('history')}
              className={`px-4 py-1.5 text-sm rounded-md font-medium transition-all ${
                pageView === 'history'
                  ? 'bg-white text-surface-800 shadow-sm'
                  : 'text-surface-500 hover:text-surface-700'
              }`}
            >
              历史
            </button>
          </div>
        </div>

        {pageView === 'current' ? (
          /* Current view: 今日 / 本周 / 本月 */
          <div className="grid grid-cols-1 gap-4">
            {renderSection(
              'today',
              '今日',
              `${today.slice(5)} ${WEEKDAY_NAMES[new Date().getDay()]}`,
              todayItems,
              '暂无今日待办 ✨',
            )}
            {renderSection(
              'week',
              '本周',
              `${monday.slice(5)} ~ ${sunday.slice(5)}`,
              weekItems,
              '暂无本周待办',
            )}
            {renderSection(
              'month',
              '本月',
              `${thisMonth.slice(0, 4)}年${parseInt(thisMonth.slice(5, 7), 10)}月`,
              monthItems,
              '暂无本月待办',
            )}
            <div className="flex justify-center">
              <button
                onClick={() => loadItems()}
                className="flex items-center gap-1.5 text-xs text-accent-600 hover:text-accent-700 font-medium px-3 py-1.5 rounded-md hover:bg-accent-50 transition-colors"
              >
                <RefreshCw className="w-3 h-3" />
                刷新
              </button>
            </div>
          </div>
        ) : (
          /* History view */
          <div>
            {/* Filter */}
            <div className="flex gap-1 mb-4">
              {([
                { value: 'all', label: '全部' },
                { value: 'pending', label: '未完成' },
                { value: 'completed', label: '已完成' },
              ] as const).map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setHistoryFilter(opt.value)}
                  className={`px-3 py-1 text-xs rounded-md transition-colors ${
                    historyFilter === opt.value
                      ? 'bg-accent-50 text-accent-700 font-medium'
                      : 'text-surface-500 hover:bg-surface-100'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
              <span className="ml-auto text-xs text-surface-400 self-center">
                {historyItems.length} 条
              </span>
            </div>

            {/* History groups by date */}
            {sortedHistoryGroups.length === 0 ? (
              <section className="card flex flex-col items-center justify-center py-12">
                <Clock className="w-10 h-10 text-surface-200 mb-2" />
                <p className="text-xs text-surface-400">暂无历史待办</p>
              </section>
            ) : (
              <div className="grid grid-cols-1 gap-4">
                {sortedHistoryGroups.map(([date, groupItems]) => {
                  const d = new Date(date)
                  const done = groupItems.filter((t) => t.completed).length
                  return (
                    <section key={date} className="card">
                      <div className="flex items-center justify-between mb-3">
                        <h2 className="card-title">
                          {d.getMonth() + 1}月{d.getDate()}日 {WEEKDAY_NAMES[d.getDay()]}
                        </h2>
                        <span className="text-xs text-surface-400">
                          {groupItems.length} 条
                          {done > 0 && <span className="text-emerald-600 ml-1">✓{done}</span>}
                        </span>
                      </div>
                      <div className="space-y-0.5">
                        {groupItems.map(renderTodoRow)}
                      </div>
                    </section>
                  )
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
