import { create } from 'zustand'

interface TabInfo {
  path: string
  title: string
}

interface TabContentCache {
  content: string
  dirty: boolean
}

interface TabState {
  tabs: TabInfo[]
  activeTabPath: string | null
  contentCache: Record<string, TabContentCache>

  openTab: (path: string, title: string, content?: string) => void
  closeTab: (path: string) => void
  setActiveTab: (path: string) => void
  updateTabTitle: (path: string, title: string) => void
  cacheContent: (path: string, content: string, dirty: boolean) => void
  getCached: (path: string) => TabContentCache | undefined
  clearCache: (path: string) => void
}

export const useTabStore = create<TabState>((set, get) => ({
  tabs: [],
  activeTabPath: null,
  contentCache: {},

  openTab: (path, title, content) => {
    const { tabs, contentCache } = get()
    const existing = tabs.find(t => t.path === path)
    if (existing) {
      // Switch to existing tab
      set({ activeTabPath: path })
    } else {
      // Add new tab
      const newCache = { ...contentCache }
      if (content !== undefined) {
        newCache[path] = { content, dirty: false }
      }
      set({
        tabs: [...tabs, { path, title }],
        activeTabPath: path,
        contentCache: newCache,
      })
    }
  },

  closeTab: (path) => {
    const { tabs, activeTabPath, contentCache } = get()
    const idx = tabs.findIndex(t => t.path === path)
    if (idx === -1) return

    const newTabs = tabs.filter(t => t.path !== path)
    const newCache = { ...contentCache }
    delete newCache[path]

    let newActive = activeTabPath
    if (activeTabPath === path) {
      // Switch to adjacent tab
      if (newTabs.length === 0) {
        newActive = null
      } else if (idx >= newTabs.length) {
        newActive = newTabs[newTabs.length - 1].path
      } else {
        newActive = newTabs[idx].path
      }
    }

    set({
      tabs: newTabs,
      activeTabPath: newActive,
      contentCache: newCache,
    })
  },

  setActiveTab: (path) => {
    set({ activeTabPath: path })
  },

  updateTabTitle: (path, title) => {
    set(s => ({
      tabs: s.tabs.map(t => t.path === path ? { ...t, title } : t),
    }))
  },

  cacheContent: (path, content, dirty) => {
    set(s => ({
      contentCache: { ...s.contentCache, [path]: { content, dirty } },
    }))
  },

  getCached: (path) => {
    return get().contentCache[path]
  },

  clearCache: (path) => {
    set(s => {
      const newCache = { ...s.contentCache }
      delete newCache[path]
      return { contentCache: newCache }
    })
  },
}))
