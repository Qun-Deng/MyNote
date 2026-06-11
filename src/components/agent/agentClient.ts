import type {
  AgentAction,
  AgentChatRequest,
  AgentContext,
  AgentDraft,
  AgentMessage,
  AgentProviderConfig,
  AgentToolCallEvent,
  LinkedNoteContent,
  SelectedNoteData,
} from '../../../shared/agent'
import type { NoteMeta } from '../../../shared/types'

const MAX_CONTEXT_CHARS = 30_000
const LINKED_NOTE_MAX_CHARS = 2_000
const AGENT_CONFIG_KEY = 'mynote-agent-config-v1'
const DEFAULT_AGENT_ENDPOINT = 'http://localhost:3000/api/agent/chat'

export interface AgentRuntimeConfig {
  endpoint: string
  apiKey: string
  baseURL: string
  model: string
  configured: boolean
}

export const DEFAULT_AGENT_CONFIG: AgentRuntimeConfig = {
  endpoint: import.meta.env.VITE_AGENT_API_URL || DEFAULT_AGENT_ENDPOINT,
  apiKey: '',
  baseURL: 'https://api.deepseek.com',
  model: 'deepseek-v4-flash',
  configured: false,
}

export function isAgentGatewayEndpoint(endpoint: string) {
  return /^https?:\/\//i.test(endpoint.trim())
}

export function createId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export function loadAgentConfig(): AgentRuntimeConfig {
  try {
    const raw = localStorage.getItem(AGENT_CONFIG_KEY)
    if (!raw) return DEFAULT_AGENT_CONFIG
    const parsed = JSON.parse(raw) as Partial<AgentRuntimeConfig>
    const savedEndpoint = parsed.endpoint?.trim() ?? DEFAULT_AGENT_CONFIG.endpoint
    const endpoint = isAgentGatewayEndpoint(savedEndpoint) ? savedEndpoint : DEFAULT_AGENT_CONFIG.endpoint
    return {
      ...DEFAULT_AGENT_CONFIG,
      ...parsed,
      endpoint,
      baseURL: parsed.baseURL?.trim() || DEFAULT_AGENT_CONFIG.baseURL,
      model: parsed.model?.trim() || DEFAULT_AGENT_CONFIG.model,
      apiKey: parsed.apiKey ?? '',
      configured: Boolean(parsed.configured) && isAgentGatewayEndpoint(savedEndpoint),
    }
  } catch {
    return DEFAULT_AGENT_CONFIG
  }
}

export function saveAgentConfig(config: AgentRuntimeConfig) {
  localStorage.setItem(AGENT_CONFIG_KEY, JSON.stringify({
    ...config,
    endpoint: config.endpoint.trim(),
    baseURL: config.baseURL.trim() || DEFAULT_AGENT_CONFIG.baseURL,
    model: config.model.trim() || DEFAULT_AGENT_CONFIG.model,
    configured: true,
  }))
}

function providerConfigFromRuntime(config: AgentRuntimeConfig): AgentProviderConfig {
  return {
    apiKey: config.apiKey.trim() || undefined,
    baseURL: config.baseURL.trim() || undefined,
    model: config.model.trim() || undefined,
  }
}

export function truncateNoteContent(content: string) {
  if (content.length <= MAX_CONTEXT_CHARS) {
    return { content, truncated: false }
  }
  const half = MAX_CONTEXT_CHARS / 2
  return {
    content: [
      content.slice(0, half),
      '\n\n<!-- MyNote AI: middle of note omitted because context was too long. -->\n\n',
      content.slice(-half),
    ].join(''),
    truncated: true,
  }
}

export function buildAgentContext(context: Omit<AgentContext, 'truncated'>): AgentContext {
  const truncated = truncateNoteContent(context.noteContent)
  return {
    ...context,
    noteContent: truncated.content,
    truncated: truncated.truncated,
  }
}

