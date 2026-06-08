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
  openNote: (filePath: string) => Promise<void>
  /** Set content (from editor) */
  setContent: (content: string) => void
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
      } else {
        set({ loading: false })
      }
    } catch (err) {
      console.error('Failed to open note:', err)
      set({ loading: false })
    }
  },

  setContent: (content: string) => {
    set({ currentContent: content, dirty: true })
  },

  saveNote: async () => {
    const { currentMeta, currentContent } = get()
    if (!currentMeta) return

    try {
      await window.mynote.notes.write(currentMeta.path, currentContent)
      // Also extract todos
      await window.mynote.todos.extract(currentMeta.path, currentContent)
      set({ dirty: false })
    } catch (err) {
      console.error('Failed to save note:', err)
    }
  },

  closeNote: () => {
    set({ currentMeta: null, currentContent: '', dirty: false })
  },
}))
