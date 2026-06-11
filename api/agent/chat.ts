import type { IncomingMessage, ServerResponse } from 'node:http'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { streamText, stepCountIs, tool, zodSchema } from 'ai'
import { z } from 'zod'
import * as fs from 'node:fs'
import * as path from 'node:path'
import type { AgentAction, AgentChatRequest, AgentMessage } from '../../shared/agent'

const MAX_CONTEXT_CHARS = 30_000

// ── HTTP Helpers ──

function setCorsHeaders(res: ServerResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
}

function readRequestBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = ''
    req.setEncoding('utf8')
    req.on('data', (chunk) => {
      body += chunk
      if (body.length > 1_000_000) {
        req.destroy(new Error('Request body too large'))
      }
    })
    req.on('end', () => resolve(body))
    req.on('error', reject)
  })
}

function json(res: ServerResponse, statusCode: number, payload: unknown) {
  res.statusCode = statusCode
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(payload))
}

function writeSSE(res: ServerResponse, event: Record<string, unknown>) {
  res.write(`data: ${JSON.stringify(event)}\n\n`)
}

function assertRequest(value: unknown): asserts value is AgentChatRequest {
  if (!value || typeof value !== 'object') throw new Error('Invalid request body')
  const request = value as Partial<AgentChatRequest>
  if (!Array.isArray(request.messages)) throw new Error('messages must be an array')
  if (typeof request.action !== 'string') throw new Error('action is required')
  if (!request.context || typeof request.context !== 'object') throw new Error('context is required')
  if (typeof request.context.noteContent !== 'string') throw new Error('context.noteContent is required')
}

// ── Prompt Building ──

function actionInstruction(action: AgentAction) {
  switch (action) {
    case 'summarize_note':
      return '请总结当前笔记。输出结构：核心摘要、关键点、可能的后续行动。不要修改原文。'
    case 'extract_todos':
      return '请从当前笔记中提取可以执行的待办事项。只输出 Markdown 待办列表，每行形如 "- [ ] 事项"。不要输出解释。'
    case 'rewrite_selection':
      return '请改写用户选中的文本，使其更清晰、准确、自然。只输出改写后的 Markdown，不要解释。'
    case 'suggest_tags_links':
      return '请基于当前笔记建议标签和可能的双链。输出两节：建议标签、建议双链。不要修改原文。'
    case 'free_chat':
      return '请回答用户关于当前笔记的问题。优先使用工具搜索知识库获取相关信息。如果上下文不足，请使用搜索工具查找。'
    case 'create_new_note':
      return [
        '请创建一篇完整的 Markdown 笔记。先用搜索工具查找知识库中相关内容，然后基于找到的信息生成新笔记。',
        '输出格式：以 # 标题 开头，接着是标签行（如 [#tag1] [#tag2]），然后是完整的笔记正文。',
        '标题要简洁准确，正文要有结构和实质内容。',
        '如果知识库中有相关笔记，可以引用（用 [[双链]] 格式）。',
        '只输出笔记内容本身，不要输出解释或前缀。',
      ].join(' ')
    case 'generate_content':
      return [
        '请根据上下文为当前笔记补充内容。先用搜索工具查找知识库中的相关信息。',
        '只输出要追加的 Markdown 内容，格式与当前笔记风格一致。',
        '不要重复当前笔记已有的内容，补充新的角度、细节或延伸思考。',
      ].join(' ')
  }
}

function formatMessages(messages: AgentMessage[]) {
  return messages
    .slice(-8)
    .map((message) => `${message.role === 'user' ? '用户' : '助手'}：${message.content}`)
    .join('\n\n')
}

function buildPrompt(request: AgentChatRequest) {
  const { action, context, messages } = request
  const note = context.noteMeta
  const selectedText = context.selectedText?.trim()

  return [
    `任务：${actionInstruction(action)}`,
    note
      ? `当前笔记：${note.title}\n路径：${note.path}\n标签：${note.tags.join(', ') || '无'}`
      : '当前没有打开笔记。',
    context.truncated
      ? `注意：笔记内容超过 ${MAX_CONTEXT_CHARS} 字符，以下上下文已截断为开头和结尾。`
      : null,
    selectedText ? `选中文本：\n${selectedText}` : null,
    `当前笔记 Markdown：\n${context.noteContent}`,
    messages.length > 0 ? `对话历史：\n${formatMessages(messages)}` : null,
  ].filter(Boolean).join('\n\n---\n\n')
}

