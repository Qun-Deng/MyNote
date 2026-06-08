import { useEffect, useRef } from 'react'
import { Editor, rootCtx, defaultValueCtx } from '@milkdown/kit/core'
import { commonmark } from '@milkdown/kit/preset/commonmark'
import { gfm } from '@milkdown/kit/preset/gfm'
import { history } from '@milkdown/kit/plugin/history'
import { listener, listenerCtx } from '@milkdown/kit/plugin/listener'
import { prism } from '@milkdown/plugin-prism'
import { emoji } from '@milkdown/plugin-emoji'
import { clipboard } from '@milkdown/kit/plugin/clipboard'
import type { Ctx } from '@milkdown/ctx'
import '../../styles/milkdown.css'

interface MilkdownEditorProps {
  content: string
  onContentChange: (markdown: string) => void
  readOnly?: boolean
}

function splitFrontmatter(markdown: string) {
  const standardFrontmatter = markdown.match(/^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/)
  if (standardFrontmatter) {
    return {
      frontmatter: standardFrontmatter[0].replace(/\r?\n$/, ''),
      body: markdown.slice(standardFrontmatter[0].length),
    }
  }

  const diaryMetaLine = markdown.match(
    /^(?:[ \t]*\r?\n)*\[?(?:#{1,6}\s*)?date:\s*(\d{4}-\d{2}-\d{2})\s+tags:\s*(\\?\[[^\]\r\n]*\\?\])[ \t]*\]?(?:\r?\n|$)/,
  )
  if (diaryMetaLine) {
    const tags = diaryMetaLine[2].replace(/\\/g, '')
    const body = markdown
      .slice(diaryMetaLine[0].length)
      .replace(/^---[ \t]*(?:\r?\n|$)/, '')

    return {
      frontmatter: `---\ndate: ${diaryMetaLine[1]}\ntags: ${tags}\n---`,
      body,
    }
  }

  return { frontmatter: '', body: markdown }
}

function mergeFrontmatter(frontmatter: string, body: string) {
  if (!frontmatter) return body
  if (!body.trim()) return `${frontmatter}\n`
  return `${frontmatter}\n\n${body.replace(/^\r?\n/, '')}`
}

function configureEditor(container: HTMLDivElement, initialContent: string) {
  return (ctx: Ctx) => {
    ctx.set(rootCtx, container)
    ctx.set(defaultValueCtx, initialContent)
    return () => {}
  }
}

export default function MilkdownEditor({ content, onContentChange, readOnly = false }: MilkdownEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<Editor | null>(null)
  const initialized = useRef(false)
  const frontmatterRef = useRef('')

  // Initialize editor once per mount (key changes trigger remount)
  useEffect(() => {
    const container = containerRef.current
    if (!container || initialized.current) return
    initialized.current = true
    const { frontmatter, body } = splitFrontmatter(content)
    frontmatterRef.current = frontmatter

    let editor: Editor

    Editor.make()
      .use(configureEditor(container, body))
      .use(commonmark)
      .use(gfm)
      .use(history)
      .use(listener)
      .use(prism)
      .use(emoji)
      .use(clipboard)
      .create()
      .then((created) => {
        editor = created
        editorRef.current = editor

        // Register markdown change listener
        const listenerManager = editor.ctx.get(listenerCtx)
        listenerManager.markdownUpdated((_ctx, markdown) => {
          onContentChange(mergeFrontmatter(frontmatterRef.current, markdown))
        })
      })

    return () => {
      if (editorRef.current) {
        editorRef.current.destroy()
        editorRef.current = null
        initialized.current = false
      }
    }
  }, []) // Only create on mount

  return (
    <div
      ref={containerRef}
      className="milkdown-editor-container"
      data-readonly={readOnly}
    />
  )
}
