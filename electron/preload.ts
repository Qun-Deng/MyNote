import { contextBridge, ipcRenderer } from 'electron'

// Type-safe IPC wrapper exposed to the renderer process
const api = {
  // Window controls
  window: {
    minimize: () => ipcRenderer.invoke('window:minimize'),
    maximize: () => ipcRenderer.invoke('window:maximize'),
    close: () => ipcRenderer.invoke('window:close'),
    isMaximized: () => ipcRenderer.invoke('window:is-maximized'),
    onMaximizeChange: (callback: (maximized: boolean) => void) => {
      const handler = () => {
        ipcRenderer.invoke('window:is-maximized').then(callback)
      }
      window.addEventListener('resize', handler)
      return () => window.removeEventListener('resize', handler)
    },
  },

  // Vault
  vault: {
    select: () => ipcRenderer.invoke('vault:select'),
    getPath: () => ipcRenderer.invoke('vault:get-path'),
    getSavedPath: () => ipcRenderer.invoke('vault:get-saved-path'),
    init: (vaultPath: string) => ipcRenderer.invoke('vault:init', vaultPath),
    tree: () => ipcRenderer.invoke('vault:tree'),
    move: (from: string, to: string) => ipcRenderer.invoke('vault:move', from, to),
    createFolder: (folderPath: string) => ipcRenderer.invoke('vault:create-folder', folderPath),
    deleteItem: (itemPath: string) => ipcRenderer.invoke('vault:delete-item', itemPath),
    showContextMenu: (itemPath: string, itemType: 'file' | 'directory') =>
      ipcRenderer.invoke('vault:show-context-menu', itemPath, itemType),
    onContextMenuAction: (callback: (action: string, targetPath: string) => void) => {
      const handlers: { [key: string]: (_event: any, p: string) => void } = {
        'context-menu:new-note': (_e, p) => callback('new-note', p),
        'context-menu:new-folder': (_e, p) => callback('new-folder', p),
        'context-menu:rename': (_e, p) => callback('rename', p),
        'context-menu:delete': (_e, p) => callback('delete', p),
      }
      Object.entries(handlers).forEach(([channel, handler]) => {
        ipcRenderer.on(channel, handler)
      })
      return () => {
        Object.entries(handlers).forEach(([channel, handler]) => {
          ipcRenderer.removeListener(channel, handler)
        })
      }
    },
  },

  // Notes
  notes: {
    list: () => ipcRenderer.invoke('notes:list'),
    read: (filePath: string) => ipcRenderer.invoke('notes:read', filePath),
    write: (filePath: string, content: string) => ipcRenderer.invoke('notes:write', filePath, content),
    create: (folderPath: string, title: string) => ipcRenderer.invoke('notes:create', folderPath, title),
    delete: (filePath: string) => ipcRenderer.invoke('notes:delete', filePath),
    rename: (oldPath: string, newPath: string) => ipcRenderer.invoke('notes:rename', oldPath, newPath),
    recent: () => ipcRenderer.invoke('notes:recent'),
    tags: () => ipcRenderer.invoke('notes:tags'),
    byTag: (tag: string) => ipcRenderer.invoke('notes:by-tag', tag),
  },

  // Diary
  diary: {
    get: (date: string) => ipcRenderer.invoke('diary:get', date),
    getMonth: (year: number, month: number) => ipcRenderer.invoke('diary:get-month', year, month),
    getRange: (startDate: string, endDate: string) => ipcRenderer.invoke('diary:get-range', startDate, endDate),
    create: (date: string) => ipcRenderer.invoke('diary:create', date),
  },

  // Todos
  todos: {
    list: (filter?: { completed?: boolean }) => ipcRenderer.invoke('todos:list', filter),
    toggle: (todoId: number) => ipcRenderer.invoke('todos:toggle', todoId),
    syncAll: () => ipcRenderer.invoke('todos:sync-all'),
    extract: (filePath: string, content: string) => ipcRenderer.invoke('todos:extract', filePath, content),
  },

  // Search
  search: {
    query: (query: string) => ipcRenderer.invoke('search:query', query),
    reindex: () => ipcRenderer.invoke('search:reindex'),
  },
}

contextBridge.exposeInMainWorld('mynote', api)

// Type declaration for renderer
export type MyNoteAPI = typeof api
