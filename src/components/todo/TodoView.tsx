import { useEffect, useState } from 'react'
import { CheckSquare, Filter, FileText, Check, Square } from 'lucide-react'
import type { TodoItem } from '../../../shared/types'
import { useNoteStore } from '../../stores/noteStore'
import { useUIStore } from '../../stores/uiStore'

type FilterMode = 'all' | 'pending' | 'completed'

export default function TodoView() {
  const [todos, setTodos] = useState<TodoItem[]>([])
  const [filter, setFilter] = useState<FilterMode>('pending')
  const [loading, setLoading] = useState(true)

  const openNote = useNoteStore((s) => s.openNote)
  const setOpenNotePath = useUIStore((s) => s.setOpenNotePath)

  const loadTodos = async () => {
    try {
      const completed = filter === 'all' ? undefined : filter === 'completed'
      const items = await window.mynote.todos.list(
        filter === 'all' ? undefined : { completed }
      )
      setTodos(items)
    } catch {
      setTodos([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    setLoading(true)
    loadTodos()
  }, [filter])

  const handleToggle = async (todo: TodoItem) => {
    try {
      await window.mynote.todos.toggle(todo.id)
      // Optimistic update
      setTodos((prev) =>
        prev.map((t) =>
          t.id === todo.id ? { ...t, completed: !t.completed } : t
        )
      )
      // Reload
      setTimeout(() => loadTodos(), 300)
    } catch (err) {
      console.error('Failed to toggle todo:', err)
    }
  }

  const handleOpenNote = async (filePath: string) => {
    await openNote(filePath)
    setOpenNotePath(filePath)
  }

  // Group todos by note
  const grouped = new Map<string, TodoItem[]>()
  for (const todo of todos) {
    const existing = grouped.get(todo.note_path) || []
    existing.push(todo)
    grouped.set(todo.note_path, existing)
  }

  const filterOptions: { value: FilterMode; label: string }[] = [
    { value: 'pending', label: '未完成' },
    { value: 'completed', label: '已完成' },
    { value: 'all', label: '全部' },
  ]

  return (
    <div className="h-full overflow-auto">
      <div className="max-w-3xl mx-auto p-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-surface-900">待办事项</h1>
            <p className="text-sm text-surface-500 mt-1">
              聚合所有笔记中的待办任务
            </p>
          </div>
          <button
            onClick={() => window.mynote.todos.syncAll().then(() => loadTodos())}
            className="text-xs text-accent-600 hover:text-accent-700 font-medium"
          >
            刷新待办
          </button>
        </div>

        {/* Filters */}
        <div className="flex gap-2 mb-6">
          {filterOptions.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setFilter(opt.value)}
              className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
                filter === opt.value
                  ? 'bg-accent-50 text-accent-700 font-medium'
                  : 'text-surface-500 hover:bg-surface-100'
              }`}
            >
              {opt.label}
            </button>
          ))}
          <span className="ml-auto text-xs text-surface-400 self-center">
            {todos.length} 条
          </span>
        </div>

        {loading ? (
          <div className="text-center py-16 text-surface-400">
            <p className="text-sm">加载中...</p>
          </div>
        ) : todos.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-surface-400">
            <CheckSquare className="w-16 h-16 text-surface-200 mb-4" />
            <p className="text-lg font-medium text-surface-500">
              {filter === 'completed' ? '暂无已完成的待办' : '暂无待办事项'}
            </p>
            <p className="text-sm mt-1">
              在笔记中使用{' '}
              <code className="bg-surface-100 px-1.5 py-0.5 rounded text-xs">
                - [ ] 任务
              </code>{' '}
              语法创建待办
            </p>
          </div>
        ) : (
          <div className="space-y-6">
            {Array.from(grouped.entries()).map(([notePath, items]) => (
              <div key={notePath}>
                <button
                  onClick={() => handleOpenNote(notePath)}
                  className="flex items-center gap-2 text-xs text-surface-500 mb-2 hover:text-accent-600 transition-colors"
                >
                  <FileText className="w-3 h-3" />
                  {notePath}
                </button>
                <div className="space-y-1">
                  {items.map((todo) => (
                    <button
                      key={todo.id}
                      onClick={() => handleToggle(todo)}
                      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-md text-left transition-colors ${
                        todo.completed
                          ? 'text-surface-400 hover:bg-surface-50'
                          : 'text-surface-700 hover:bg-surface-50'
                      }`}
                    >
                      {todo.completed ? (
                        <Check className="w-4 h-4 text-emerald-500 flex-shrink-0" />
                      ) : (
                        <Square className="w-4 h-4 text-surface-300 flex-shrink-0" />
                      )}
                      <span className={todo.completed ? 'line-through' : ''}>
                        {todo.content}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
