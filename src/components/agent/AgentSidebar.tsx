import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Bot,
  Check,
  Clock,
  Copy,
  KeyRound,
  Loader2,
  RefreshCw,
  Send,
  Settings,
  Sparkles,
  Square,
  Tags,
  Trash2,
  X,
} from 'lucide-react'
import type { NoteMeta } from '../../../shared/types'
import type { AgentAction, AgentDraft, AgentMessage, AgentRunState, AgentToolCallEvent, LinkedNoteContent, SelectedNoteData } from '../../../shared/agent'
import {
  buildEnrichedEditorContext,
  buildCombinedKnowledgeContext,
  createDraft,
  createId,
  DEFAULT_AGENT_CONFIG,
  isAgentGatewayEndpoint,
  loadAgentConfig,
  saveAgentConfig,
  streamAgentResponse,
  type AgentRuntimeConfig,
} from './agentClient'

type AgentSidebarMode = 'editor' | 'knowledge'
const AGENT_HISTORY_KEY = 'mynote-agent-history-v1'
const MAX_HISTORY_ITEMS = 30

interface AgentSidebarProps {
  mode: AgentSidebarMode
  currentNote?: NoteMeta | null
  currentContent?: string
  selectedText?: string
  notes?: NoteMeta[]
  tags?: string[]
  onApplyDraft?: (draft: AgentDraft) => Promise<void> | void
  /** Phase 1: linked notes for editor enriched context */
  linkedNoteContents?: LinkedNoteContent[]
  /** Phase 1: selected notes for knowledge selection context */
  selectedNoteContents?: SelectedNoteData[]
  /** Phase 1: parent is still loading context data */
  contextLoading?: boolean
}

interface AgentQuickAction {
  id: AgentAction
  label: string
  prompt: string
  requiresSelection?: boolean
}

interface AgentHistoryItem {
  id: string
  mode: AgentSidebarMode
  title: string
  createdAt: string
  updatedAt: string
  messages: AgentMessage[]
}

const EDITOR_ACTIONS: AgentQuickAction[] = [
  { id: 'summarize_note', label: '总结当前笔记', prompt: '请总结当前笔记。' },
  { id: 'extract_todos', label: '提取待办事项', prompt: '请从当前笔记中提取可执行的待办事项。' },
  { id: 'rewrite_selection', label: '改写选中内容', prompt: '请改写我选中的内容。', requiresSelection: true },
  { id: 'suggest_tags_links', label: '标签/双链建议', prompt: '请给这篇笔记推荐标签和可能的双链。' },
  { id: 'generate_content', label: '生成补充内容', prompt: '请根据上下文为当前笔记生成补充内容。' },
  { id: 'create_new_note', label: '创建新笔记', prompt: '请创建一篇新笔记。用户会提供主题和要求。' },
]

const KNOWLEDGE_ACTIONS: AgentQuickAction[] = [
  { id: 'free_chat', label: '总结最近更新', prompt: '请根据知识库总览总结最近更新的主题和重点。' },
  { id: 'free_chat', label: '找出整理线索', prompt: '请根据当前知识库总览，指出可能需要整理、合并或补标签的地方。' },
  { id: 'free_chat', label: '推荐标签整理', prompt: '请根据标签和最近笔记，推荐一组更清晰的标签整理方案。' },
  { id: 'free_chat', label: '生成知识回顾', prompt: '请根据最近笔记生成一份简短的知识回顾。' },
  { id: 'create_new_note', label: '创建新笔记', prompt: '请根据知识库内容创建一篇新笔记。' },
]

function actionLabel(action: AgentAction, actions: AgentQuickAction[]) {
  return actions.find((item) => item.id === action)?.label ?? '自由提问'
}

