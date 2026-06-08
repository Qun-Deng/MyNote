import { ipcMain } from 'electron'
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'

let vaultPath: string | null = null

export function setVaultPath(p: string | null) {
  vaultPath = p
}

export function registerAssetsIPC() {
  // Save a binary asset (image, etc.) and return its relative path
  ipcMain.handle('assets:save-image', async (_event, buffer: ArrayBuffer, filename: string) => {
    if (!vaultPath) throw new Error('Vault not initialized')

    const assetsDir = path.join(vaultPath, 'assets')
    if (!fs.existsSync(assetsDir)) {
      fs.mkdirSync(assetsDir, { recursive: true })
    }

    // Generate unique filename to avoid collisions
    const ext = path.extname(filename).toLowerCase() || '.png'
    const hash = crypto.randomBytes(4).toString('hex')
    const baseName = path.basename(filename, ext).replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 40)
    const finalName = `${baseName}-${hash}${ext}`
    const filePath = path.join(assetsDir, finalName)

    fs.writeFileSync(filePath, Buffer.from(buffer))

    // Return path relative to vault root
    return `assets/${finalName}`
  })
}
