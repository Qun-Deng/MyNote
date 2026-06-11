import type { IncomingMessage, ServerResponse } from 'node:http'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { streamText } from 'ai'
import type { AgentAction, AgentChatRequest, AgentMessage } from '../../shared/agent'

const MAX_CONTEXT_CHARS = 30_000

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

function assertRequest(value: unknown): asserts value is AgentChatRequest {
  if (!value || typeof value !== 'object') throw new Error('Invalid request body')
  const request = value as Partial<AgentChatRequest>
  if (!Array.isArray(request.messages)) throw new Error('messages must be an array')
  if (typeof request.action !== 'string') throw new Error('action is required')
  if (!request.context || typeof request.context !== 'object') throw new Error('context is required')
  if (typeof request.context.noteContent !== 'string') throw new Error('context.noteContent is required')
}

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
      return '请回答用户关于当前笔记的问题。只基于提供的上下文回答；如果上下文不足，请说明还需要哪些信息。'
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

    const result = streamText({
      model: provider.chatModel(parsed.providerConfig?.model || process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash'),
      system: [
        '你是 MyNote 的当前笔记 AI 助手。',
        '始终优先使用中文回答，除非用户明确要求其他语言。',
        '保持 Markdown 格式，不编造未提供的笔记内容。',
        '你不能直接读写本地文件；如果任务涉及修改笔记，只输出可预览的草稿内容。',
        '不要声称已经保存、移动、删除或修改了任何笔记。',
      ].join('\n'),
      prompt: buildPrompt(parsed),
    })

    result.pipeTextStreamToResponse(res, {
      headers: {
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'Access-Control-Allow-Origin': '*',
      },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (!res.headersSent) {
      json(res, 400, { error: message })
      return
    }
    res.end()
  }
}
