import { Minus, Square, X, Maximize2 } from 'lucide-react'
import { useEffect, useState } from 'react'

export default function Titlebar() {
  const [isMaximized, setIsMaximized] = useState(false)

  useEffect(() => {
    const cleanup = window.mynote.window.onMaximizeChange(setIsMaximized)
    window.mynote.window.isMaximized().then(setIsMaximized)
    return cleanup
  }, [])

  return (
    <div className="titlebar">
      <div className="flex items-center gap-2 text-xs font-medium text-surface-600 pl-2">
        <span className="text-accent-600 font-semibold">MyNote</span>
      </div>
      <div className="titlebar-buttons flex items-center">
        <button
          onClick={() => window.mynote.window.minimize()}
          className="h-8 w-10 flex items-center justify-center hover:bg-surface-200 rounded transition-colors"
        >
          <Minus className="w-3.5 h-3.5 text-surface-600" />
        </button>
        <button
          onClick={() => window.mynote.window.maximize()}
          className="h-8 w-10 flex items-center justify-center hover:bg-surface-200 rounded transition-colors"
        >
          {isMaximized ? (
            <Maximize2 className="w-3.5 h-3.5 text-surface-600" />
          ) : (
            <Square className="w-3 h-3 text-surface-600" />
          )}
        </button>
        <button
          onClick={() => window.mynote.window.close()}
          className="h-8 w-10 flex items-center justify-center hover:bg-red-100 hover:text-red-600 rounded transition-colors"
        >
          <X className="w-3.5 h-3.5 text-surface-600" />
        </button>
      </div>
    </div>
  )
}
