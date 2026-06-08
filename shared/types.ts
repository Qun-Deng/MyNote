// ====== Data Types ======

export interface NoteMeta {
  id: number
  path: string
  title: string
  created_at: string
  updated_at: string
  tags: string[]
  is_diary: boolean
  diary_date: string | null
}

export interface NoteContent {
  meta: NoteMeta
  content: string
}

export interface TodoItem {
  id: number
  note_path: string
  content: string
  completed: boolean
  line_number: number
  created_at: string
  completed_at: string | null
  priority: number
  deadline: string | null
}

export interface SearchResult {
  path: string
  title: string
  snippet: string
  rank: number
}

export interface FileTreeNode {
  name: string
  path: string
  type: 'file' | 'directory'
  children?: FileTreeNode[]
}

export interface DiaryMonthData {
  date: string
  hasEntry: boolean
}

// ====== IPC Channel Definitions ======

export interface IpcChannels {
  // Notes
  'notes:list': {
    args: []
    result: NoteMeta[]
  }
  'notes:read': {
    args: [filePath: string]
    result: NoteContent | null
  }
  'notes:write': {
    args: [filePath: string, content: string]
    result: void
  }
  'notes:create': {
    args: [folderPath: string, title: string]
    result: NoteMeta
  }
  'notes:delete': {
    args: [filePath: string]
    result: void
  }
  'notes:rename': {
    args: [oldPath: string, newPath: string]
    result: string
  }

  // Diary
  'diary:get': {
    args: [date: string]
    result: NoteMeta | null
  }
  'diary:get-month': {
    args: [year: number, month: number]
    result: DiaryMonthData[]
  }
  'diary:create': {
    args: [date: string]
    result: NoteMeta
  }

  // Todos
  'todos:list': {
    args: [filter?: { completed?: boolean }]
    result: TodoItem[]
  }
  'todos:toggle': {
    args: [todoId: number]
    result: void
  }
  'todos:sync-all': {
    args: []
    result: void
  }
  'todos:extract': {
    args: [filePath: string, content: string]
    result: void
  }
  'todos:add': {
    args: [notePath: string, content: string, deadline?: string]
    result: TodoItem
  }
  'todos:delete': {
    args: [todoId: number]
    result: void
  }
  'todos:update-deadline': {
    args: [todoId: number, deadline: string | null]
    result: void
  }

  // Search
  'search:query': {
    args: [query: string]
    result: SearchResult[]
  }
  'search:reindex': {
    args: []
    result: void
  }

  // Vault
  'vault:init': {
    args: [vaultPath: string]
    result: void
  }
  'vault:tree': {
    args: []
    result: FileTreeNode[]
  }
  'vault:move': {
    args: [from: string, to: string]
    result: void
  }
  'vault:get-path': {
    args: []
    result: string | null
  }
  'vault:select': {
    args: []
    result: string | null
  }
}
