import { create } from 'zustand'

export type ActiveView = 'dashboard' | 'diary' | 'todo' | 'knowledge'

interface UIState {
  activeView: ActiveView
  openNotePath: string | null
  sidebarOpen: boolean
  searchOpen: boolean
  knowledgeTag: string | null

  setActiveView: (view: ActiveView) => void
  setOpenNotePath: (path: string | null) => void
  toggleSidebar: () => void
  setSearchOpen: (open: boolean) => void
  setKnowledgeTag: (tag: string | null) => void
}

export const useUIStore = create<UIState>((set) => ({
  activeView: 'dashboard',
  openNotePath: null,
  sidebarOpen: true,
  searchOpen: false,
  knowledgeTag: null,

  setActiveView: (activeView) => set({ activeView, openNotePath: null }),
  setOpenNotePath: (openNotePath) => set({ openNotePath }),
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  setSearchOpen: (searchOpen) => set({ searchOpen }),
  setKnowledgeTag: (knowledgeTag) => set({ knowledgeTag }),
}))
