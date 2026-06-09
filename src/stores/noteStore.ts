import { create } from 'zustand'
import type { NoteMeta, NoteContent } from '../../shared/types'

interface NoteState {
  /** Currently open note metadata */
  currentMeta: NoteMeta | null
  /** Currently open note content (markdown) */
  currentContent: string
  /** Whether the note is loading */
  loading: boolean
  /** Whether there are unsaved changes */
  dirty: boolean

  /** Open a note by path */
  openNote: (filePath: string) => Promise<boolean>
  /** Set content (from editor) */
  setContent: (content: string) => void
  /** Patch currently open note metadata */
  updateCurrentMeta: (patch: Partial<NoteMeta>) => void
  /** Save current note */
  saveNote: () => Promise<void>
  /** Close current note */
  closeNote: () => void
}

export const useNoteStore = create<NoteState>((set, get) => ({
  currentMeta: null,
  currentContent: '',
  loading: false,
  dirty: false,

  openNote: async (filePath: string) => {
    set({ loading: true })
    try {
      const result = await window.mynote.notes.read(filePath)
      if (result) {
        set({
          currentMeta: result.meta,
          currentContent: result.content,
          loading: false,
          dirty: false,
        })
        return true
      } else {
        set({ currentMeta: null, currentContent: '', loading: false, dirty: false })
        return false
      }
    } catch (err) {
      console.error('Failed to open note:', err)
      set({ loading: false })
      return false
    }
  },

  setContent: (content: string) => {
    set({ currentContent: content, dirty: true })
  },

  updateCurrentMeta: (patch: Partial<NoteMeta>) => {
    const { currentMeta } = get()
    if (!currentMeta) return
    set({ currentMeta: { ...currentMeta, ...patch } })
  },

  saveNote: async () => {
    const { currentMeta, currentContent } = get()
    if (!currentMeta) return

    try {
      await window.mynote.notes.write(currentMeta.path, currentContent)
      // Sync diary todos to todoPage on save
      if (currentMeta.is_diary && currentMeta.diary_date) {
        await window.mynote.diary.syncToPage(currentMeta.diary_date)
      }
      set({ dirty: false })
    } catch (err) {
      console.error('Failed to save note:', err)
    }
  },

  closeNote: () => {
    set({ currentMeta: null, currentContent: '', dirty: false })
  },
}))
