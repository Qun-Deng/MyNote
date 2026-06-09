import type { Editor } from '@milkdown/kit/core'
import { commandsCtx, editorViewCtx } from '@milkdown/kit/core'
import {
  createCodeBlockCommand,
  liftListItemCommand,
  sinkListItemCommand,
  wrapInBulletListCommand,
  wrapInOrderedListCommand,
} from '@milkdown/kit/preset/commonmark'
import {
  addColAfterCommand,
  addColBeforeCommand,
  addRowAfterCommand,
  addRowBeforeCommand,
  insertTableCommand,
} from '@milkdown/kit/preset/gfm'
import { TextSelection } from '@milkdown/kit/prose/state'
import {
  CellSelection,
  cellAround,
  cellNear,
  deleteColumn,
  deleteRow,
} from '@milkdown/kit/prose/tables'
import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import type { EditorView } from '@milkdown/kit/prose/view'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'

// ── Wikilink navigation ──

const WIKILINK_REGEX = /\[\[([^\]|#]+)(?:[|#][^\]]+)?\]\]/g

export function handleWikilinkClick(
  editor: Editor,
  event: MouseEvent,
  onNavigate?: (path: string) => void,
): boolean {
  if (!onNavigate) return false
  const target = event.target
  if (!(target instanceof HTMLElement)) return false

  // Find the text node and position under click
  const view = editor.ctx.get(editorViewCtx)
  const pos = view.posAtCoords({ left: event.clientX, top: event.clientY })
  if (!pos) return false

  // Check if the clicked position is inside a wikilink
  const $pos = view.state.doc.resolve(pos.pos)
  const parentText = $pos.parent.textContent
  const offset = $pos.parentOffset

  // Search for wikilinks in the text node
  let match: RegExpExecArray | null
  WIKILINK_REGEX.lastIndex = 0
  while ((match = WIKILINK_REGEX.exec(parentText)) !== null) {
    const start = match.index
    const end = start + match[0].length
    if (offset >= start && offset <= end) {
      const pageName = match[1].trim()
      // Try to navigate — the callback handles resolution
      event.preventDefault()
      event.stopPropagation()
      onNavigate(pageName)
      return true
    }
  }
  return false
}

// Resolve a wikilink page name to a file path by searching the vault
export async function resolveWikilinkPath(pageName: string): Promise<string | null> {
  try {
    // Ask the backend to search for matching note
    const allNotes = await window.mynote.notes.list()
    const name = pageName.toLowerCase().replace(/\.md$/i, '')

    // Exact path match
    const exact = allNotes.find((n: any) =>
      n.path.toLowerCase() === pageName ||
      n.path.toLowerCase() === pageName + '.md' ||
      n.path.toLowerCase().replace(/\\/g, '/') === pageName.toLowerCase()
    )
    if (exact) return exact.path

    // Filename match
    const byName = allNotes.find((n: any) => {
      const fname = n.path.split('/').pop()?.replace(/\.md$/i, '')?.toLowerCase()
      return fname === name
    })
    if (byName) return byName.path

    // Partial match
    const partial = allNotes.find((n: any) =>
      n.path.toLowerCase().includes(name)
    )
    if (partial) return partial.path

    return null
  } catch {
    return null
  }
}

type CommandLike<T = unknown> = {
  key: unknown
  run?: (payload?: T) => boolean
}

export interface SlashRange {
  from: number
  to: number
}

export interface SlashTrigger extends SlashRange {
  query: string
  left: number
  top: number
}

export interface SlashAction {
  id: string
  label: string
  description: string
  keywords: string[]
}

export const slashActions: SlashAction[] = [
  {
    id: 'todo',
    label: '待办事项',
    description: '',
    keywords: ['todo', 'task', 'check', '待办', '任务', 'checkbox'],
  },
  {
    id: 'toggle-list',
    label: '折叠列表',
    description: '',
    keywords: ['collapsible', 'fold', 'toggle', '折叠', '展开', '收起', 'notion'],
  },
  {
    id: 'bullet-list',
    label: '无序列表',
    description: '',
    keywords: ['bullet', 'list', 'ul', '无序', '列表'],
  },
  {
    id: 'ordered-list',
    label: '有序列表',
    description: '',
    keywords: ['ordered', 'number', 'ol', '有序', '编号'],
  },
  {
    id: 'code',
    label: '代码块',
    description: '',
    keywords: ['code', 'pre', '代码'],
  },
  {
    id: 'table',
    label: '表格',
    description: '',
    keywords: ['table', 'grid', '表格'],
  },
  {
    id: 'page',
    label: '页面引用',
    description: '',
    keywords: ['page', '页面', 'wiki', '引用'],
  },
]

function getView(editor: Editor) {
  return editor.ctx.get(editorViewCtx)
}

function callCommand<T>(editor: Editor, command: CommandLike<T>, payload?: T) {
  const commands = editor.ctx.get(commandsCtx) as {
    call: (key: unknown, payload?: T) => boolean
  }
  return commands.call(command.key, payload)
}

function deleteRange(view: EditorView, range?: SlashRange) {
  if (!range) return
  if (range.from >= range.to) return
  view.dispatch(view.state.tr.delete(range.from, range.to).scrollIntoView())
}

function getCurrentParagraph(view: EditorView) {
  const { selection } = view.state
  const { $from } = selection
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const node = $from.node(depth)
    if (node.type.name !== 'paragraph') continue
    return {
      from: $from.before(depth),
      to: $from.after(depth),
      text: node.textContent.trim(),
    }
  }
  return {
    from: selection.from,
    to: selection.to,
    text: '',
  }
}

function paragraphNode(schema: EditorView['state']['schema'], text?: string) {
  const cleanText = text?.trim()
  return schema.nodes.paragraph.create(
    {},
    cleanText ? schema.text(cleanText) : undefined,
  )
}

function setSelectionNear(view: EditorView, pos: number) {
  const safePos = Math.max(1, Math.min(pos, view.state.doc.content.size))
  view.dispatch(
    view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(safePos))).scrollIntoView(),
  )
  view.focus()
}

