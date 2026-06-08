import { create } from 'zustand'
import type { FileTreeNode } from '../../shared/types'

interface VaultState {
  /** Vault root path */
  vaultPath: string | null
  /** File tree */
  tree: FileTreeNode[]
  /** Loading state */
  loading: boolean

  /** Set vault path */
  setVaultPath: (path: string) => void
  /** Refresh file tree */
  refreshTree: () => Promise<void>
  /** Create a new note */
  createNote: (folderPath: string, title: string) => Promise<void>
  /** Delete a note */
  deleteNote: (filePath: string) => Promise<void>
}

export const useVaultStore = create<VaultState>((set, get) => ({
  vaultPath: null,
  tree: [],
  loading: false,

  setVaultPath: (vaultPath) => set({ vaultPath }),

  refreshTree: async () => {
    set({ loading: true })
    try {
      const tree = await window.mynote.vault.tree()
      set({ tree, loading: false })
    } catch (err) {
      console.error('Failed to refresh tree:', err)
      set({ loading: false })
    }
  },

  createNote: async (folderPath: string, title: string) => {
    try {
      await window.mynote.notes.create(folderPath, title)
      await get().refreshTree()
    } catch (err) {
      console.error('Failed to create note:', err)
    }
  },

  deleteNote: async (filePath: string) => {
    try {
      await window.mynote.notes.delete(filePath)
      await get().refreshTree()
    } catch (err) {
      console.error('Failed to delete note:', err)
    }
  },
}))
