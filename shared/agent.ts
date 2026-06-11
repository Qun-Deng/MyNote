import type { Backlink, NoteMeta } from './types'

export type AgentAction =
  | 'summarize_note'
  | 'extract_todos'
  | 'rewrite_selection'
  | 'suggest_tags_links'
  | 'free_chat'
  | 'create_new_note'   // Phase 3: AI generates a new note
  | 'generate_content'   // Phase 3: AI generates content to append

export interface AgentMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
}

export interface AgentContext {
  noteMeta: NoteMeta | null
  noteContent: string
  selectedText?: string
  truncated?: boolean
  linkedNotes?: LinkedNoteContent[]
  isMultiNote?: boolean
}

export interface AgentChatRequest {
  messages: AgentMessage[]
  action: AgentAction
  context: AgentContext
  providerConfig?: AgentProviderConfig
  vaultPath?: string  // Phase 2: vault root path for tool file access
}

export interface AgentProviderConfig {
  apiKey?: string
  baseURL?: string
  model?: string
}

export interface AgentDraft {
  id: string
  action: Extract<AgentAction, 'extract_todos' | 'rewrite_selection' | 'create_new_note' | 'generate_content'>
  title: string
  description: string
  originalContent: string
  nextContent: string
  /** Phase 3: target folder for create_new_note */
  newNoteFolder?: string
  /** Phase 3: note title for create_new_note */
  newNoteTitle?: string
}

export interface AgentSelection {
  text: string
  from: number
  to: number
}

// ── Phase 1: Enriched Context Types ──

/** Content of a note linked to/from the current note (editor mode) */
export interface LinkedNoteContent {
  path: string
  title: string
  content: string
  relation: 'backlink' | 'forward_link'
}

/** Full data for a note selected in knowledge AI-context mode */
export interface SelectedNoteData {
  meta: NoteMeta
  content: string
  backlinks: Backlink[]
  forwardLinks: string[]
  linkedContents: LinkedNoteContent[]
}

/** AI run phase — drives the frontend progress display replacing "思考中..." */
export type AgentRunState =
  | { phase: 'idle' }
  | { phase: 'preparing'; detail: string }
  | { phase: 'sending' }
  | { phase: 'executing'; detail: string }  // Phase 2: AI is executing a tool
  | { phase: 'streaming' }
  | { phase: 'writing'; detail: string }    // Phase 3: AI is generating write content

/** Phase 2: tool call progress event sent via SSE */
export interface AgentToolCallEvent {
  type: 'start' | 'end'
  name: string
  args?: Record<string, unknown>
}
