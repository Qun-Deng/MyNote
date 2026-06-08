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
    setArchived: (filePath: string, archived: boolean) => ipcRenderer.invoke('notes:set-archived', filePath, archived),
    setPinned: (filePath: string, pinned: boolean) => ipcRenderer.invoke('notes:set-pinned', filePath, pinned),
    batchArchive: (filePaths: string[], archived: boolean) => ipcRenderer.invoke('notes:batch-archive', filePaths, archived),
    batchDelete: (filePaths: string[]) => ipcRenderer.invoke('notes:batch-delete', filePaths),
    batchTag: (filePaths: string[], tag: string) => ipcRenderer.invoke('notes:batch-tag', filePaths, tag),
    updateLinks: (filePath: string, links: { target: string; context: string }[]) => ipcRenderer.invoke('notes:update-links', filePath, links),
    backlinks: (notePath: string) => ipcRenderer.invoke('notes:backlinks', notePath),
    forwardLinks: (notePath: string) => ipcRenderer.invoke('notes:forward-links', notePath),
    stats: (filePath: string) => ipcRenderer.invoke('notes:stats', filePath),
  },

  // Tags
  tags: {
    rename: (oldName: string, newName: string) => ipcRenderer.invoke('tags:rename', oldName, newName),
    delete: (tagName: string) => ipcRenderer.invoke('tags:delete', tagName),
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
    add: (notePath: string, content: string, deadline?: string) => ipcRenderer.invoke('todos:add', notePath, content, deadline),
    delete: (todoId: number) => ipcRenderer.invoke('todos:delete', todoId),
    updateDeadline: (todoId: number, deadline: string | null) => ipcRenderer.invoke('todos:update-deadline', todoId, deadline),
  },

  // Todo Page — independent JSON-based storage
  todoPage: {
    list: () => ipcRenderer.invoke('todo-page:list'),
    add: (content: string, section: string) => ipcRenderer.invoke('todo-page:add', content, section),
    delete: (id: string) => ipcRenderer.invoke('todo-page:delete', id),
    toggle: (id: string) => ipcRenderer.invoke('todo-page:toggle', id),
  },

  // Search
  search: {
    query: (query: string) => ipcRenderer.invoke('search:query', query),
    reindex: () => ipcRenderer.invoke('search:reindex'),
  },

  // Git
  git: {
    status: () => ipcRenderer.invoke('git:status'),
    pull: () => ipcRenderer.invoke('git:pull'),
    push: () => ipcRenderer.invoke('git:push'),
  },

  // Export
  export: {
    pdf: (markdown: string, title: string) => ipcRenderer.invoke('export:pdf', markdown, title),
  },

  // PDF
  pdf: {
    read: (filePath: string) => ipcRenderer.invoke('pdf:read', filePath),
    readAnnotations: (pdfPath: string) => ipcRenderer.invoke('pdf:read-annotations', pdfPath),
    writeAnnotations: (pdfPath: string, data: any) => ipcRenderer.invoke('pdf:write-annotations', pdfPath, data),
  },
}

contextBridge.exposeInMainWorld('mynote', api)

// Type declaration for renderer
export type MyNoteAPI = typeof api
