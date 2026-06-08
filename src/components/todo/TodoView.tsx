import { CheckSquare, Filter } from 'lucide-react'

export default function TodoView() {
  return (
    <div className="h-full overflow-auto">
      <div className="max-w-3xl mx-auto p-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-surface-900">待办事项</h1>
            <p className="text-sm text-surface-500 mt-1">聚合所有笔记中的待办任务</p>
          </div>
          <button className="flex items-center gap-2 px-3 py-1.5 text-sm text-surface-600
                             bg-surface-100 hover:bg-surface-200 rounded-md transition-colors">
            <Filter className="w-3.5 h-3.5" />
            筛选
          </button>
        </div>

        <div className="flex flex-col items-center justify-center py-16 text-surface-400">
          <CheckSquare className="w-16 h-16 text-surface-200 mb-4" />
          <p className="text-lg font-medium text-surface-500">暂无待办事项</p>
          <p className="text-sm mt-1">
            在笔记中使用 <code className="bg-surface-100 px-1.5 py-0.5 rounded text-xs">- [ ] 任务</code> 语法创建待办
          </p>
          <p className="text-xs text-surface-300 mt-4">待办功能将在 Phase 4 中完善</p>
        </div>
      </div>
    </div>
  )
}
