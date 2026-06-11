import type { NoteMeta } from './types'

export type AgentAction =
  | 'summarize_note'
  | 'extract_todos'
  | 'rewrite_selection'
  | 'suggest_tags_links'
  | 'free_chat'

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
}

export interface AgentChatRequest {
  messages: AgentMessage[]
  action: AgentAction
  context: AgentContext
  providerConfig?: AgentProviderConfig
}

export interface AgentProviderConfig {
  apiKey?: string
  baseURL?: string
  model?: string
}

export interface AgentDraft {
  id: string
  action: Extract<AgentAction, 'extract_todos' | 'rewrite_selection'>
  title: string
  description: string
  originalContent: string
  nextContent: string
}

export interface AgentSelection {
  text: string
  from: number
  to: number
}