export function buildKnowledgeContext(notes: NoteMeta[], tags: string[]): AgentContext {
  const activeNotes = notes.filter((note) => !note.archived)
  const recentNotes = [...activeNotes]
    .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
    .slice(0, 30)
  const tagSummary = tags.length > 0 ? tags.join(', ') : 'No tags yet'
  const noteLines = recentNotes.map((note, index) => {
    const tagText = note.tags.length > 0 ? ` tags=${note.tags.join(',')}` : ''
    return `${index + 1}. ${note.title} (${note.path}) updated=${note.updated_at}${tagText}`
  })
  return buildAgentContext({
    noteMeta: null,
    noteContent: [
      '# Knowledge Base Overview',
      `Total notes: ${notes.length}`,
      `Active notes: ${activeNotes.length}`,
      `Archived notes: ${notes.length - activeNotes.length}`,
      `Tags: ${tagSummary}`,
      '',
      '## Recent notes',
      noteLines.join('\n') || 'No notes available.',
    ].join('\n'),
  })
}

// ── Phase 1: Enriched Context Builders ──

function truncateLinkedNote(content: string): string {
  if (content.length <= LINKED_NOTE_MAX_CHARS) return content
  return content.slice(0, LINKED_NOTE_MAX_CHARS) + '\n\n...(truncated)'
}

function formatLinkedNotesAppendix(linkedNotes: LinkedNoteContent[]): string {
  if (!linkedNotes || linkedNotes.length === 0) return ''
  const sections = linkedNotes.map((note) => {
    const relationLabel = note.relation === 'backlink' ? '反向链接' : '前向链接'
    return [
      `### [${relationLabel}] ${note.title}`,
      `路径: ${note.path}`,
      '',
      truncateLinkedNote(note.content),
    ].join('\n')
  })
  return ['', '## 关联笔记内容', '', ...sections].join('\n')
}

/**
 * Editor mode: enrich context with bidirectional link content.
 * Linked notes are appended as a Markdown appendix within noteContent.
 */
export function buildEnrichedEditorContext(params: {
  noteMeta: NoteMeta | null
  noteContent: string
  selectedText?: string
  linkedNotes?: LinkedNoteContent[]
}): AgentContext {
  const { noteMeta, noteContent, selectedText, linkedNotes } = params

  const baseTruncated = truncateNoteContent(noteContent)

  const appendix = linkedNotes && linkedNotes.length > 0
    ? formatLinkedNotesAppendix(linkedNotes)
    : ''

  let combined = baseTruncated.content + appendix
  let truncated = baseTruncated.truncated

  if (combined.length > MAX_CONTEXT_CHARS) {
    const appendixMax = MAX_CONTEXT_CHARS - baseTruncated.content.length
    if (appendixMax > 500) {
      const trimmedAppendix = appendix.slice(0, appendixMax) + '\n\n...(关联笔记已截断)'
      combined = baseTruncated.content + trimmedAppendix
    } else {
      combined = baseTruncated.content
    }
    truncated = true
  }

  return {
    noteMeta,
    noteContent: combined,
    selectedText: selectedText || undefined,
    truncated,
    linkedNotes,
  }
}

/**
 * Knowledge mode with explicit note selection: build rich multi-note context.
 * Each selected note gets its own section with content + links.
 */
export function buildSelectionContext(selectedNotes: SelectedNoteData[]): AgentContext {
  if (!selectedNotes || selectedNotes.length === 0) {
    return {
      noteMeta: null,
      noteContent: '# 未选择笔记\n\n请先选择笔记作为 AI 上下文。',
      isMultiNote: true,
    }
  }

  const sections = selectedNotes.map((note, index) => {
    const tagText = note.meta.tags.length > 0 ? note.meta.tags.join(', ') : '无'
    const parts = [
      `## 笔记 ${index + 1}: ${note.meta.title}`,
      `路径: ${note.meta.path}  |  标签: ${tagText}`,
      '',
      '### 正文',
      truncateNoteContent(note.content).content,
    ]

    if (note.backlinks.length > 0) {
      parts.push('', '### 反向链接')
      for (const bl of note.backlinks.slice(0, 5)) {
        parts.push(`- [${bl.from_path}] ${bl.context || ''}`)
      }
    }

    if (note.linkedContents.length > 0) {
      parts.push('', '### 前向链接笔记内容')
      for (const lc of note.linkedContents) {
        parts.push(`#### ${lc.title} (${lc.path})`)
        parts.push(truncateLinkedNote(lc.content))
      }
    }

    return parts.join('\n')
  })

  let combined = [
    `# AI 上下文：已选 ${selectedNotes.length} 篇笔记`,
    '',
    ...sections,
  ].join('\n')

  if (combined.length > MAX_CONTEXT_CHARS) {
    const half = Math.floor(MAX_CONTEXT_CHARS / 2)
    combined = combined.slice(0, half)
      + '\n\n<!-- MyNote AI: 上下文过长，中间部分已省略 -->\n\n'
      + combined.slice(-half)
  }

  return {
    noteMeta: null,
    noteContent: combined,
    truncated: combined.length > MAX_CONTEXT_CHARS,
    isMultiNote: true,
  }
}

