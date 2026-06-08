import { useEffect, useState } from 'react'
import { ArrowDown, ArrowUp } from 'lucide-react'

export default function StatusBar() {
  const [vaultPath, setVaultPath] = useState<string | null>(null)
  const [gitMsg, setGitMsg] = useState<string | null>(null)

  useEffect(() => {
    window.mynote.vault.getPath().then(setVaultPath)
  }, [])

  const showResult = (msg: string) => {
    setGitMsg(msg)
    setTimeout(() => setGitMsg(null), 4000)
  }

  const handlePull = async () => {
    setGitMsg('⏳ Pulling...')
    const r = await window.mynote.git.pull()
    showResult(r.success ? `↓ ${r.output.slice(0, 80)}` : `✗ ${r.output.slice(0, 80)}`)
  }

  const handlePush = async () => {
    setGitMsg('⏳ Pushing...')
    const r = await window.mynote.git.push()
    showResult(r.success ? `↑ ${r.output.slice(0, 80)}` : `✗ ${r.output.slice(0, 80)}`)
  }

  return (
    <div className="statusbar">
      <span className="truncate">{vaultPath || '未选择仓库'}</span>

      {gitMsg && (
        <span className="text-xs text-accent-600 truncate max-w-[320px]">{gitMsg}</span>
      )}

      <div className="ml-auto flex items-center gap-3">
        <button
          onClick={handlePull}
          className="flex items-center gap-1 text-[11px] text-surface-500 hover:text-accent-600 transition-colors"
          title="Git Pull"
        >
          <ArrowDown className="w-3 h-3" />
          拉取
        </button>
        <button
          onClick={handlePush}
          className="flex items-center gap-1 text-[11px] text-surface-500 hover:text-accent-600 transition-colors"
          title="Git Push"
        >
          <ArrowUp className="w-3 h-3" />
          推送
        </button>
        <span>MyNote v0.1.0</span>
      </div>
    </div>
  )
}
