/// <reference types="vite/client" />

import type { MyNoteAPI } from './api'

declare global {
  interface Window {
    mynote: MyNoteAPI
  }
}

export {}
