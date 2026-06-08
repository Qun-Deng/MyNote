import { useEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent } from 'react'
import { Editor, rootCtx, defaultValueCtx, editorViewCtx } from '@milkdown/kit/core'
import { commonmark } from '@milkdown/kit/preset/commonmark'
import { gfm } from '@milkdown/kit/preset/gfm'
import { history } from '@milkdown/kit/plugin/history'
import { listener, listenerCtx } from '@milkdown/kit/plugin/listener'
import { prism } from '@milkdown/plugin-prism'
import { emoji } from '@milkdown/plugin-emoji'
import { clipboard } from '@milkdown/kit/plugin/clipboard'
import { Plugin, PluginKey, TextSelection } from '@milkdown/kit/prose/state'
import { Decoration, DecorationSet } from '@milkdown/kit/prose/view'
import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import { $prose } from '@milkdown/utils'
import type { Ctx } from '@milkdown/ctx'
import {
  executeTableAction,
  executeEditorAction,
  filterSlashActions,
  getSlashTrigger,
  getTableCellPosition,
  handleEditorShortcut,
  handleTableCellMouseDown,
  handleTaskItemClick,
  handleWikilinkClick,
  type TableActionId,
  type SlashTrigger,
} from './editorInteractions'
import '../../styles/milkdown.css'

