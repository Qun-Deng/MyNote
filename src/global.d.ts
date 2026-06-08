import type { MyNoteAPI } from '../electron/preload'

declare global {
  interface Window {
    mynote: MyNoteAPI
  }
}

export {}