function selectTextRange(view: EditorView, from: number, text: string) {
  try {
    const start = from + 3
    const end = start + text.length
    view.dispatch(
      view.state.tr.setSelection(TextSelection.create(view.state.doc, start, end)).scrollIntoView(),
    )
    view.focus()
  } catch {
    setSelectionNear(view, from + 3 + text.length)
  }
}

function findListItemPos(view: EditorView, listItem: HTMLLIElement): { pos: number; node: ProseNode } | null {
  let found: { pos: number; node: ProseNode } | null = null
  view.state.doc.descendants((node, pos) => {
    if (found || node.type.name !== 'list_item') return
    if (view.nodeDOM(pos) === listItem) {
      found = { pos, node }
    }
  })
  return found
}

function findTableCellPos(
  view: EditorView,
  cell: Element,
  coords?: { left: number; top: number },
) {
  try {
    const coordPos = coords ? view.posAtCoords(coords) : null
    const domPos = view.posAtDOM(cell, 0)
    const rawPos = coordPos?.inside && coordPos.inside > 0
      ? coordPos.inside
      : coordPos?.pos ?? domPos
    const $pos = view.state.doc.resolve(Math.min(rawPos, view.state.doc.content.size))
    return cellAround($pos) ?? cellNear($pos)
  } catch {
    return null
  }
}

export function getTableCellPosition(
  editor: Editor,
  target: HTMLElement,
  coords?: { left: number; top: number },
) {
  const cell = target.closest('td, th')
  if (!cell) return false
  const view = getView(editor)
  const $cell = findTableCellPos(view, cell, coords)
  return $cell?.pos ?? false
}