interface MilkdownEditorProps {
  content: string
  onContentChange: (markdown: string) => void
  onNavigate?: (path: string) => void
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

function appendEditableParagraphIfNeeded(editor: Editor) {
  const view = editor.ctx.get(editorViewCtx)
  const { doc, schema } = view.state
  const lastNode = doc.lastChild
  if (lastNode?.type.name === 'paragraph') return

  const paragraph = schema.nodes.paragraph.create()
  view.dispatch(view.state.tr.insert(doc.content.size, paragraph))
}

// ── ProseMirror indent-decoration plugin ──────────────────────────
// Uses ProseMirror's native Decoration system so the visual markers
// survive re-renders without manual DOM surgery.

const indentPluginKey = new PluginKey('mdIndent')

const SKIP_PARENTS = new Set([
  'list_item', 'bullet_list', 'ordered_list',
  'table', 'table_row', 'table_cell', 'table_header',
  'code_block',
])

function computeIndentLevel(text: string) {
  const leading = text.match(/^[\t ]+/)?.[0] ?? ''
  if (!leading) return 0
  const width = [...leading].reduce((sum, ch) => sum + (ch === '\t' ? 2 : 1), 0)
  return Math.min(6, Math.floor(width / 2))
}

function buildIndentDecorations(doc: ProseNode) {
  const decos: Decoration[] = []

  doc.descendants((node: ProseNode, pos: number) => {
    if (node.type.name !== 'paragraph' && node.type.name !== 'heading') return

    // Skip if inside a list / table / code-block
    const $pos = doc.resolve(pos)
    for (let d = $pos.depth - 1; d >= 0; d -= 1) {
      if (SKIP_PARENTS.has($pos.node(d).type.name)) return
    }

    const text = node.textContent
    const leadingMatch = text.match(/^[\t ]+/)
    if (!leadingMatch) return

    const level = computeIndentLevel(text)
    if (level === 0) return

    // Hide the leading whitespace (tab spaces become invisible) and
    // apply the visual indicator (border + background) to the text.
    const leadLen = leadingMatch[0].length
    const contentStart = pos + 1              // first character of content
    const textStart = contentStart + leadLen   // first non-whitespace character
    const contentEnd = pos + node.nodeSize

    // Decoration 1: hide the leading whitespace so only the indent
    // indicator is visible — tab stops are rendered, not literal spaces.
    if (leadLen > 0) {
      decos.push(
        Decoration.inline(contentStart, textStart, {
          class: 'md-indent-space',
        }),
      )
    }

    // Decoration 2: visual indicator hugs the actual text
    decos.push(
      Decoration.inline(textStart, contentEnd, {
        class: `md-indent md-indent-${level}`,
      }),
    )
  })

  return DecorationSet.create(doc, decos)
}

const markdownIndentProsePlugin = new Plugin({
  key: indentPluginKey,
  state: {
    init(_, state) {
      return buildIndentDecorations(state.doc)
    },
    apply(tr, prev, _oldState, newState) {
      if (!tr.docChanged) return prev
      return buildIndentDecorations(newState.doc)
    },
  },
  props: {
    decorations(state) {
      try {
        return indentPluginKey.getState(state)
      } catch {
        return DecorationSet.empty
      }
    },
  },
})

// Wrap as a Milkdown plugin so it can be .use()-d in the editor chain.
const markdownIndent = $prose(() => markdownIndentProsePlugin)

// ── Collapsible (toggle) list plugin ──────────────────────────
// Like Notion's toggle list: click the ▼/► icon to collapse/expand
// nested children.  Uses decorations so state survives re-renders.

const collapsePluginKey = new PluginKey('collapsibleList')

function isCollapsibleListItem(node: ProseNode): boolean {
  if (node.type.name !== 'list_item') return false
  for (let i = 0; i < node.childCount; i++) {
    const name = node.child(i).type.name
    if (name === 'bullet_list' || name === 'ordered_list') return true
  }
  return false
}

const collapsibleListProsePlugin = new Plugin({
  key: collapsePluginKey,
  state: {
    init() {
      return { collapsed: new Set<number>() }
    },
    apply(tr, prev, _oldState, newState) {
      const meta = tr.getMeta(collapsePluginKey)

      let collapsed: Set<number> = prev.collapsed

      // Map positions through doc changes so collapsed state
      // follows its list item even when surrounding text is edited.
      if (tr.docChanged && collapsed.size > 0) {
        const next = new Set<number>()
        for (const pos of collapsed) {
          const mapped = tr.mapping.map(pos)
          try {
            const $pos = newState.doc.resolve(mapped)
            const node = $pos.nodeAfter
            if (node && isCollapsibleListItem(node) && $pos.pos === mapped) {
              next.add(mapped)
            }
          } catch { /* position gone – drop it */ }
        }
        collapsed = next
      }

      if (meta?.togglePos !== undefined) {
        const next = new Set(collapsed)
        const pos = tr.docChanged ? tr.mapping.map(meta.togglePos) : meta.togglePos
        if (next.has(pos)) {
          next.delete(pos)
        } else {
          next.add(pos)
        }
        return { collapsed: next }
      }

      if (collapsed !== prev.collapsed) return { collapsed }
      return prev
    },
  },
  props: {
    decorations(state) {
      try {
        const pluginState = collapsePluginKey.getState(state)
        if (!pluginState || pluginState.collapsed.size === 0) return DecorationSet.empty

        const decos: Decoration[] = []
        for (const pos of pluginState.collapsed) {
          try {
            const $pos = state.doc.resolve(pos)
            const node = $pos.nodeAfter
            if (node && isCollapsibleListItem(node)) {
              decos.push(Decoration.node(pos, pos + node.nodeSize, {
                class: 'md-list-collapsed',
              }))
            }
          } catch { /* stale position */ }
        }
        return decos.length > 0 ? DecorationSet.create(state.doc, decos) : DecorationSet.empty
      } catch {
        return DecorationSet.empty
      }
    },
    handleDOMEvents: {
      click(view, event) {
        const target = event.target
        if (!(target instanceof HTMLElement)) return false

        // 1) Find closest <li> ancestor
        const li = target.closest<HTMLLIElement>('li')
        if (!li) return false

        // 2) Must have a nested ul/ol as a direct child
        if (!li.querySelector(':scope > ul, :scope > ol')) return false

        // 3) Click must be in the toggle zone — left of the first <p>
        const firstP = li.querySelector(':scope > p')
        const thresholdX = firstP
          ? firstP.getBoundingClientRect().left
          : li.getBoundingClientRect().left + 32
        if (event.clientX >= thresholdX) return false

        // 4) Find the ProseMirror list_item node position
        const domPos = view.posAtDOM(li, 0)
        const $pos = view.state.doc.resolve(domPos)
        let itemPos = -1
        for (let d = $pos.depth; d >= 0; d -= 1) {
          if ($pos.node(d).type.name === 'list_item') {
            itemPos = $pos.before(d)
            break
          }
        }
        if (itemPos < 0) return false

        // 5) Dispatch meta transaction → plugin toggles the decoration
        view.dispatch(view.state.tr.setMeta(collapsePluginKey, { togglePos: itemPos }))

        event.preventDefault()
        event.stopPropagation()
        return true
      },
    },
  },
})

const collapsibleList = $prose(() => collapsibleListProsePlugin)

// ── Tag highlight plugin ──────────────────────────────────────────
// Detects #tag patterns in text and applies a highlight decoration
// so tags stand out visually from normal prose.

const tagHighlightPluginKey = new PluginKey('mdTagHighlight')

const TAG_REGEX = /#[\w一-鿿㐀-䶿＀-￯-]+/g

function buildTagDecorations(doc: ProseNode) {
  const decos: Decoration[] = []

  doc.descendants((node: ProseNode, pos: number) => {
    if (!node.isText) return

    const text = node.text ?? ''
    let match: RegExpExecArray | null
    TAG_REGEX.lastIndex = 0

    while ((match = TAG_REGEX.exec(text)) !== null) {
      const from = pos + match.index
      const to = from + match[0].length
      decos.push(
        Decoration.inline(from, to, { class: 'md-tag' }),
      )
    }
  })

  return DecorationSet.create(doc, decos)
}

const tagHighlightProsePlugin = new Plugin({
  key: tagHighlightPluginKey,
  state: {
    init(_, state) {
      return buildTagDecorations(state.doc)
    },
    apply(tr, prev, _oldState, newState) {
      if (!tr.docChanged) return prev
      return buildTagDecorations(newState.doc)
    },
  },
  props: {
    decorations(state) {
      try {
        return tagHighlightPluginKey.getState(state)
      } catch {
        return DecorationSet.empty
      }
    },
  },
})

const tagHighlight = $prose(() => tagHighlightProsePlugin)

// ── Wikilink highlight plugin ───────────────────────────────────────

const wikilinkPluginKey = new PluginKey('mdWikilink')
const WIKILINK_REGEX = /\[\[([^\]|#]+)(?:[|#][^\]]+)?\]\]/g

function buildWikilinkDecorations(doc: ProseNode) {
  const decos: Decoration[] = []

  doc.descendants((node: ProseNode, pos: number) => {
    if (!node.isText) return
    const text = node.text ?? ''
    let match: RegExpExecArray | null
    WIKILINK_REGEX.lastIndex = 0

    while ((match = WIKILINK_REGEX.exec(text)) !== null) {
      const from = pos + match.index
      const to = from + match[0].length
      decos.push(
        Decoration.inline(from, to, { class: 'md-wikilink' }),
      )
    }
  })

  return DecorationSet.create(doc, decos)
}

const wikilinkProsePlugin = new Plugin({
  key: wikilinkPluginKey,
  state: {
    init(_, state) {
      return buildWikilinkDecorations(state.doc)
    },
    apply(tr, prev, _oldState, newState) {
      if (!tr.docChanged) return prev
      return buildWikilinkDecorations(newState.doc)
    },
  },
  props: {
    decorations(state) {
      try {
        return wikilinkPluginKey.getState(state)
      } catch {
        return DecorationSet.empty
      }
    },
  },
})

const wikilinkHighlight = $prose(() => wikilinkProsePlugin)

export default function MilkdownEditor({ content, onContentChange, onNavigate, readOnly = false }: MilkdownEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<Editor | null>(null)
  const tableActionLockRef = useRef(false)
  const initialized = useRef(false)
  const frontmatterRef = useRef('')
  const onNavigateRef = useRef(onNavigate)
  onNavigateRef.current = onNavigate
  const [slashTrigger, setSlashTrigger] = useState<SlashTrigger | null>(null)
  const [selectedSlashIndex, setSelectedSlashIndex] = useState(0)
  const [tableAddControls, setTableAddControls] = useState<{
    cellPos: number
    rowDeleteLeft: number
    rowDeleteTop: number
    rowLeft: number
    rowTop: number
    colDeleteLeft: number
    colDeleteTop: number
    colLeft: number
    colTop: number
  } | null>(null)

  const slashItems = useMemo(() => {
    return slashTrigger ? filterSlashActions(slashTrigger.query) : []
  }, [slashTrigger])

  const closeSlashMenu = () => {
    setSlashTrigger(null)
    setSelectedSlashIndex(0)
  }

  const closeTableAddControls = () => setTableAddControls(null)

  const syncSlashMenu = () => {
    const editor = editorRef.current
    const container = containerRef.current
    if (!editor || !container || readOnly) return
    const trigger = getSlashTrigger(editor, container)
    setSlashTrigger((prev) => {
      // Only reset selected index when query actually changed
      if (trigger && prev && trigger.query === prev.query) {
        return trigger
      }
      setSelectedSlashIndex(0)
      return trigger
    })
  }

  const runSlashAction = (actionId: string) => {
    const editor = editorRef.current
    if (!editor || !slashTrigger) return
    executeEditorAction(editor, actionId, slashTrigger)
    closeSlashMenu()
    closeTableAddControls()
  }

  const runTableAction = (actionId: TableActionId, cellPos: number) => {
    const editor = editorRef.current
    if (!editor || tableActionLockRef.current) return
    tableActionLockRef.current = true
    try {
      executeTableAction(editor, actionId, cellPos)
      closeTableAddControls()
    } finally {
      window.setTimeout(() => {
        tableActionLockRef.current = false
      })
    }
  }

  const syncTableAddControls = (event: ReactMouseEvent<HTMLDivElement>) => {
    const editor = editorRef.current
    const shell = containerRef.current?.parentElement
    const target = event.target
    if (!editor || !shell || !(target instanceof HTMLElement)) return
    if (target.closest('.md-table-edge-control')) return

    const cell = target.closest<HTMLElement>('td, th')
    if (!cell) {
      closeTableAddControls()
      return
    }

    const cellPos = getTableCellPosition(editor, cell, {
      left: event.clientX,
      top: event.clientY,
    })
    if (cellPos === false) {
      closeTableAddControls()
      return
    }

    const shellRect = shell.getBoundingClientRect()
    const cellRect = cell.getBoundingClientRect()
    setTableAddControls({
      cellPos,
      rowDeleteLeft: cellRect.left - shellRect.left,
      rowDeleteTop: cellRect.top + cellRect.height / 2 - shellRect.top,
      rowLeft: cellRect.left + cellRect.width / 2 - shellRect.left,
      rowTop: cellRect.bottom - shellRect.top,
      colDeleteLeft: cellRect.left + cellRect.width / 2 - shellRect.left,
      colDeleteTop: cellRect.top - shellRect.top,
      colLeft: cellRect.right - shellRect.left,
      colTop: cellRect.top + cellRect.height / 2 - shellRect.top,
    })
  }

  const focusEditorEnd = () => {
    const editor = editorRef.current
    if (!editor) return
    try {
      const view = editor.ctx.get(editorViewCtx)
      if (view.hasFocus()) return
      // Defer focus to avoid race with React event system
      window.setTimeout(() => {
        try {
          const endPos = Math.max(1, view.state.doc.content.size - 1)
          const selection = TextSelection.near(view.state.doc.resolve(endPos))
          view.dispatch(view.state.tr.setSelection(selection).scrollIntoView())
          view.focus()
        } catch { /* editor may have been destroyed */ }
      })
    } catch { /* ctx not ready */ }
  }

  const handleKeyDownCapture = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Tab' || slashTrigger) return
    const editor = editorRef.current
    if (!editor) return
    if (handleEditorShortcut(editor, event)) {
      closeSlashMenu()
    }
  }

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
      .use(markdownIndent)
      .use(collapsibleList)
      .use(tagHighlight)
      .use(wikilinkHighlight)
      .create()
      .then((created) => {
        editor = created
        editorRef.current = editor
        appendEditableParagraphIfNeeded(editor)

        // Register markdown change listener
        const listenerManager = editor.ctx.get(listenerCtx)
        listenerManager.markdownUpdated((_ctx, markdown) => {
          onContentChange(mergeFrontmatter(frontmatterRef.current, markdown))
        })

        // ── Image paste handler ──
        const view = editor.ctx.get(editorViewCtx)
        const pmDom = view.dom

        const handleImagePaste = async (e: ClipboardEvent) => {
          const items = e.clipboardData?.items
          if (!items) return

          for (let i = 0; i < items.length; i++) {
            const item = items[i]
            if (item.type.startsWith('image/')) {
              e.preventDefault()
              e.stopPropagation()
              const blob = item.getAsFile()
              if (!blob) continue
              try {
                const buffer = await blob.arrayBuffer()
                const filename = `pasted-${Date.now()}.${blob.type.split('/')[1] || 'png'}`
                const relPath = await window.mynote.assets.saveImage(buffer, filename)
                const { state, dispatch } = view
                const tr = state.tr.insertText(`![](${relPath})`, state.selection.from)
                dispatch(tr.scrollIntoView())
                view.focus()
              } catch (err) {
                console.error('Failed to save pasted image:', err)
              }
              break
            }
          }
        }

        const handleImageDrop = async (e: DragEvent) => {
          const files = e.dataTransfer?.files
          if (!files || files.length === 0) return
          let handled = false
          for (let i = 0; i < files.length; i++) {
            const file = files[i]
            if (file.type.startsWith('image/')) {
              if (!handled) {
                e.preventDefault()
                e.stopPropagation()
                handled = true
              }
              try {
                const buffer = await file.arrayBuffer()
                const relPath = await window.mynote.assets.saveImage(buffer, file.name)
                // Insert at drop position
                const dropPos = view.posAtCoords({ left: e.clientX, top: e.clientY })
                const pos = dropPos?.pos ?? view.state.selection.from
                const { state, dispatch } = view
                const tr = state.tr.insertText(`![](${relPath})\n`, pos)
                dispatch(tr.scrollIntoView())
                view.focus()
              } catch (err) {
                console.error('Failed to save dropped image:', err)
              }
            }
          }
        }

        pmDom.addEventListener('paste', handleImagePaste)
        pmDom.addEventListener('dragover', (e) => {
          if (e.dataTransfer?.types.includes('Files')) {
            e.preventDefault()
            e.dataTransfer.dropEffect = 'copy'
          }
        })
        pmDom.addEventListener('drop', handleImageDrop)
      })
      .catch((err) => {
        console.error('Failed to create Milkdown editor:', err)
        initialized.current = false
      })

    return () => {
      if (editorRef.current) {
        editorRef.current.destroy()
        editorRef.current = null
        initialized.current = false
      }
    }
  }, []) // Only create on mount

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const handleClick = (event: MouseEvent) => {
      const editor = editorRef.current
      if (!editor) return
      // Wikilink navigation: Ctrl/Cmd+click only
      if ((event.ctrlKey || event.metaKey) && handleWikilinkClick(editor, event, onNavigateRef.current)) return
      // Task item click
      if (handleTaskItemClick(editor, event)) return
      closeSlashMenu()
    }

    container.addEventListener('click', handleClick)
    return () => {
      container.removeEventListener('click', handleClick)
    }
  }, [])

  return (
    <div className="milkdown-editor-shell" onMouseLeave={closeTableAddControls}>
      <div
        ref={containerRef}
        className="milkdown-editor-container"
        data-readonly={readOnly}
        onMouseMove={syncTableAddControls}
        onKeyDownCapture={handleKeyDownCapture}
        onMouseDown={(event) => {
          const target = event.target
          if (!(target instanceof HTMLElement)) return
          const editor = editorRef.current
          if (editor) handleTableCellMouseDown(editor, event.nativeEvent)
          if (target.closest('.ProseMirror')) return
          event.preventDefault()
          focusEditorEnd()
        }}
        onKeyDown={(event) => {
          const editor = editorRef.current
          if (!editor) return

          if (slashTrigger) {
            if (event.key === 'ArrowDown') {
              event.preventDefault()
              setSelectedSlashIndex((index) => (index + 1) % Math.max(slashItems.length, 1))
              return
            }
            if (event.key === 'ArrowUp') {
              event.preventDefault()
              setSelectedSlashIndex((index) => {
                return (index - 1 + Math.max(slashItems.length, 1)) % Math.max(slashItems.length, 1)
              })
              return
            }
            if (event.key === 'Enter' || event.key === 'Tab') {
              event.preventDefault()
              const item = slashItems[selectedSlashIndex]
              if (item) runSlashAction(item.id)
              return
            }
            if (event.key === 'Escape') {
              event.preventDefault()
              closeSlashMenu()
              return
            }
          }

          if (handleEditorShortcut(editor, event)) {
            closeSlashMenu()
          }
        }}
        onKeyUp={(event) => {
          // Don't sync on navigation/action keys — avoids resetting selection in slash menu
          if (event.key === 'Escape' || event.key === 'Enter' || event.key === 'ArrowDown' || event.key === 'ArrowUp') return
          window.setTimeout(syncSlashMenu)
        }}
      />

      {slashTrigger && slashItems.length > 0 && (
        <div
          className="md-slash-menu"
          style={{ left: slashTrigger.left, top: slashTrigger.top }}
          onMouseDown={(event) => event.preventDefault()}
        >
          {slashItems.map((item, index) => (
            <button
              key={item.id}
              type="button"
              className={`md-slash-item ${index === selectedSlashIndex ? 'active' : ''}`}
              onMouseEnter={() => setSelectedSlashIndex(index)}
              onMouseDown={(event) => {
                event.preventDefault()
                runSlashAction(item.id)
              }}
            >
              <span>
                <strong>{item.label}</strong>
                {item.description && <small>{item.description}</small>}
              </span>
            </button>
          ))}
        </div>
      )}

      {tableAddControls && (
        <>
          <button
            type="button"
            className="md-table-edge-control md-table-delete-control md-table-delete-row"
            style={{ left: tableAddControls.rowDeleteLeft, top: tableAddControls.rowDeleteTop }}
            title="删除当前行"
            onMouseDown={(event) => {
              event.preventDefault()
              event.stopPropagation()
            }}
            onClick={(event) => {
              event.preventDefault()
              event.stopPropagation()
              runTableAction('delete-row', tableAddControls.cellPos)
            }}
          >
            -
          </button>
          <button
            type="button"
            className="md-table-edge-control md-table-delete-control md-table-delete-column"
            style={{ left: tableAddControls.colDeleteLeft, top: tableAddControls.colDeleteTop }}
            title="删除当前列"
            onMouseDown={(event) => {
              event.preventDefault()
              event.stopPropagation()
            }}
            onClick={(event) => {
              event.preventDefault()
              event.stopPropagation()
              runTableAction('delete-column', tableAddControls.cellPos)
            }}
          >
            -
          </button>
          <button
            type="button"
            className="md-table-edge-control md-table-add-control md-table-add-row"
            style={{ left: tableAddControls.rowLeft, top: tableAddControls.rowTop }}
            title="在下方插入行"
            onMouseDown={(event) => {
              event.preventDefault()
              event.stopPropagation()
            }}
            onClick={(event) => {
              event.preventDefault()
              event.stopPropagation()
              runTableAction('insert-row-after', tableAddControls.cellPos)
            }}
          >
            +
          </button>
          <button
            type="button"
            className="md-table-edge-control md-table-add-control md-table-add-column"
            style={{ left: tableAddControls.colLeft, top: tableAddControls.colTop }}
            title="在右侧插入列"
            onMouseDown={(event) => {
              event.preventDefault()
              event.stopPropagation()
            }}
            onClick={(event) => {
              event.preventDefault()
              event.stopPropagation()
              runTableAction('insert-column-after', tableAddControls.cellPos)
            }}
          >
            +
          </button>
        </>
      )}
    </div>
  )
}