/**
 * Dispatcher for knowledge mode: uses selection context when notes are selected,
 * falls back to the existing knowledge-base overview otherwise.
 */
export function buildCombinedKnowledgeContext(
  notes: NoteMeta[],
  tags: string[],
  selectedNoteContents?: SelectedNoteData[],
): AgentContext {
  if (selectedNoteContents && selectedNoteContents.length > 0) {
    return buildSelectionContext(selectedNoteContents)
  }
  return buildKnowledgeContext(notes, tags)
}

function formatError(status: number, text: string, endpoint: string) {
  if (status === 404) {
    return [
      'AI 网关地址返回 404。',
      `当前地址：${endpoint || '(未配置)'}`,
      '桌面端不能直接使用相对地址 /api/agent/chat；请在 AI 配置里填写完整的 Vercel 网关地址，例如 https://your-app.vercel.app/api/agent/chat，或本地启动 vercel dev 后填写 http://localhost:3000/api/agent/chat。',
    ].join('\n')
  }

  try {
    const parsed = JSON.parse(text)
    if (parsed?.error) return String(parsed.error)
  } catch {}

  return text || `Agent request failed with status ${status}`
}

export async function streamAgentResponse({
  messages,
  action,
  context,
  config,
  signal,
  onDelta,
  onToolCall,
  vaultPath,
}: {
  messages: AgentMessage[]
  action: AgentAction
  context: AgentContext
  config: AgentRuntimeConfig
  signal: AbortSignal
  onDelta: (delta: string) => void
  onToolCall?: (event: AgentToolCallEvent) => void
  vaultPath?: string
}) {
  const endpoint = config.endpoint.trim()
  if (!endpoint) {
    throw new Error('请先在 AI 配置里填写 Vercel 网关地址，例如 https://your-app.vercel.app/api/agent/chat。')
  }
  if (!isAgentGatewayEndpoint(endpoint)) {
    throw new Error('AI 网关地址需要是完整的 http(s) 地址。桌面端不能使用 /api/agent/chat，请填写 Vercel 地址或 http://localhost:3000/api/agent/chat。')
  }

  // Auto-detect vault path if not provided
  let resolvedVaultPath = vaultPath
  if (!resolvedVaultPath) {
    try {
      if (typeof window !== 'undefined' && (window as any).mynote?.vault?.getPath) {
        resolvedVaultPath = await (window as any).mynote.vault.getPath() || undefined
      }
    } catch { /* ignore */ }
  }

  const request: AgentChatRequest = {
    messages,
    action,
    context,
    providerConfig: providerConfigFromRuntime(config),
    vaultPath: resolvedVaultPath || undefined,
  }

  let response: Response
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
      signal,
    })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    throw new Error([
      `无法连接 AI 网关：${endpoint}`,
      '如果使用默认本地地址，请先在项目目录运行 npm.cmd run agent:dev。',
      '如果你改成了 Vercel 部署地址，请确认地址完整、可访问，并且包含 /api/agent/chat。',
    ].join('\n'))
  }

  if (!response.ok || !response.body) {
    const text = await response.text().catch(() => '')
    throw new Error(formatError(response.status, text, endpoint))
  }

  const contentType = response.headers.get('Content-Type') || ''
  const isSSE = contentType.includes('text/event-stream')

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let fullText = ''

  if (!isSSE) {
    // Fallback: raw text stream (Phase 1 / error responses)
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      const delta = decoder.decode(value, { stream: true })
      fullText += delta
      onDelta(delta)
    }
    const tail = decoder.decode()
    if (tail) { fullText += tail; onDelta(tail) }
    return fullText
  }

  // Parse SSE events from the stream (Phase 2)
  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    // Split by double newline (SSE event boundary)
    const parts = buffer.split('\n\n')
    buffer = parts.pop() || ''  // keep incomplete event in buffer

    for (const part of parts) {
      const line = part.trim()
      if (!line.startsWith('data: ')) continue
      try {
        const event = JSON.parse(line.slice(6))
        switch (event.type) {
          case 'text':
            fullText += event.delta
            onDelta(event.delta)
            break
          case 'tool_start':
            onToolCall?.({
              type: 'start',
              name: event.name,
              args: event.args,
            })
            break
          case 'tool_end':
            onToolCall?.({
              type: 'end',
              name: event.name,
            })
            break
          case 'error':
            throw new Error(event.error || 'AI 服务返回错误')
          case 'done':
            break
        }
      } catch (err) {
        // If it's a thrown error from above, re-throw
        if (err instanceof Error && err.message.includes('AI 服务')) throw err
        // Otherwise skip malformed SSE events
      }
    }
  }

  return fullText
}