function buildMessages(request: AgentChatRequest) {
  const systemLines = [
    '你是 MyNote 的 AI 助手，可以直接搜索和读取用户的笔记知识库。',
    '当用户的问题涉及笔记内容、需要查找特定信息时，请主动使用工具。',
    '始终优先使用中文回答，除非用户明确要求其他语言。',
    '保持 Markdown 格式。',
    '不要编造笔记内容——只有通过工具读取到的内容才是真实的。',
    '你不能直接读写本地文件；工具调用会自动完成。',
    '不要声称已经保存、移动、删除或修改了任何笔记。',
  ]

  return [
    { role: 'system' as const, content: systemLines.join('\n') },
    { role: 'user' as const, content: buildPrompt(request) },
  ]
}

// ── Vault File System Tools (Phase 2) ──

function walkMdFiles(vaultPath: string): string[] {
  const results: string[] = []
  const excludeDirs = new Set(['assets', '.git', '.mynote', 'exports', 'node_modules'])

  function walk(dir: string) {
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue
      const fullPath = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        if (!excludeDirs.has(entry.name)) walk(fullPath)
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        results.push(path.relative(vaultPath, fullPath).replace(/\\/g, '/'))
      }
    }
  }

  walk(vaultPath)
  return results
}

function searchInFiles(vaultPath: string, query: string, limit = 10) {
  const lower = query.toLowerCase()
  const results: { path: string; snippet: string }[] = []

  for (const relPath of walkMdFiles(vaultPath)) {
    let content: string
    try {
      content = fs.readFileSync(path.join(vaultPath, relPath), 'utf-8')
    } catch {
      continue
    }
    const lowerContent = content.toLowerCase()
    const idx = lowerContent.indexOf(lower)
    if (idx >= 0) {
      const start = Math.max(0, idx - 40)
      const end = Math.min(content.length, idx + query.length + 40)
      let snippet = content.slice(start, end).replace(/\n/g, ' ')
      if (start > 0) snippet = '...' + snippet
      if (end < content.length) snippet = snippet + '...'
      results.push({ path: relPath, snippet })
    }
    if (results.length >= limit) break
  }

  return results
}

