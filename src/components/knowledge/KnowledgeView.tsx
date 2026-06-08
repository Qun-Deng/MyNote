import { Library, Search, FolderTree, Tag } from 'lucide-react'

export default function KnowledgeView() {
  return (
    <div className="h-full flex">
      {/* Folder Panel */}
      <div className="w-56 flex-shrink-0 border-r border-surface-200 p-4">
        <div className="flex items-center gap-2 mb-4">
          <FolderTree className="w-4 h-4 text-surface-500" />
          <h2 className="text-sm font-semibold text-surface-700">文件夹</h2>
        </div>
        <div className="text-xs text-surface-400 py-2">暂无文件夹</div>
      </div>

      {/* Note List */}
      <div className="w-72 flex-shrink-0 border-r border-surface-200 p-4">
        <div className="flex items-center gap-2 mb-4">
          <Search className="w-4 h-4 text-surface-500" />
          <input
            type="text"
            placeholder="搜索笔记..."
            className="flex-1 text-sm bg-transparent outline-none placeholder:text-surface-300"
            disabled
          />
        </div>
        <div className="text-xs text-surface-400 py-2">暂无笔记</div>
      </div>

      {/* Info Panel */}
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center text-surface-400">
          <Library className="w-12 h-12 mx-auto mb-3 text-surface-200" />
          <p className="text-sm font-medium text-surface-500">知识库</p>
          <p className="text-xs mt-1">组织你的笔记，建立连接</p>
          <div className="flex gap-2 mt-4 justify-center">
            <span className="flex items-center gap-1 text-xs bg-surface-100 px-2 py-1 rounded">
              <Tag className="w-3 h-3" /> 标签
            </span>
            <span className="flex items-center gap-1 text-xs bg-surface-100 px-2 py-1 rounded">
              🔗 反向链接
            </span>
          </div>
          <p className="text-xs text-surface-300 mt-4">知识库功能将在 Phase 4 中完善</p>
        </div>
      </div>
    </div>
  )
}