export function executeEditorAction(editor: Editor, actionId: string, range?: SlashRange) {
  const view = getView(editor)

  // For todo/toggle-list we capture paragraph state BEFORE deletion
  // so we can split at soft-newline boundaries.  Other actions just
  // delete the slash text immediately.
  if (actionId !== 'todo' && actionId !== 'toggle-list') {
    deleteRange(view, range)
    view.focus()
  }

  switch (actionId) {
    case 'todo':
    case 'toggle-list': {
      if (!range) return false

      // Capture paragraph state BEFORE deleting the slash trigger,
      // so we can split at soft-newline boundaries if needed.
      const paraBefore = getCurrentParagraph(view)
      const paraTextBefore = view.state.doc.textBetween(
        paraBefore.from + 1,
        paraBefore.to - 1,
      )
      // Find soft-newline boundaries around the slash within the paragraph
      const slashOffset = range.from - paraBefore.from - 1 // offset inside para text
      let lineStart = 0
      let lineEnd = paraTextBefore.length
      for (let i = slashOffset - 1; i >= 0; i -= 1) {
        if (paraTextBefore[i] === '\n') { lineStart = i + 1; break }
      }
      for (let i = slashOffset; i < paraTextBefore.length; i += 1) {
        if (paraTextBefore[i] === '\n') { lineEnd = i; break }
      }
      // Text before the slash line (exclude the \n that starts it)
      const beforeText = lineStart > 0
        ? paraTextBefore.slice(0, lineStart - 1)
        : ''
      // Text after the slash line (exclude the \n that ends it)
      const afterText = lineEnd < paraTextBefore.length
        ? paraTextBefore.slice(lineEnd + 1)
        : ''

      // Delete the slash trigger text
      deleteRange(view, range)
      view.focus()

      const { state, dispatch } = view
      const { schema } = state
      const { from, to } = getCurrentParagraph(view)

      const isTodo = actionId === 'todo'
      const defaultLabel = isTodo ? '待办事项' : '折叠列表'

      const createItem = () => {
        if (isTodo) {
          return schema.nodes.bullet_list.create({}, [
            schema.nodes.list_item.create({ checked: false }, [
              paragraphNode(schema, defaultLabel),
            ]),
          ])
        }
        return schema.nodes.bullet_list.create({}, [
          schema.nodes.list_item.create({}, [
            paragraphNode(schema, defaultLabel),
            schema.nodes.bullet_list.create({}, [
              schema.nodes.list_item.create({}, [
                paragraphNode(schema, ''),
              ]),
            ]),
          ]),
        ])
      }

      const hasAdjacentContent = beforeText.trim() || afterText.trim()

      if (hasAdjacentContent) {
        // Split the paragraph: keep beforeText / afterText as paragraphs,
        // insert the item where the slash line was.
        const parts: any[] = []
        if (beforeText.trim()) {
          parts.push(schema.nodes.paragraph.create({}, schema.text(beforeText.trim())))
        }
        parts.push(createItem())
        if (afterText.trim()) {
          parts.push(schema.nodes.paragraph.create({}, schema.text(afterText.trim())))
        }
        const tr = state.tr.replaceWith(from, to, parts)
        dispatch(tr.scrollIntoView())
        setSelectionNear(view, from + (beforeText.trim() ? 2 : 0) + 1)
      } else {
        // Entire paragraph was just the slash line — replace it.
        const item = createItem()
        const tr = state.tr.replaceWith(from, to, item)
        dispatch(tr.scrollIntoView())
        const label = defaultLabel
        try {
          const start = from + 3
          const end = start + label.length
          view.dispatch(
            view.state.tr
              .setSelection(TextSelection.create(view.state.doc, start, end))
              .scrollIntoView(),
          )
          view.focus()
        } catch {
          setSelectionNear(view, from + 3 + label.length)
        }
      }
      return true
    }
    case 'bullet-list':
    case 'ordered-list': {
      // Same paragraph-replacement strategy as todo/toggle-list
      // so the list replaces the current line, not the next one.
      if (!range) return false

      const paraBefore = getCurrentParagraph(view)
      const paraTextBefore = view.state.doc.textBetween(
        paraBefore.from + 1,
        paraBefore.to - 1,
      )
      const slashOffset = range.from - paraBefore.from - 1
      let lineStart = 0
      let lineEnd = paraTextBefore.length
      for (let i = slashOffset - 1; i >= 0; i -= 1) {
        if (paraTextBefore[i] === '\n') { lineStart = i + 1; break }
      }
      for (let i = slashOffset; i < paraTextBefore.length; i += 1) {
        if (paraTextBefore[i] === '\n') { lineEnd = i; break }
      }
      const beforeText = lineStart > 0
        ? paraTextBefore.slice(0, lineStart - 1)
        : ''
      const afterText = lineEnd < paraTextBefore.length
        ? paraTextBefore.slice(lineEnd + 1)
        : ''

      deleteRange(view, range)
      view.focus()

      const { state, dispatch } = view
      const { schema } = state
      const { from, to } = getCurrentParagraph(view)

      const listNodeType = actionId === 'bullet-list'
        ? schema.nodes.bullet_list
        : schema.nodes.ordered_list
      const label = beforeText.trim() || afterText.trim() || ''

      const item = listNodeType.create({}, [
        schema.nodes.list_item.create({}, [
          paragraphNode(schema, label),
        ]),
      ])

      const hasAdjacent = beforeText.trim() && afterText.trim()

      if (hasAdjacent) {
        const parts: any[] = []
        parts.push(schema.nodes.paragraph.create({}, schema.text(beforeText.trim())))
        parts.push(item)
        parts.push(schema.nodes.paragraph.create({}, schema.text(afterText.trim())))
        dispatch(state.tr.replaceWith(from, to, parts).scrollIntoView())
        setSelectionNear(view, from + 2)
      } else if (beforeText.trim() || afterText.trim()) {
        const parts: any[] = []
        parts.push(item)
        const other = beforeText.trim() || afterText.trim()
        if (other) {
          parts.push(schema.nodes.paragraph.create({}, schema.text(other)))
        }
        dispatch(state.tr.replaceWith(from, to, parts).scrollIntoView())
        // Select the label text so user can overwrite it
        view.dispatch(
          view.state.tr
            .setSelection(TextSelection.create(view.state.doc, from + 2, from + 2 + label.length))
            .scrollIntoView(),
        )
        view.focus()
      } else {
        dispatch(state.tr.replaceWith(from, to, item).scrollIntoView())
        setSelectionNear(view, from + 2)
      }
      return true
    }
    case 'code':
      return callCommand(editor, createCodeBlockCommand)
    case 'table':
      return callCommand(editor, insertTableCommand, { row: 3, col: 3 })
    case 'page': {
      // Insert wiki-style page reference: [[Page Name]]
      const { state, dispatch } = view
      const { from } = state.selection
      const text = 'Page Name'
      const tr = state.tr.insertText(`[[${text}]]`, from)
      dispatch(tr.scrollIntoView())
      // Select the placeholder text so user can type immediately
      selectTextRange(view, from, text)
      return true
    }
    default:
      return false
  }
}