function todoBlockFromResponse(response: string) {
  const lines = response
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
  const todos = lines
    .map((line) => {
      if (/^[-*+]\s+\[[ xX]\]\s+/.test(line)) return line.replace(/^[-*+]/, '-')
      return `- [ ] ${line.replace(/^[-*+]\s*/, '')}`
    })
    .filter((line) => line.replace(/^-\s+\[[ xX]\]\s+/, '').trim().length > 0)
  return Array.from(new Set(todos)).join('\n')
}

export function createDraft({
  action,
  response,
  originalContent,
  selectedText,
}: {
  action: AgentAction
  response: string
  originalContent: string
  selectedText?: string
}): AgentDraft | null {
  const cleanResponse = response.trim()
  if (!cleanResponse) return null

  if (action === 'extract_todos') {
    const todos = todoBlockFromResponse(cleanResponse)
    if (!todos) return null
    const nextContent = `${originalContent.trimEnd()}\n\n## AI 提取待办\n\n${todos}\n`
    return {
      id: createId('draft'),
      action,
      title: '追加提取出的待办',
      description: '将在当前笔记末尾追加一个 “AI 提取待办” 小节。',
      originalContent,
      nextContent,
    }
  }

  if (action === 'rewrite_selection') {
    const target = selectedText?.trim()
    if (!target) return null
    const index = originalContent.indexOf(target)
    if (index < 0) return null
    const nextContent = `${originalContent.slice(0, index)}${cleanResponse}${originalContent.slice(index + target.length)}`
    return {
      id: createId('draft'),
      action,
      title: '替换选中文本',
      description: '将用 AI 改写结果替换当前选中文本的第一次匹配。',
      originalContent,
      nextContent,
    }
  }

  // ── Phase 3: Write Operations ──

  if (action === 'create_new_note') {
    const titleMatch = cleanResponse.match(/^#\s+(.+)$/m)
    const noteTitle = titleMatch ? titleMatch[1].trim() : '未命名笔记'
    return {
      id: createId('draft'),
      action: 'create_new_note',
      title: `新建笔记: ${noteTitle}`,
      description: '将在 notes/ 文件夹中创建一篇新笔记。',
      originalContent: '',
      nextContent: cleanResponse,
      newNoteFolder: 'notes',
      newNoteTitle: noteTitle,
    }
  }

  if (action === 'generate_content') {
    const nextContent = `${originalContent.trimEnd()}\n\n${cleanResponse}`
    return {
      id: createId('draft'),
      action: 'generate_content',
      title: '追加生成内容',
      description: '将 AI 生成的内容追加到当前笔记末尾。',
      originalContent,
      nextContent,
    }
  }

  // Auto-detect: free_chat response that looks like a note (starts with # heading, substantial)
  if (action === 'free_chat' && cleanResponse.length > 200 && /^#\s+/.test(cleanResponse)) {
    const titleMatch = cleanResponse.match(/^#\s+(.+)$/m)
    const noteTitle = titleMatch ? titleMatch[1].trim() : '未命名笔记'
    return {
      id: createId('draft'),
      action: 'create_new_note',
      title: `从对话创建: ${noteTitle}`,
      description: 'AI 生成了类似笔记的内容，是否保存为新笔记？',
      originalContent: '',
      nextContent: cleanResponse,
      newNoteFolder: 'notes',
      newNoteTitle: noteTitle,
    }
  }

  return null
}
