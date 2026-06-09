/**
 * Tauri API bridge — replaces electron/preload.ts
 *
 * All backend operations go through this typed wrapper.
 * Custom commands use invoke(), window/dialog/fs use @tauri-apps/api.
 */
import { invoke } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'

// Re-export types from shared
export type {
  NoteMeta,
  NoteContent,
  TodoItem,
  SearchResult,
  FileTreeNode,
  DiaryMonthData,
  Backlink,
  NoteStats,
} from '../shared/types'

// ── Window controls ──

const windowApi = {
  minimize: () => getCurrentWindow().minimize(),
  maximize: () => getCurrentWindow().toggleMaximize(),
  close: () => getCurrentWindow().close(),
  isMaximized: () => getCurrentWindow().isMaximized(),
  onMaximizeChange: (callback: (maximized: boolean) => void) => {
    const unlisten = getCurrentWindow().onResized(() => {
      getCurrentWindow().isMaximized().then(callback)
    })
    return () => {
      unlisten.then((fn) => fn())
    }
  },
}

// ── Vault ──

const vaultApi = {
  select: () => invoke<string | null>('vault_select'),
  getPath: () => invoke<string | null>('vault_get_path'),
  getSavedPath: () => invoke<string | null>('vault_get_saved_path'),
  init: (vaultPath: string) => invoke('vault_init', { newVaultPath: vaultPath }),
  tree: () => invoke<any[]>('vault_tree'),
  move: (from: string, to: string) => invoke('vault_move', { from, to }),
  createFolder: (folderPath: string) => invoke('vault_create_folder', { folderPath }),
  deleteItem: (itemPath: string) => invoke('vault_delete_item', { itemPath }),
  openInExplorer: (itemPath: string) => invoke('vault_open_in_explorer', { itemPath }),
  showContextMenu: async (itemPath: string, itemType: 'file' | 'directory') => {
    // Context menu is handled via Tauri menu API — simplified for now
    console.log('Context menu:', itemPath, itemType)
  },
  onContextMenuAction: (callback: (action: string, targetPath: string) => void) => {
    // Will be implemented with Tauri menu events
    return () => {}
  },
  onChanged: (callback: () => void) => {
    // Listen for vault change events
    let unlisten: (() => void) | null = null
    let active = true
    import('@tauri-apps/api/event').then(({ listen }) => {
      if (!active) return
      listen('vault:changed', () => {
        callback()
      }).then(fn => {
        if (!active) { fn(); return }
        unlisten = fn
      })
    })
    return () => {
      active = false
      unlisten?.()
    }
  },
}

// ── Notes ──

const notesApi = {
  list: () => invoke<any[]>('notes_list'),
  read: (filePath: string) => invoke<any | null>('notes_read', { path: filePath }),
  write: (filePath: string, content: string) =>
    invoke('notes_write', { request: { path: filePath, content } }),
  create: (folderPath: string, title: string) =>
    invoke<any>('notes_create', { folderPath, title }),
  delete: (filePath: string) => invoke('notes_delete', { path: filePath }),
  rename: (oldPath: string, newPath: string) =>
    invoke<string>('notes_rename', { oldPath, newPath }),
  recent: () => invoke<any[]>('notes_recent'),
  tags: () => invoke<string[]>('notes_tags'),
  byTag: (tag: string) => invoke<any[]>('notes_by_tag', { tag }),
  setArchived: (filePath: string, archived: boolean) =>
    invoke('notes_set_archived', { filePath, archived }),
  setPinned: (filePath: string, pinned: boolean) =>
    invoke('notes_set_pinned', { filePath, pinned }),
  batchArchive: (filePaths: string[], archived: boolean) =>
    invoke('notes_batch_archive', { filePaths, archived }),
  batchDelete: (filePaths: string[]) =>
    invoke('notes_batch_delete', { filePaths }),
  batchTag: (filePaths: string[], tag: string) =>
    invoke('notes_batch_tag', { filePaths, tag }),
  updateLinks: (filePath: string, links: { target: string; context: string }[]) =>
    invoke('notes_update_links', { filePath, links }),
  backlinks: (notePath: string) => invoke<any[]>('notes_backlinks', { notePath }),
  forwardLinks: (notePath: string) => invoke<string[]>('notes_forward_links', { notePath }),
  stats: (filePath: string) => invoke<any | null>('notes_stats', { filePath }),
}

