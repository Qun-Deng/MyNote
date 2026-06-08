import { app, BrowserWindow, ipcMain, dialog, Menu, shell } from 'electron'
import path from 'path'
import fs from 'fs'
import { setVaultPath, getVaultPath, registerNotesIPC } from './ipc/notes'
import { registerDiaryIPC } from './ipc/diary'
import { registerTodosIPC } from './ipc/todos'
import { registerSearchIPC } from './ipc/search'
import { initDatabase } from './db/connection'

let mainWindow: BrowserWindow | null = null

// ====== Config Persistence ======

const configPath = path.join(app.getPath('userData'), 'config.json')

function loadConfig(): { vaultPath?: string } {
  try {
    if (fs.existsSync(configPath)) {
      return JSON.parse(fs.readFileSync(configPath, 'utf-8'))
    }
  } catch {}
  return {}
}

function saveConfig(config: { vaultPath?: string }) {
  const dir = path.dirname(configPath)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8')
}

function getSavedVaultPath(): string | null {
  const config = loadConfig()
  if (config.vaultPath && fs.existsSync(config.vaultPath)) {
    return config.vaultPath
  }
  return null
}

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
    saveConfig({ vaultPath: result.filePaths[0] })
    return result.filePaths[0]
  }
  return null
})

ipcMain.handle('vault:get-path', () => {
  return getVaultPath()
})

ipcMain.handle('vault:get-saved-path', () => {
  return getSavedVaultPath()
})

ipcMain.handle('vault:init', async (_event, newVaultPath: string) => {
  setVaultPath(newVaultPath)
  saveConfig({ vaultPath: newVaultPath })
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

ipcMain.handle('vault:create-folder', async (_event, folderPath: string) => {
  const vp = getVaultPath()
  if (!vp) throw new Error('Vault not initialized')
  const fullPath = path.join(vp, folderPath)
  if (!fs.existsSync(fullPath)) {
    fs.mkdirSync(fullPath, { recursive: true })
  }
})

ipcMain.handle('vault:delete-item', async (_event, itemPath: string) => {
  const vp = getVaultPath()
  if (!vp) throw new Error('Vault not initialized')
  const fullPath = path.join(vp, itemPath)
  if (fs.existsSync(fullPath)) {
    const stat = fs.statSync(fullPath)
    if (stat.isDirectory()) {
      fs.rmSync(fullPath, { recursive: true })
    } else {
      fs.unlinkSync(fullPath)
    }
  }
})

ipcMain.handle('vault:show-context-menu', async (_event, itemPath: string, itemType: 'file' | 'directory') => {
  const vp = getVaultPath()
  const targetPath = itemPath || ''
  const targetFullPath = vp ? path.join(vp, targetPath) : null
  const targetExists = !!targetFullPath && fs.existsSync(targetFullPath)
  const targetIsRoot = targetPath === ''
  const rawParentPath = itemType === 'directory' ? targetPath : path.dirname(targetPath)
  const parentPath = rawParentPath === '.' ? '' : rawParentPath
  const newNoteTarget = parentPath || 'notes'

  const template: any[] = [
    {
      label: '新建笔记',
      click: () => {
        mainWindow?.webContents.send('context-menu:new-note', newNoteTarget)
      },
    },
    {
      label: '新建文件夹',
      click: () => {
        mainWindow?.webContents.send('context-menu:new-folder', parentPath)
      },
    },
    { type: 'separator' },
    {
      label: '重命名',
      enabled: !targetIsRoot && targetExists,
      click: () => {
        mainWindow?.webContents.send('context-menu:rename', targetPath)
      },
    },
    { type: 'separator' },
    {
      label: '打开文件资源管理器',
      enabled: !!vp,
      click: async () => {
        if (!vp) return
        if (targetFullPath && targetExists && itemType === 'file') {
          shell.showItemInFolder(targetFullPath)
          return
        }
        await shell.openPath(targetFullPath && targetExists ? targetFullPath : vp)
      },
    },
    { type: 'separator' },
    {
      label: '删除',
      enabled: !targetIsRoot && targetExists,
      click: () => {
        mainWindow?.webContents.send('context-menu:delete', targetPath)
      },
    },
  ]
  const menu = Menu.buildFromTemplate(template)
  menu.popup()
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
