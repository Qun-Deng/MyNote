import { BookOpen, FolderOpen } from 'lucide-react'

interface VaultPromptProps {
  onSelect: () => void
}

export default function VaultPrompt({ onSelect }: VaultPromptProps) {
  return (
    <div className="app-container">
      <div className="flex-1 flex items-center justify-center bg-gradient-to-br from-surface-50 to-surface-100">
        <div className="text-center max-w-md">
          <div className="w-16 h-16 bg-accent-100 rounded-2xl flex items-center justify-center mx-auto mb-6">
            <BookOpen className="w-8 h-8 text-accent-600" />
          </div>
          <h1 className="text-2xl font-bold text-surface-900 mb-2">Welcome to MyNote</h1>
          <p className="text-surface-500 mb-8 leading-relaxed">
            选择一个文件夹作为你的笔记仓库 (Vault)。
            <br />
            所有笔记将以 Markdown 文件的形式保存在本地。
          </p>
          <button
            onClick={onSelect}
            className="inline-flex items-center gap-2 px-6 py-3 bg-accent-600 text-white rounded-lg
                       hover:bg-accent-700 active:bg-accent-800 transition-colors font-medium shadow-sm"
          >
            <FolderOpen className="w-5 h-5" />
            打开文件夹
          </button>
          <div className="mt-6 flex gap-3 justify-center">
            <button
              onClick={onSelect}
              className="text-sm text-surface-400 hover:text-surface-600 transition-colors"
            >
              创建新仓库
            </button>
            <span className="text-surface-300">·</span>
            <button
              onClick={onSelect}
              className="text-sm text-surface-400 hover:text-surface-600 transition-colors"
            >
              打开最近
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
