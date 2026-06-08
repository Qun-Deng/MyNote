import { app, BrowserWindow, ipcMain, dialog } from 'electron'
import path from 'path'

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
    mainWindow.webContents.openDevTools()
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

// ====== IPC: Vault Selection ======

let vaultPath: string | null = null

ipcMain.handle('vault:select', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory'],
    title: '选择笔记仓库 (Vault)',
  })
  if (!result.canceled && result.filePaths.length > 0) {
    vaultPath = result.filePaths[0]
    return vaultPath
  }
  return null
})

ipcMain.handle('vault:get-path', () => {
  return vaultPath
})

ipcMain.handle('vault:init', (_event, newVaultPath: string) => {
  vaultPath = newVaultPath
  // TODO: Initialize SQLite DB, create directory structure
})