export type TableActionId =
  | 'insert-row-before'
  | 'insert-row-after'
  | 'delete-row'
  | 'insert-column-before'
  | 'insert-column-after'
  | 'delete-column'

export function executeTableAction(editor: Editor, actionId: TableActionId, cellPos?: number | null) {
  const view = getView(editor)
  if (typeof cellPos === 'number') {
    try {
      view.dispatch(
        view.state.tr.setSelection(CellSelection.create(view.state.doc, cellPos)),
      )
    } catch {
      // Fall back to the current selection if the table changed before the command runs.
    }
  }
  view.focus()

  switch (actionId) {
    case 'insert-row-before':
      return callCommand(editor, addRowBeforeCommand)
    case 'insert-row-after':
      return callCommand(editor, addRowAfterCommand)
    case 'insert-column-before':
      return callCommand(editor, addColBeforeCommand)
    case 'insert-column-after':
      return callCommand(editor, addColAfterCommand)
    case 'delete-row':
      return deleteRow(view.state, (tr) => view.dispatch(tr))
    case 'delete-column':
      return deleteColumn(view.state, (tr) => view.dispatch(tr))
  }
}

export function moveSelectionToTableCell(
  editor: Editor,
  target: HTMLElement,
  coords?: { left: number; top: number },
) {
  const cellPos = getTableCellPosition(editor, target, coords)
  if (cellPos === false) return false
  const view = getView(editor)
  view.dispatch(view.state.tr.setSelection(CellSelection.create(view.state.doc, cellPos)))
  return cellPos
}

