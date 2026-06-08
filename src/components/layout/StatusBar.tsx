import { useEffect, useState } from 'react'

export default function StatusBar() {
  const [vaultPath, setVaultPath] = useState<string | null>(null)

  useEffect(() => {
    window.mynote.vault.getPath().then(setVaultPath)
  }, [])

  return (
    <div className="statusbar">
      <span>{vaultPath || '未选择仓库'}</span>
      <span className="ml-auto">MyNote v0.1.0</span>
    </div>
  )
}