function filesByTag(vaultPath: string, tag: string) {
  const results: { path: string; title: string }[] = []

  for (const relPath of walkMdFiles(vaultPath)) {
    let content: string
    try {
      content = fs.readFileSync(path.join(vaultPath, relPath), 'utf-8')
    } catch {
      continue
    }
    if (content.includes(`[#${tag}]`)) {
      const title = content.split('\n')[0]?.replace(/^#+\s*/, '')?.trim() || relPath
      results.push({ path: relPath, title })
    }
  }

  return results
}

function findBacklinks(vaultPath: string, targetPath: string) {
  const results: string[] = []
  const baseName = targetPath.replace(/\.md$/, '')
  const escaped = baseName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const regex = new RegExp(`\\[\\[${escaped}(?:\\||#)[^\\]]*\\]\\]|\\[\\[${escaped}\\]\\]`, 'gi')

  for (const relPath of walkMdFiles(vaultPath)) {
    let content: string
    try {
      content = fs.readFileSync(path.join(vaultPath, relPath), 'utf-8')
    } catch {
      continue
    }
    if (regex.test(content)) {
      const title = content.split('\n')[0]?.replace(/^#+\s*/, '')?.trim() || relPath
      results.push(`- ${title} (${relPath})`)
    }
  }

  return results
}

function recentFiles(vaultPath: string, limit = 10) {
  const files: { path: string; mtime: number }[] = []

  for (const relPath of walkMdFiles(vaultPath)) {
    try {
      const stat = fs.statSync(path.join(vaultPath, relPath))
      files.push({ path: relPath, mtime: stat.mtimeMs })
    } catch {
      continue
    }
  }

  files.sort((a, b) => b.mtime - a.mtime)
  return files.slice(0, limit).map((f) => {
    let title = f.path
    try {
      const content = fs.readFileSync(path.join(vaultPath, f.path), 'utf-8')
      title = content.split('\n')[0]?.replace(/^#+\s*/, '')?.trim() || f.path
    } catch { /* keep path as title */ }
    return `- ${title} (${f.path}) - ${new Date(f.mtime).toISOString().slice(0, 10)}`
  })
}

function defineTools(vaultPath: string) {
  return {
    search_notes: tool({
      description: '在知识库中全文搜索笔记。返回匹配的笔记路径和内容片段。',
      inputSchema: zodSchema(z.object({
        query: z.string().describe('搜索关键词，支持中文'),
      })),
      execute: async ({ query }) => {
        const results = searchInFiles(vaultPath, query)
        if (results.length === 0) return '未找到匹配的笔记。请尝试其他关键词。'
        return results.map((r) => `**${r.path}**\n> ${r.snippet}`).join('\n\n')
      },
    }),
    read_note: tool({
      description: '读取指定笔记的完整 Markdown 内容。',
      inputSchema: zodSchema(z.object({
        path: z.string().describe('笔记的相对路径，例如 notes/my-note.md 或 diary/2025/2025-01-15.md'),
      })),
      execute: async ({ path: notePath }) => {
        const fullPath = path.join(vaultPath, notePath)
        if (!fs.existsSync(fullPath)) return `笔记不存在: ${notePath}`
        try {
          const content = fs.readFileSync(fullPath, 'utf-8')
          if (content.length > 8000) {
            return content.slice(0, 8000) + '\n\n...(内容过长，已截断)'
          }
          return content
        } catch {
          return `无法读取笔记: ${notePath}`
        }
      },
    }),
    list_notes_by_tag: tool({
      description: '列出拥有指定标签的所有笔记。返回笔记标题和路径。',
      inputSchema: zodSchema(z.object({
        tag: z.string().describe('标签名，不含 [#] 符号'),
      })),
      execute: async ({ tag }) => {
        const results = filesByTag(vaultPath, tag)
        if (results.length === 0) return `未找到包含标签 [#${tag}] 的笔记。`
        return results.map((r) => `- ${r.title} (${r.path})`).join('\n')
      },
    }),
    get_backlinks: tool({
      description: '获取指向指定笔记的反向链接列表（哪些笔记引用了该笔记）。',
      inputSchema: zodSchema(z.object({
        path: z.string().describe('目标笔记的相对路径'),
      })),
      execute: async ({ path: targetPath }) => {
        const results = findBacklinks(vaultPath, targetPath)
        if (results.length === 0) return '没有找到引用该笔记的反向链接。'
        return results.join('\n')
      },
    }),
    list_recent_notes: tool({
      description: '列出知识库中最近更新的笔记。',
      inputSchema: zodSchema(z.object({
        limit: z.number().optional().describe('返回数量，默认 10，最多 20'),
      })),
      execute: async ({ limit = 10 }) => {
        const results = recentFiles(vaultPath, Math.min(limit, 20))
        if (results.length === 0) return '知识库中没有笔记。'
        return results.join('\n')
      },
    }),
  }
}

// ── Handler ──

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  setCorsHeaders(res)

  if (req.method === 'OPTIONS') {
    res.statusCode = 204
    res.end()
    return
  }

  if (req.method !== 'POST') {
    json(res, 405, { error: 'Method not allowed' })
    return
  }

  try {
    const rawBody = await readRequestBody(req)
    const parsed = JSON.parse(rawBody)
    assertRequest(parsed)

    const apiKey = parsed.providerConfig?.apiKey || process.env.DEEPSEEK_API_KEY
    if (!apiKey) {
      json(res, 500, { error: 'Missing DeepSeek API key. Configure it in MyNote AI settings or set DEEPSEEK_API_KEY on Vercel.' })
      return
    }

    const provider = createOpenAICompatible({
      name: 'deepseek',
      baseURL: parsed.providerConfig?.baseURL || process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com',
      apiKey,
    })

    const vaultPath = parsed.vaultPath || ''
    const hasVault = vaultPath.length > 0 && fs.existsSync(vaultPath)
    const tools = hasVault ? defineTools(vaultPath) : undefined

    const result = streamText({
      model: provider.chatModel(parsed.providerConfig?.model || process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash'),
      messages: buildMessages(parsed),
      tools,
      stopWhen: stepCountIs(tools ? 5 : 1),
      temperature: 0.3,
    })

    // Stream as SSE with typed events for tool call progress
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
    res.setHeader('Cache-Control', 'no-store')
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('Access-Control-Allow-Origin', '*')

    try {
      for await (const chunk of result.fullStream) {
        switch (chunk.type) {
          case 'text-delta':
            writeSSE(res, { type: 'text', delta: chunk.text })
            break
          case 'tool-call':
            writeSSE(res, {
              type: 'tool_start',
              name: chunk.toolName,
              args: (chunk as any).input ?? {},
            })
            break
          case 'tool-result':
            writeSSE(res, {
              type: 'tool_end',
              name: chunk.toolName,
              result: typeof (chunk as any).output === 'string'
                ? (chunk as any).output.slice(0, 200)
                : 'ok',
            })
            break
          case 'error':
            writeSSE(res, { type: 'error', error: String((chunk as any).error ?? 'Unknown error') })
            break
          // Silently skip metadata events (start-step, finish-step, start, finish, etc.)
          default:
            break
        }
      }
    } catch (streamError) {
      console.error('[agent/chat] Stream error:', streamError)
      if (!res.writableEnded) {
        writeSSE(res, { type: 'error', error: String(streamError) })
      }
    }
    writeSSE(res, { type: 'done' })
    res.end()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error('[agent/chat] Handler error:', message)
    if (!res.headersSent) {
      json(res, 400, { error: message })
      return
    }
    if (!res.writableEnded) {
      writeSSE(res, { type: 'error', error: message })
      writeSSE(res, { type: 'done' })
      res.end()
    }
  }
}
