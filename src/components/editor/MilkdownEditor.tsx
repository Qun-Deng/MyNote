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
import katex from 'katex'
import '../../styles/milkdown.css'
import 'katex/dist/katex.min.css'

interface MilkdownEditorProps {
  content: string
  onContentChange: (markdown: string) => void
  onNavigate?: (path: string) => void
  onTagClick?: (tag: string) => void
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

// ── List Backspace fix (TODO) ──────────────────────────────────
// The handleKeyDown approach interferes with Enter key processing.
// We'll use prosemirror-keymap's keymap() instead, which binds
// Backspace to a command that checks the cursor position and
// prevents liftListItem from firing at list_item paragraph start.
//
// import { keymap } from 'prosemirror-keymap'
// const listBackspacePlugin = $prose(() => keymap({
//   Backspace: (state, dispatch) => {
//     const { $from } = state.selection
//     if ($from.parentOffset === 0 && $from.node(-1).type.name === 'list_item') {
//       return true // handled — prevent lift
//     }
//     return false // let default behavior run
//   }
// }))
//
// Then add .use(listBackspacePlugin) below.

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

const TAG_REGEX = /(^|[\s([{])(\\?)#([\p{L}\p{N}_-]+)/gu

function buildTagDecorations(doc: ProseNode) {
  const decos: Decoration[] = []

  doc.descendants((node: ProseNode, pos: number) => {
    if (!node.isText) return

    const text = node.text ?? ''
    let match: RegExpExecArray | null
    TAG_REGEX.lastIndex = 0

    while ((match = TAG_REGEX.exec(text)) !== null) {
      const prefixLength = match[1]?.length ?? 0
      const escapeLength = match[2]?.length ?? 0
      const from = pos + match.index + prefixLength + escapeLength
      const to = from + match[3].length + 1
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

// ── Math (KaTeX) plugin ────────────────────────────────────────────
// Renders $inline$ and $$block$$ math with KaTeX via widget decorations.
// While the cursor is inside the source, keep markdown visible for editing.

const mathPluginKey = new PluginKey('mdMath')

function isMathRangeActive(selection: { from: number; to: number; empty: boolean }, from: number, to: number) {
  if (selection.empty) return selection.from > from && selection.from < to
  return selection.from <= to && selection.to >= from
}

function createMathPreview(
  kind: 'inline' | 'block',
  formula: string,
  from: number,
  to: number,
  delimiterSize: number,
) {
  const html = katex.renderToString(formula, {
    displayMode: kind === 'block',
    throwOnError: false,
  })
  const element = document.createElement(kind === 'block' ? 'div' : 'span')
  element.className = kind === 'block' ? 'katex-block' : 'katex-inline'
  element.innerHTML = html
  element.contentEditable = 'false'
  element.dataset.mdMathPreview = 'true'
  element.dataset.mdMathFrom = String(from)
  element.dataset.mdMathTo = String(to)
  element.dataset.mdMathDelimiter = String(delimiterSize)
  element.title = 'Double-click to edit formula'
  return element
}

function buildMathDecorations(doc: ProseNode, selection: { from: number; to: number; empty: boolean }) {
  const decos: Decoration[] = []

  doc.descendants((node: ProseNode, pos: number) => {
    if (!node.isTextblock || node.type.spec.code) return

    const pieces: Array<{ textStart: number; textEnd: number; docStart: number }> = []
    let text = ''
    node.descendants((child: ProseNode, childPos: number) => {
      if (!child.isText) return
      const value = child.text ?? ''
      if (!value) return
      pieces.push({
        textStart: text.length,
        textEnd: text.length + value.length,
        docStart: pos + 1 + childPos,
      })
      text += value
    })
    if (!text) return false

    const offsetToDocPos = (offset: number) => {
      for (const piece of pieces) {
        if (offset >= piece.textStart && offset <= piece.textEnd) {
          return piece.docStart + offset - piece.textStart
        }
      }
      return null
    }

    const blockRanges: Array<{ start: number; end: number }> = []
    const blockRegex = /(^|\n)([ \t]*)\$\$([\s\S]+?)\$\$[ \t]*(?=\n|$)/g
    let match: RegExpExecArray | null

    // Display math only when $$...$$ is its own line.
    while ((match = blockRegex.exec(text)) !== null) {
      const sourceStart = match.index + match[1].length + match[2].length
      const sourceEnd = sourceStart + match[0].length - match[1].length - match[2].length
      const formula = match[3].trim()
      if (!formula) continue
      blockRanges.push({ start: sourceStart, end: sourceEnd })

      const from = offsetToDocPos(sourceStart)
      const to = offsetToDocPos(sourceEnd)
      if (from === null || to === null) continue

      try {
        const active = isMathRangeActive(selection, from, to)
        decos.push(Decoration.inline(from, to, {
          class: active ? 'md-math-source md-math-source-active' : 'md-math-source',
        }))
        if (!active) {
          decos.push(Decoration.widget(
            from,
            createMathPreview('block', formula, from, to, 2),
            { side: -1 },
          ))
        }
      } catch {}
    }

    const isInBlockRange = (offset: number) => blockRanges.some(({ start, end }) => offset >= start && offset < end)
    const isEscaped = (offset: number) => {
      let slashCount = 0
      for (let i = offset - 1; i >= 0 && text[i] === '\\'; i--) slashCount++
      return slashCount % 2 === 1
    }

    // Inline math: $...$ anywhere inside a text block, including around CJK text.
    for (let start = 0; start < text.length; start++) {
      if (text[start] !== '$' || text[start + 1] === '$' || text[start - 1] === '$' || isEscaped(start) || isInBlockRange(start)) {
        continue
      }

      let end = start + 1
      while (end < text.length) {
        if (text[end] === '\n') break
        if (text[end] === '$' && text[end + 1] !== '$' && !isEscaped(end)) break
        end++
      }

      if (text[end] !== '$' || isInBlockRange(end)) continue
      const formula = text.slice(start + 1, end).trim()
      if (!formula) continue

      const from = offsetToDocPos(start)
      const to = offsetToDocPos(end + 1)
      if (from === null || to === null) continue

      try {
        const active = isMathRangeActive(selection, from, to)
        decos.push(Decoration.inline(from, to, {
          class: active ? 'md-math-source md-math-source-active' : 'md-math-source',
        }))
        if (!active) {
          decos.push(Decoration.widget(
            from,
            createMathPreview('inline', formula, from, to, 1),
            { side: -1 },
          ))
        }
      } catch {}

      start = end
    }

    return false
  })

  return DecorationSet.create(doc, decos)
}

const mathProsePlugin = new Plugin({
  key: mathPluginKey,
  state: {
    init(_, state) {
      return buildMathDecorations(state.doc, state.selection)
    },
    apply(tr, prev, oldState, newState) {
      if (!tr.docChanged && oldState.selection.eq(newState.selection)) return prev
      return buildMathDecorations(newState.doc, newState.selection)
    },
  },
  props: {
    decorations(state) {
      try {
        return mathPluginKey.getState(state)
      } catch {
        return DecorationSet.empty
      }
    },
    handleDOMEvents: {
      mousedown(_view, event) {
        const target = event.target
        if (!(target instanceof HTMLElement)) return false
        if (!target.closest('[data-md-math-preview="true"]')) return false
        event.preventDefault()
        return true
      },
      dblclick(view, event) {
        const target = event.target
        if (!(target instanceof HTMLElement)) return false
        const preview = target.closest<HTMLElement>('[data-md-math-preview="true"]')
        if (!preview) return false

        const from = Number(preview.dataset.mdMathFrom)
        const to = Number(preview.dataset.mdMathTo)
        const delimiterSize = Number(preview.dataset.mdMathDelimiter)
        if (!Number.isFinite(from) || !Number.isFinite(to) || !Number.isFinite(delimiterSize)) return false

        const innerFrom = Math.min(to, from + delimiterSize)
        const innerTo = Math.max(innerFrom, to - delimiterSize)
        view.dispatch(
          view.state.tr
            .setSelection(TextSelection.create(view.state.doc, innerFrom, innerTo))
            .scrollIntoView(),
        )
        view.focus()
        event.preventDefault()
        event.stopPropagation()
        return true
      },
    },
  },
})

const mathHighlight = $prose(() => mathProsePlugin)

// ── Local asset images ───────────────────────────────────────────────

// Global vault path reference (set by App.tsx on vault init)
let globalVaultPath: string | null = null
export function setEditorVaultPath(path: string | null) {
  globalVaultPath = path
}

function assetSrcForEditor(src: string) {
  const normalized = src.replace(/\\/g, '/').replace(/^\.\//, '')
  if (!normalized.startsWith('assets/')) return src
  if (globalVaultPath) {
    const absPath = `${globalVaultPath.replace(/\\/g, '/').replace(/\/$/, '')}/${normalized}`
    // On Windows, convert C:\... to https://asset.localhost/C:/...
    return `https://asset.localhost/${absPath}`
  }
  // Fallback — won't render asset but won't crash
  return src
}

const imageViewProsePlugin = new Plugin({
  props: {
    nodeViews: {
      image(node) {
        const dom = document.createElement('img')
        const updateDom = (imageNode: ProseNode) => {
          const src = String(imageNode.attrs.src ?? '')
          const alt = String(imageNode.attrs.alt ?? '')
          const title = imageNode.attrs.title ? String(imageNode.attrs.title) : ''
          dom.src = assetSrcForEditor(src)
          dom.alt = alt
          if (title) dom.title = title
          else dom.removeAttribute('title')
          dom.dataset.mdSrc = src
        }
        updateDom(node)
        return {
          dom,
          update(updatedNode) {
            if (updatedNode.type !== node.type) return false
            updateDom(updatedNode)
            return true
          },
        }
      },
    },
  },
})

const imageView = $prose(() => imageViewProsePlugin)

// ── Image paste/drop plugin ──────────────────────────────────────────
// Intercepts image paste from clipboard and image drop from filesystem
// at the ProseMirror level (before the Milkdown clipboard plugin),
// saving files to assets/ and inserting a live image node.

function insertImageAsset(
  view: {
    state: any
    dispatch: (tr: any) => void
    focus: () => void
  },
  relPath: string,
  range?: { from: number; to: number },
  addTrailingNewline = false,
) {
  const { state } = view
  const imageType = state.schema.nodes.image
  const markdown = `![](${relPath})${addTrailingNewline ? '\n' : ''}`

  if (!imageType) {
    const from = range?.from ?? state.selection.from
    const to = range?.to ?? state.selection.to
    view.dispatch(state.tr.insertText(markdown, from, to).scrollIntoView())
    view.focus()
    return
  }

  const imageNode = imageType.createAndFill({ src: relPath, alt: '', title: null })
    ?? imageType.create({ src: relPath, alt: '', title: null })
  const from = range?.from ?? state.selection.from
  const to = range?.to ?? state.selection.to
  let tr = state.tr.replaceWith(from, to, imageNode)
  let nextPos = from + imageNode.nodeSize
  if (addTrailingNewline) {
    tr = tr.insertText('\n', nextPos)
    nextPos += 1
  }
  nextPos = Math.min(nextPos, tr.doc.content.size)
  tr = tr.setSelection(TextSelection.near(tr.doc.resolve(nextPos)))
  view.dispatch(tr.scrollIntoView())
  view.focus()
}

function handleImagePaste(view: any, event: ClipboardEvent) {
  const editable = view.props.editable?.(view.state)
  if (editable === false) return false

  const items = event.clipboardData?.items
  if (!items) return false

  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    if (!item.type.startsWith('image/')) continue

    const blob = item.getAsFile()
    if (!blob) continue
    event.preventDefault()
    event.stopPropagation()
    const range = {
      from: view.state.selection.from,
      to: view.state.selection.to,
    }

    ;(async () => {
      try {
        const buffer = await blob.arrayBuffer()
        const ext = blob.type.split('/')[1] || 'png'
        const filename = `pasted-${Date.now()}.${ext}`
        const relPath = await window.mynote.assets.saveImage(buffer, filename)
        insertImageAsset(view, relPath, range)
      } catch (err) {
        console.error('Failed to save pasted image:', err)
      }
    })()

    return true
  }

  return false
}

function handleImageDrop(view: any, event: DragEvent) {
  const editable = view.props.editable?.(view.state)
  if (editable === false) return false

  const files = event.dataTransfer?.files
  if (!files || files.length === 0) return false

  const imageFiles = Array.from(files).filter((file) => file.type.startsWith('image/'))
  if (imageFiles.length === 0) return false

  event.preventDefault()
  event.stopPropagation()
  const dropPos = view.posAtCoords({ left: event.clientX, top: event.clientY })
  const firstRange = {
    from: dropPos?.pos ?? view.state.selection.from,
    to: dropPos?.pos ?? view.state.selection.from,
  }

  ;(async () => {
    for (const [index, file] of imageFiles.entries()) {
      try {
        const buffer = await file.arrayBuffer()
        const relPath = await window.mynote.assets.saveImage(buffer, file.name)
        insertImageAsset(view, relPath, index === 0 ? firstRange : undefined, true)
      } catch (err) {
        console.error('Failed to save dropped image:', err)
      }
    }
  })()

  return true
}

const imagePasteProsePlugin = new Plugin({
  props: {
    handlePaste(view, event) {
      return handleImagePaste(view, event)
    },

    handleDrop(view, event) {
      return handleImageDrop(view, event)
    },

    handleDOMEvents: {
      paste(view, event) {
        return handleImagePaste(view, event)
      },
      drop(view, event) {
        return handleImageDrop(view, event)
      },
      dragover(view, event) {
        if (event.dataTransfer?.types.includes('Files')) {
          event.preventDefault()
          event.dataTransfer.dropEffect = 'copy'
          return true
        }
        return false
      },
    },
  },
})

const imagePaste = $prose(() => imagePasteProsePlugin)

function normalizeClickedTag(text: string) {
  return text
    .trim()
    .replace(/^\\+/, '')
    .replace(/^[\[]?#/, '')
    .replace(/[\]]+$/g, '')
    .trim()
    .toLowerCase()
}

export default function MilkdownEditor({ content, onContentChange, onNavigate, onTagClick, readOnly = false }: MilkdownEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<Editor | null>(null)
  const tableActionLockRef = useRef(false)
  const initialized = useRef(false)
  const frontmatterRef = useRef('')
  const onNavigateRef = useRef(onNavigate)
  onNavigateRef.current = onNavigate
  const onTagClickRef = useRef(onTagClick)
  onTagClickRef.current = onTagClick
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
      .use(imageView)
      .use(imagePaste)
      .use(clipboard)
      .use(markdownIndent)
      .use(collapsibleList)
      .use(tagHighlight)
      .use(wikilinkHighlight)
      .use(mathHighlight)
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
      // Tag click: navigate to knowledge base with tag filter
      if (onTagClickRef.current) {
        const target = event.target
        if (target instanceof HTMLElement) {
          const tagEl = target.closest('.md-tag')
          if (tagEl) {
            const tagText = normalizeClickedTag(tagEl.textContent ?? '')
            if (tagText) {
              event.preventDefault()
              event.stopPropagation()
              onTagClickRef.current(tagText)
              return
            }
          }
        }
      }
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
