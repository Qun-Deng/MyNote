import { ipcMain } from 'electron'
import { exec } from 'child_process'
import { getVaultPath } from './notes'

function runGit(args: string): Promise<{ success: boolean; output: string }> {
  return new Promise((resolve) => {
    const vaultPath = getVaultPath()
    if (!vaultPath) {
      resolve({ success: false, output: 'Vault not initialized' })
      return
    }

    exec(`git ${args}`, { cwd: vaultPath, timeout: 30000 }, (err, stdout, stderr) => {
      if (err) {
        resolve({ success: false, output: stderr || err.message })
      } else {
        resolve({ success: true, output: stdout || stderr || 'OK' })
      }
    })
  })
}

export function registerGitIPC() {
  ipcMain.handle('git:status', async () => {
    return runGit('status --porcelain')
  })

  ipcMain.handle('git:pull', async () => {
    return runGit('pull --rebase')
  })

  ipcMain.handle('git:push', async () => {
    return runGit('push')
  })
}