// ── Tags ──

const tagsApi = {
  rename: (oldName: string, newName: string) =>
    invoke<string[]>('tags_rename', { oldName, newName }),
  delete: (tagName: string) => invoke<string[]>('tags_delete', { tagName }),
}

// ── Diary ──

const diaryApi = {
  get: (date: string) => invoke<any | null>('diary_get', { date }),
  getMonth: (year: number, month: number) =>
    invoke<any[]>('diary_get_month', { year, month }),
  getRange: (startDate: string, endDate: string) =>
    invoke<any[]>('diary_get_range', { startDate, endDate }),
  create: (date: string) => invoke<any>('diary_create', { date }),
  syncFromPage: (date: string) => invoke('diary_sync_from_page', { date }),
  syncToPage: (date: string) => invoke('diary_sync_to_page', { date }),
}

// ── Todos ──

const todosApi = {
  list: (filter?: { completed?: boolean }) =>
    invoke<any[]>('todos_list', { filter: filter ?? null }),
  toggle: (todoId: number) => invoke('todos_toggle', { todoId }),
  add: (notePath: string, content: string, deadline?: string) =>
    invoke<any>('todos_add', { notePath, content, deadline: deadline ?? null }),
  delete: (todoId: number) => invoke('todos_delete', { todoId }),
  syncAll: () => invoke('todos_sync_all'),
  extract: (filePath: string, content: string) => invoke('todos_extract'),
  updateDeadline: (todoId: number, deadline: string | null) =>
    invoke('todos_update_deadline', { todoId, deadline }),
}

const todoPageApi = {
  list: () => invoke<any[]>('todo_page_list'),
  add: (content: string, section: string) =>
    invoke<any>('todo_page_add', { content, section }),
  delete: (id: string) => invoke('todo_page_delete', { id }),
  toggle: (id: string) => invoke('todo_page_toggle', { id }),
}

// ── DDL (Deadlines) ──

const ddlApi = {
  list: () => invoke<any[]>('ddl_list'),
  add: (content: string, deadline: string) =>
    invoke<any>('ddl_add', { content, deadline }),
  delete: (id: string) => invoke('ddl_delete', { id }),
}

// ── Search ──

const searchApi = {
  query: (query: string) => invoke<any[]>('search_query', { query }),
  reindex: () => invoke('search_reindex'),
}

// ── Git ──

const gitApi = {
  status: () => invoke<{ success: boolean; output: string }>('git_status'),
  pull: () => invoke<{ success: boolean; output: string }>('git_pull'),
  push: () => invoke<{ success: boolean; output: string }>('git_push'),
}

// ── Export ──

const exportApi = {
  pdf: async (markdown: string, title: string) => {
    try {
      // Generate HTML via Rust
      const html = await invoke<string>('export_markdown_to_html', { markdown, title })
      // Open print dialog via browser
      const printWindow = window.open('', '_blank', 'width=800,height=600')
      if (printWindow) {
        printWindow.document.write(html)
        printWindow.document.close()
        printWindow.focus()
        printWindow.print()
      }
      return { success: true, output: 'Sent to printer' }
    } catch (err) {
      return { success: false, output: String(err) }
    }
  },
}

// ── PDF ──

const pdfApi = {
  read: (filePath: string) => invoke<string>('pdf_read', { filePath }),
  readAnnotations: (pdfPath: string) => invoke<any>('pdf_read_annotations', { pdfPath }),
  writeAnnotations: (pdfPath: string, data: any) =>
    invoke('pdf_write_annotations', { pdfPath, data }),
}

// ── Assets ──

const assetsApi = {
  saveImage: (buffer: ArrayBuffer, filename: string) =>
    invoke<string>('assets_save_image', { buffer: Array.from(new Uint8Array(buffer)), filename }),
  readDataUrl: (relPath: string) => invoke<string>('assets_read_data_url', { relPath }),
}

// ── Combined API ──

const api = {
  window: windowApi,
  vault: vaultApi,
  notes: notesApi,
  tags: tagsApi,
  diary: diaryApi,
  todos: todosApi,
  todoPage: todoPageApi,
  ddl: ddlApi,
  search: searchApi,
  git: gitApi,
  export: exportApi,
  pdf: pdfApi,
  assets: assetsApi,
}

export type MyNoteAPI = typeof api
export { api }