export function handleTableCellMouseDown(editor: Editor, event: MouseEvent) {
  if (event.button !== 0 || event.shiftKey || event.metaKey || event.ctrlKey || event.altKey) return false

  const target = event.target
  if (!(target instanceof HTMLElement)) return false
  const anchorCell = target.closest('td, th')
  if (!anchorCell) return false

  const view = getView(editor)
  const $anchor = findTableCellPos(view, anchorCell, {
    left: event.clientX,
    top: event.clientY,
  })
  if (!$anchor) return false

  const startX = event.clientX
  const startY = event.clientY
  let selectingCells = false

  const cleanup = () => {
    document.removeEventListener('mousemove', handleMouseMove)
    document.removeEventListener('mouseup', cleanup)
  }

  const handleMouseMove = (moveEvent: MouseEvent) => {
    if ((moveEvent.buttons & 1) !== 1) {
      cleanup()
      return
    }

    const distance = Math.abs(moveEvent.clientX - startX) + Math.abs(moveEvent.clientY - startY)
    if (!selectingCells && distance < 4) return

    const headTarget = document.elementFromPoint(moveEvent.clientX, moveEvent.clientY)
    const headCell = headTarget instanceof HTMLElement
      ? headTarget.closest('td, th')
      : null
    if (!headCell) return

    const $head = findTableCellPos(view, headCell, {
      left: moveEvent.clientX,
      top: moveEvent.clientY,
    })
    if (!$head) return
    if (!selectingCells && $head.pos === $anchor.pos) return

    selectingCells = true
    moveEvent.preventDefault()
    view.dispatch(
      view.state.tr
        .setSelection(CellSelection.create(view.state.doc, $anchor.pos, $head.pos))
        .scrollIntoView(),
    )
    view.focus()
  }

  document.addEventListener('mousemove', handleMouseMove)
  document.addEventListener('mouseup', cleanup, { once: true })
  return true
}

export function handleEditorShortcut(editor: Editor, event: KeyboardEvent | ReactKeyboardEvent) {
  // Tab / Shift+Tab: indent / outdent list items
  if (event.key === 'Tab') {
    const command = event.shiftKey ? liftListItemCommand : sinkListItemCommand
    const handled = callCommand(editor, command)
    if (handled) {
      event.preventDefault()
      event.stopPropagation()
    }
    if (handled) return true

    const view = getView(editor)
    const { state, dispatch } = view
    const { from, to, empty } = state.selection

    if (event.shiftKey) {
      if (empty) {
        const $from = state.selection.$from
        const offset = $from.parentOffset
        const textBefore = $from.parent.textBetween(Math.max(0, offset - 2), offset)
        if (textBefore === '  ') {
          dispatch(state.tr.delete(from - 2, from).scrollIntoView())
        }
      }
      event.preventDefault()
      event.stopPropagation()
      return true
    }

    dispatch(state.tr.insertText('  ', from, to).scrollIntoView())
    event.preventDefault()
    event.stopPropagation()
    return true
  }

  return false
}

export function getSlashTrigger(editor: Editor, container: HTMLElement): SlashTrigger | null {
  const view = getView(editor)
  const { selection } = view.state
  if (!selection.empty) return null

  const { $from } = selection
  const textBeforeCursor = $from.parent.textBetween(0, $from.parentOffset, '\n', '\n')
  const match = textBeforeCursor.match(/(?:^|\s)\/([\p{L}\p{N}_-]*)$/u)
  if (!match) return null

  const query = match[1] ?? ''
  const from = selection.from - query.length - 1
  const coords = view.coordsAtPos(selection.from)

  // Position relative to the shell element (which has position: relative)
  const shell = container.parentElement
  const shellRect = shell?.getBoundingClientRect() ?? { left: 0, top: 0 }

  return {
    from,
    to: selection.from,
    query,
    left: coords.left - shellRect.left,
    top: coords.bottom - shellRect.top + 6,
  }
}

export function filterSlashActions(query: string) {
  const normalized = query.trim().toLowerCase()
  if (!normalized) return slashActions

  return slashActions.filter((action) => {
    return [action.label, action.description, ...action.keywords]
      .join(' ')
      .toLowerCase()
      .includes(normalized)
  })
}

export function handleTaskItemClick(editor: Editor, event: MouseEvent) {
  const target = event.target
  if (!(target instanceof HTMLElement)) return false
  const item = target.closest<HTMLLIElement>('li[data-item-type="task"]')
  if (!item) return false
  const rect = item.getBoundingClientRect()
  if (event.clientX > rect.left + 28) return false
  const view = getView(editor)
  const found = findListItemPos(view, item)
  if (!found) return true

  event.preventDefault()
  event.stopPropagation()

  const checked = !found.node.attrs.checked
  view.dispatch(
    view.state.tr.setNodeMarkup(found.pos, undefined, {
      ...found.node.attrs,
      checked,
    }).scrollIntoView(),
  )
  return true
}

