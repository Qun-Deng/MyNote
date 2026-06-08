import { app, BrowserWindow, ipcMain, dialog } from 'electron'
import path from 'path'
import fs from 'fs'
import { setVaultPath, getVaultPath, registerNotesIPC } from './ipc/notes'
import { registerDiaryIPC } from './ipc/diary'
import { registerTodosIPC } from './ipc/todos'
import { registerSearchIPC } from './ipc/search'
import { initDatabase } from './db/connection'

let mainWindow: BrowserWindow | null = null

// The built directory structure
//
// ├─┬ dist-electron
// │ ├── main.js
// │ └── preload.js
// ├─┬ dist
// │ └── index.html
//
process.env.DIST_ELECTRON = path.join(__dirname)
process.env.DIST = path.join(process.env.DIST_ELECTRON, '../dist')
process.env.PUBLIC = process.env.VITE_DEV_SERVER_URL
  ? path.join(process.env.DIST_ELECTRON, '../public')
  : process.env.DIST

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    frame: false,
    titleBarStyle: 'hidden',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    icon: path.join(process.env.PUBLIC || '', 'icon.png'),
  })

  // Load the app
  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL)
  } else {
    mainWindow.loadFile(path.join(process.env.DIST || '', 'index.html'))
  }

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

// ====== Window Controls ======

ipcMain.handle('window:minimize', () => {
  mainWindow?.minimize()
})

ipcMain.handle('window:maximize', () => {
  if (mainWindow?.isMaximized()) {
    mainWindow.unmaximize()
  } else {
    mainWindow?.maximize()
  }
})

ipcMain.handle('window:close', () => {
  mainWindow?.close()
})

ipcMain.handle('window:is-maximized', () => {
  return mainWindow?.isMaximized() ?? false
})

// ====== IPC: Vault Selection ======

ipcMain.handle('vault:select', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory'],
    title: '选择笔记仓库 (Vault)',
  })
  if (!result.canceled && result.filePaths.length > 0) {
    setVaultPath(result.filePaths[0])
    return result.filePaths[0]
  }
  return null
})

ipcMain.handle('vault:get-path', () => {
  return getVaultPath()
})

ipcMain.handle('vault:init', async (_event, newVaultPath: string) => {
  setVaultPath(newVaultPath)
  // Create basic directory structure
  const dirs = ['notes', 'diary', 'assets']
  for (const dir of dirs) {
    const dirPath = path.join(newVaultPath, dir)
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true })
    }
  }
  // Initialize SQLite database
  try {
    await initDatabase(newVaultPath)
  } catch (err) {
    console.error('Failed to initialize database:', err)
  }
})

ipcMain.handle('vault:move', async (_event, from: string, to: string) => {
  const vaultPath = getVaultPath()
  if (!vaultPath) throw new Error('Vault not initialized')
  const fromFull = path.join(vaultPath, from)
  const toFull = path.join(vaultPath, to)
  if (fs.existsSync(fromFull)) {
    const dir = path.dirname(toFull)
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }
    fs.renameSync(fromFull, toFull)
  }
})

// ====== Register IPC Handlers ======

registerNotesIPC()
registerDiaryIPC()
registerTodosIPC()
registerSearchIPC()

// ====== App Lifecycle ======

app.whenReady().then(() => {
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
