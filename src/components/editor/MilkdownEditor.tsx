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

  // Initialize editor once per mount (key changes trigger remount)
  useEffect(() => {
    const container = containerRef.current
    if (!container || initialized.current) return
    initialized.current = true

    let editor: Editor

    Editor.make()
      .use(configureEditor(container, content))
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
          onContentChange(markdown)
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
      style={{ padding: '2rem 3rem', maxWidth: '800px', margin: '0 auto', height: '100%' }}
      data-readonly={readOnly}
    />
  )
}