function toolLabel(name: string): string {
  const labels: Record<string, string> = {
    search_notes: '正在搜索笔记...',
    read_note: '正在读取笔记...',
    list_notes_by_tag: '正在查找标签...',
    get_backlinks: '正在查找反向链接...',
    list_recent_notes: '正在列出最近笔记...',
  }
  return labels[name] ?? `正在执行: ${name}`
}

function withValidEndpoint(config: AgentRuntimeConfig): AgentRuntimeConfig {
  return {
    ...config,
    endpoint: isAgentGatewayEndpoint(config.endpoint)
      ? config.endpoint.trim()
      : DEFAULT_AGENT_CONFIG.endpoint,
  }
}

function loadAgentHistory(): AgentHistoryItem[] {
  try {
    const raw = localStorage.getItem(AGENT_HISTORY_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as AgentHistoryItem[]
    if (!Array.isArray(parsed)) return []
    return parsed.filter((item) => Array.isArray(item.messages))
  } catch {
    return []
  }
}

function saveAgentHistory(history: AgentHistoryItem[]) {
  localStorage.setItem(AGENT_HISTORY_KEY, JSON.stringify(history.slice(0, MAX_HISTORY_ITEMS)))
}

function historyTitle(messages: AgentMessage[]) {
  const firstUser = messages.find((message) => message.role === 'user')?.content.trim()
  if (!firstUser) return '新对话'
  return firstUser.length > 28 ? `${firstUser.slice(0, 28)}...` : firstUser
}

export default function AgentSidebar({
  mode,
  currentNote,
  currentContent = '',
  selectedText = '',
  notes = [],
  tags = [],
  onApplyDraft,
  linkedNoteContents,
  selectedNoteContents,
  contextLoading = false,
}: AgentSidebarProps) {
  const isEditor = mode === 'editor'
  const actions = isEditor ? EDITOR_ACTIONS : KNOWLEDGE_ACTIONS
  const [messages, setMessages] = useState<AgentMessage[]>([])
  const [input, setInput] = useState('')
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [draft, setDraft] = useState<AgentDraft | null>(null)
  const [applyingDraft, setApplyingDraft] = useState(false)
  const [config, setConfig] = useState<AgentRuntimeConfig>(() => loadAgentConfig())
  const [configDraft, setConfigDraft] = useState<AgentRuntimeConfig>(() => loadAgentConfig())
  const [configOpen, setConfigOpen] = useState(() => !loadAgentConfig().configured)
  const [configError, setConfigError] = useState<string | null>(null)
  const [copiedKey, setCopiedKey] = useState<string | null>(null)
  const [actionsOpen, setActionsOpen] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [history, setHistory] = useState<AgentHistoryItem[]>(() => loadAgentHistory())
  const [activeHistoryId, setActiveHistoryId] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const [runState, setRunState] = useState<AgentRunState>({ phase: 'idle' })

  const trimmedSelection = selectedText.trim()
  const hasKnowledge = notes.length > 0
  const configReady = config.configured && isAgentGatewayEndpoint(config.endpoint)
  const canAsk = configReady && !contextLoading && (isEditor ? Boolean(currentNote && currentContent.trim()) : hasKnowledge)
  const visibleHistory = history.filter((item) => item.mode === mode)

  useEffect(() => {
    if (config.endpoint && !isAgentGatewayEndpoint(config.endpoint)) {
      const nextConfig = withValidEndpoint({ ...config, configured: false })
      setConfig(nextConfig)
      setConfigDraft(nextConfig)
      setConfigError('当前保存的是旧的相对地址 /api/agent/chat。请填写完整的 Vercel 网关地址。')
      setConfigOpen(true)
    }
  }, [config])

  useEffect(() => {
    if (configOpen && configDraft.endpoint.trim() === '/api/agent/chat') {
      setConfigDraft((prev) => ({
        ...prev,
        endpoint: DEFAULT_AGENT_CONFIG.endpoint,
      }))
      setConfigError(null)
    }
  }, [configDraft.endpoint, configOpen])

  const contextLabel = useMemo(() => {
    if (!configReady) return '请先配置 AI'
    if (isEditor) {
      if (!currentNote) return '打开一篇笔记后可用'
      const linkCount = linkedNoteContents?.length ?? 0
      const base = trimmedSelection ? `已选中 ${trimmedSelection.length} 字` : '使用整篇当前笔记'
      return linkCount > 0 ? `${base} + ${linkCount} 篇关联笔记` : base
    }
    if (selectedNoteContents && selectedNoteContents.length > 0) {
      return `已选择 ${selectedNoteContents.length} 篇笔记作为上下文`
    }
    return hasKnowledge ? `已载入 ${notes.length} 篇笔记概览` : '暂无知识库上下文'
  }, [configReady, currentNote, hasKnowledge, isEditor, notes.length, trimmedSelection, linkedNoteContents, selectedNoteContents])

  const openConfig = () => {
    setConfigDraft(withValidEndpoint(config))
    setConfigError(null)
    setHistoryOpen(false)
    setConfigOpen(true)
  }

  const submitConfig = () => {
    const endpoint = configDraft.endpoint.trim()
    if (!isAgentGatewayEndpoint(endpoint)) {
      setConfigError('请填写完整的 http(s) 网关地址，例如 http://localhost:3000/api/agent/chat。桌面端不能保存 /api/agent/chat。')
      return
    }

    const nextConfig: AgentRuntimeConfig = {
      ...configDraft,
      endpoint,
      baseURL: configDraft.baseURL.trim() || DEFAULT_AGENT_CONFIG.baseURL,
      model: configDraft.model.trim() || DEFAULT_AGENT_CONFIG.model,
      apiKey: configDraft.apiKey.trim(),
      configured: true,
    }
    saveAgentConfig(nextConfig)
    setConfig(nextConfig)
    setConfigDraft(nextConfig)
    setConfigOpen(false)
    setError(null)
    setConfigError(null)
  }

  const formatConversation = () => {
    const title = isEditor
      ? `笔记 AI${currentNote ? ` - ${currentNote.title}` : ''}`
      : '知识库 AI'
    const lines = messages.map((message) => {
      const role = message.role === 'user' ? '你' : 'AI'
      return `## ${role}\n\n${message.content.trim() || '(空)'}`
    })

    if (draft) {
      lines.push(`## 草稿预览\n\n${draft.nextContent.trim()}`)
    }

    if (input.trim()) {
      lines.push(`## 输入框草稿\n\n${input.trim()}`)
    }

    return [`# ${title}`, ...lines].join('\n\n')
  }

  const copyToClipboard = async (text: string, key: string) => {
    const value = text.trim()
    if (!value) return

    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value)
      } else {
        const textarea = document.createElement('textarea')
        textarea.value = value
        textarea.style.position = 'fixed'
        textarea.style.left = '-9999px'
        document.body.appendChild(textarea)
        textarea.select()
        document.execCommand('copy')
        document.body.removeChild(textarea)
      }
      setCopiedKey(key)
      window.setTimeout(() => {
        setCopiedKey((current) => (current === key ? null : current))
      }, 1400)
    } catch (err) {
      setError(err instanceof Error ? `复制失败：${err.message}` : '复制失败')
    }
  }

  const persistConversation = (nextMessages: AgentMessage[], historyId: string | null) => {
    if (nextMessages.length === 0) return null

    const now = new Date().toISOString()
    let savedId = historyId
    const nextItem: AgentHistoryItem = {
      id: savedId ?? createId('history'),
      mode,
      title: historyTitle(nextMessages),
      createdAt: now,
      updatedAt: now,
      messages: nextMessages,
    }
    savedId = nextItem.id

    setHistory((prev) => {
      const existing = prev.find((item) => item.id === savedId)
      const updatedItem = existing
        ? {
            ...existing,
            title: historyTitle(nextMessages),
            updatedAt: now,
            messages: nextMessages,
          }
        : nextItem
      const nextHistory = [
        updatedItem,
        ...prev.filter((item) => item.id !== savedId),
      ].slice(0, MAX_HISTORY_ITEMS)
      saveAgentHistory(nextHistory)
      return nextHistory
    })

    return savedId
  }

  const restoreHistory = (item: AgentHistoryItem) => {
    cancel()
    setMessages(item.messages)
    setActiveHistoryId(item.id)
    setDraft(null)
    setError(null)
    setActionsOpen(false)
    setHistoryOpen(false)
    setRunState({ phase: 'idle' })
  }

  const deleteHistory = (id: string) => {
    setHistory((prev) => {
      const nextHistory = prev.filter((item) => item.id !== id)
      saveAgentHistory(nextHistory)
      return nextHistory
    })
    if (activeHistoryId === id) {
      setActiveHistoryId(null)
      setMessages([])
      setDraft(null)
    }
  }

  const runAgent = async (action: AgentAction, prompt: string) => {
    if (!configReady) {
      openConfig()
      return
    }
    if (!canAsk || running) return
    setActionsOpen(false)
    setHistoryOpen(false)

    const userMessage: AgentMessage = {
      id: createId('msg'),
      role: 'user',
      content: action === 'free_chat' ? prompt : `${actionLabel(action, actions)}：${prompt}`,
    }
    const assistantMessage: AgentMessage = {
      id: createId('msg'),
      role: 'assistant',
      content: '',
    }
    const nextMessages = [...messages, userMessage, assistantMessage]

    setMessages(nextMessages)
    setInput('')
    setError(null)
    setDraft(null)
    setRunning(true)

    // Phase: preparing context
    setRunState({ phase: 'preparing', detail: '正在构建上下文...' })

    const controller = new AbortController()
    abortRef.current = controller

    try {
      // Build context
      const context = isEditor
        ? buildEnrichedEditorContext({
            noteMeta: currentNote ?? null,
            noteContent: currentContent,
            selectedText: trimmedSelection || undefined,
            linkedNotes: linkedNoteContents,
          })
        : buildCombinedKnowledgeContext(notes, tags, selectedNoteContents)

      // Phase: context ready — show what the AI will see
      const linkCount = isEditor
        ? (linkedNoteContents?.length ?? 0)
        : (selectedNoteContents?.length ?? 0)

      setRunState({
        phase: 'preparing',
        detail: linkCount > 0
          ? isEditor
            ? `当前笔记 + ${linkCount} 篇关联笔记作为上下文`
            : `已选择 ${linkCount} 篇笔记及其关联内容作为上下文`
          : isEditor
            ? '使用当前笔记作为上下文'
            : `使用知识库概览作为上下文 (${notes.length} 篇笔记)`,
      })

      // Phase: sending — now waiting for API
      setRunState({ phase: 'sending' })

      const responseText = await streamAgentResponse({
        messages: nextMessages,
        action,
        context,
        config,
        signal: controller.signal,
        onDelta: (delta) => {
          // First delta → switch to streaming
          setRunState({ phase: 'streaming' })
          setMessages((prev) =>
            prev.map((message) =>
              message.id === assistantMessage.id
                ? { ...message, content: message.content + delta }
                : message,
            ),
          )
        },
        onToolCall: (event: AgentToolCallEvent) => {
          if (event.type === 'start') {
            setRunState({
              phase: 'executing',
              detail: toolLabel(event.name),
            })
          } else {
            setRunState({ phase: 'streaming' })
          }
        },
      })

      // Draft creation: editor-only actions + write actions (both modes)
      const writeActions: AgentAction[] = ['create_new_note', 'generate_content']
      if (isEditor || writeActions.includes(action)) {
        const nextDraft = createDraft({
          action,
          response: responseText,
          originalContent: currentContent,
          selectedText: trimmedSelection || undefined,
        })
        if (nextDraft) setDraft(nextDraft)
      }

      const completedMessages = nextMessages.map((message) =>
        message.id === assistantMessage.id
          ? { ...message, content: responseText }
          : message,
      )
      const savedId = persistConversation(completedMessages, activeHistoryId)
      if (savedId) setActiveHistoryId(savedId)
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        setError(err instanceof Error ? err.message : String(err))
      }
    } finally {
      setRunning(false)
      setRunState({ phase: 'idle' })
      abortRef.current = null
    }
  }

  const handleSubmit = () => {
    const prompt = input.trim()
    if (!prompt) return
    void runAgent('free_chat', prompt)
  }

  const cancel = () => {
    abortRef.current?.abort()
    setRunning(false)
    setRunState({ phase: 'idle' })
  }

  const clear = () => {
    cancel()
    setMessages([])
    setActiveHistoryId(null)
    setDraft(null)
    setError(null)
    setActionsOpen(false)
    setHistoryOpen(false)
  }

  const applyDraft = async () => {
    if (!draft || !onApplyDraft) return
    setApplyingDraft(true)
    try {
      await onApplyDraft(draft)
      setDraft(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setApplyingDraft(false)
    }
  }

  return (
    <div className="agent-sidebar">
      <div className="agent-hero" title={contextLabel}>
        <div className="agent-title">{isEditor ? '笔记 AI' : '知识库 AI'}</div>
        <button
          className="agent-icon-btn"
          onClick={() => {
            setHistoryOpen((open) => !open)
            setActionsOpen(false)
          }}
          title="历史询问记录"
        >
          <Clock className="w-3 h-3" />
        </button>
        <button className="agent-icon-btn" onClick={openConfig} title="AI 配置">
          <Settings className="w-3 h-3" />
        </button>
      </div>

      {historyOpen && (
        <div className="agent-history-popover">
          <div className="agent-history-header">
            <strong>历史询问</strong>
            <span>{visibleHistory.length} 条</span>
          </div>
          <div className="agent-history-list">
            {visibleHistory.length === 0 ? (
              <p className="agent-muted">还没有历史记录。</p>
            ) : (
              visibleHistory.map((item) => (
                <div key={item.id} className={`agent-history-item ${item.id === activeHistoryId ? 'active' : ''}`}>
                  <button onClick={() => restoreHistory(item)} title="恢复这段对话">
                    <span>{item.title}</span>
                    <small>{new Date(item.updatedAt).toLocaleString()}</small>
                  </button>
                  <button onClick={() => deleteHistory(item.id)} title="删除历史">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {!configReady && (
        <button className="agent-config-banner" onClick={openConfig}>
          <KeyRound className="w-4 h-4" />
          <span>首次使用需要配置 AI API</span>
        </button>
      )}

      {messages.length > 0 && (
        <div className="agent-chat-toolbar">
          <span>{messages.length} 条消息</span>
          <button onClick={() => void copyToClipboard(formatConversation(), 'conversation')} title="复制全部对话">
            {copiedKey === 'conversation' ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
            {copiedKey === 'conversation' ? '已复制' : '复制全部'}
          </button>
        </div>
      )}

      {/* Selected notes summary (knowledge AI context mode) */}
      {!isEditor && selectedNoteContents && selectedNoteContents.length > 0 && (
        <div className="agent-note-list">
          <div className="flex items-center gap-1.5 mb-1">
            <Bot className="w-3 h-3 text-emerald-500" />
            <span className="text-xs text-surface-500 font-medium">
              AI 上下文 ({selectedNoteContents.length} 篇)
            </span>
          </div>
          {selectedNoteContents.map((n) => (
            <div key={n.meta.path} className="agent-note-row">
              <span>{n.meta.title}</span>
              <small>{n.meta.path}</small>
            </div>
          ))}
        </div>
      )}

      <div className="agent-chat-log">
        {messages.length === 0 ? (
          <div className="agent-empty">
            <Bot className="w-5 h-5" />
            <span>{isEditor ? '问我这篇笔记里的内容，或先点一个快捷动作。' : '问我这个知识库的结构、标签和最近更新。'}</span>
          </div>
        ) : (
          messages.map((message) => (
            <div key={message.id} className={`agent-message ${message.role}`}>
              <div className="agent-message-meta">
                <div className="agent-message-role">{message.role === 'user' ? '你' : 'AI'}</div>
                <button
                  onClick={() => void copyToClipboard(message.content, message.id)}
                  disabled={!message.content.trim()}
                  title={message.role === 'user' ? '复制问题' : '复制答案'}
                >
                  {copiedKey === message.id ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                  <span>{copiedKey === message.id ? '已复制' : '复制'}</span>
                </button>
              </div>
              <div className="agent-message-content">
                {message.content ? (
                  message.content
                ) : message.role === 'assistant' && runState.phase !== 'idle' ? (
                  <div className="agent-thinking">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>
                      {runState.phase === 'preparing' && runState.detail}
                      {runState.phase === 'sending' && '正在等待 AI 响应...'}
                      {runState.phase === 'executing' && runState.detail}
                      {runState.phase === 'streaming' && '正在生成回复...'}
                    </span>
                  </div>
                ) : (
                  ''
                )}
              </div>
            </div>
          ))
        )}
      </div>

      {draft && (
        <div className="agent-draft">
          <div className="agent-draft-header">
            <div>
              <strong>{draft.title}</strong>
              <p>{draft.description}</p>
            </div>
            <button onClick={() => setDraft(null)} title="关闭预览">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          {/* Folder & title editor for create_new_note */}
          {draft.action === 'create_new_note' && (
            <div className="agent-draft-meta">
              <label>
                <span>文件夹</span>
                <select
                  value={draft.newNoteFolder || 'notes'}
                  onChange={(e) => setDraft({ ...draft, newNoteFolder: e.target.value })}
                >
                  <option value="notes">notes/</option>
                  {Array.from(new Set(notes.map((n) => {
                    const parts = n.path.split('/')
                    return parts.length > 1 ? parts.slice(0, -1).join('/') : null
                  }).filter(Boolean) as string[])).sort().map((folder) => (
                    <option key={folder} value={folder}>{folder}/</option>
                  ))}
                </select>
              </label>
              <label>
                <span>标题</span>
                <input
                  value={draft.newNoteTitle || ''}
                  onChange={(e) => setDraft({ ...draft, newNoteTitle: e.target.value })}
                  placeholder="笔记标题"
                />
              </label>
            </div>
          )}
          <pre>{draft.nextContent}</pre>
          <div className="agent-draft-actions">
            <button onClick={() => void copyToClipboard(draft.nextContent, draft.id)} disabled={!draft.nextContent.trim()}>
              {copiedKey === draft.id ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              {copiedKey === draft.id ? '已复制' : '复制'}
            </button>
            <button onClick={() => setDraft(null)}>
              <X className="w-3.5 h-3.5" />
              放弃
            </button>
            <button onClick={applyDraft} disabled={applyingDraft}>
              {applyingDraft ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
              应用
            </button>
          </div>
        </div>
      )}

      {error && (
        <div className="agent-error">
          <span>{error}</span>
          <button onClick={() => setError(null)} title="关闭">
            <X className="w-3 h-3" />
          </button>
        </div>
      )}

      <div className="agent-prompt-box">
        {actionsOpen && (
          <div className="agent-action-popover">
            <div className="agent-action-popover-title">{isEditor ? '快捷动作' : '知识库提问'}</div>
            <div className="agent-action-list">
              {actions.map((action) => {
                const disabled = !canAsk || running || (action.requiresSelection && !trimmedSelection)
                return (
                  <button
                    key={`${action.id}-${action.label}`}
                    disabled={disabled}
                    onClick={() => void runAgent(action.id, action.prompt)}
                    title={action.requiresSelection && !trimmedSelection ? '请先在编辑器中选中文本' : action.label}
                  >
                    {action.id === 'suggest_tags_links' && <Tags className="w-3 h-3" />}
                    {action.id !== 'suggest_tags_links' && <Sparkles className="w-3 h-3" />}
                    <span>{action.label}</span>
                  </button>
                )
              })}
            </div>
          </div>
        )}
        <textarea
          value={input}
          disabled={!canAsk || running || contextLoading}
          placeholder={
            contextLoading
              ? '正在加载上下文...'
              : canAsk
                ? (isEditor ? '向 AI 询问这篇笔记...' : '向 AI 询问知识库...')
                : '配置 AI 并准备好上下文后可提问'
          }
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              handleSubmit()
            }
          }}
        />
        <div className="agent-prompt-actions">
          <button
            onClick={() => setActionsOpen((open) => !open)}
            disabled={!canAsk || running}
            title="快捷动作"
          >
            <Sparkles className="w-3.5 h-3.5" />
          </button>
          <button onClick={clear} disabled={running && !abortRef.current} title="清空对话">
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
          {running ? (
            <button onClick={cancel}>
              <Square className="w-3.5 h-3.5" />
              停止
            </button>
          ) : (
            <button onClick={handleSubmit} disabled={!canAsk || !input.trim()}>
              <Send className="w-3.5 h-3.5" />
              发送
            </button>
          )}
        </div>
      </div>

      {configOpen && (
        <div className="agent-config-modal" onMouseDown={(event) => event.stopPropagation()}>
          <div className="agent-config-dialog">
            <div className="agent-config-header">
              <div>
                <h3>AI API 配置</h3>
                <p>配置会保存在本机浏览器存储中，后续不会重复弹出。</p>
              </div>
              <button onClick={() => setConfigOpen(false)} title="关闭">
                <X className="w-4 h-4" />
              </button>
            </div>

            <label>
              <span>Vercel 网关地址</span>
              <input
                value={configDraft.endpoint}
                onChange={(event) => {
                  setConfigDraft((prev) => ({ ...prev, endpoint: event.target.value }))
                  setConfigError(null)
                }}
                placeholder="http://localhost:3000/api/agent/chat"
              />
            </label>
            {configError && <p className="agent-config-field-error">{configError}</p>}

            <label>
              <span>DeepSeek API Key</span>
              <input
                type="password"
                value={configDraft.apiKey}
                onChange={(event) => setConfigDraft((prev) => ({ ...prev, apiKey: event.target.value }))}
                placeholder="留空则使用 Vercel 环境变量 DEEPSEEK_API_KEY"
              />
            </label>

            <div className="agent-config-grid">
              <label>
                <span>Base URL</span>
                <input
                  value={configDraft.baseURL}
                  onChange={(event) => setConfigDraft((prev) => ({ ...prev, baseURL: event.target.value }))}
                  placeholder="https://api.deepseek.com"
                />
              </label>
              <label>
                <span>模型</span>
                <input
                  value={configDraft.model}
                  onChange={(event) => setConfigDraft((prev) => ({ ...prev, model: event.target.value }))}
                  placeholder="deepseek-v4-flash"
                />
              </label>
            </div>

            <p className="agent-config-note">
              桌面端默认使用本地 Vercel 网关 `http://localhost:3000/api/agent/chat`。部署后可改成你的 Vercel 地址，例如 `https://your-app.vercel.app/api/agent/chat`。
            </p>

            <div className="agent-config-actions">
              <button
                onClick={() => setConfigDraft({
                  ...DEFAULT_AGENT_CONFIG,
                  configured: config.configured,
                })}
              >
                恢复默认
              </button>
              <button onClick={submitConfig}>保存配置</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
