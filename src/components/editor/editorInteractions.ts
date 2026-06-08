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
  {
    id: 'link-to-page',
    label: '链接到页面',
    description: '',
    keywords: ['link', '链接', 'page', '页面', 'url'],
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

function parseCssNumber(value: string, fallback: number) {
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) ? parsed : fallback
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
  deleteRange(view, range)
  view.focus()

  switch (actionId) {
    case 'todo': {
      const { state, dispatch } = view
      const { schema } = state
      const { from, to, text } = getCurrentParagraph(view)
      const taskText = text || '待办事项'

      const taskNode = schema.nodes.bullet_list.create({}, [
        schema.nodes.list_item.create({ checked: false }, [
          paragraphNode(schema, taskText),
        ]),
      ])

      const tr = state.tr.replaceWith(from, to, taskNode)
      dispatch(tr.scrollIntoView())
      selectTextRange(view, from, taskText)
      return true
    }
    case 'toggle-list': {
      const { state, dispatch } = view
      const { schema } = state
      const { from, to, text } = getCurrentParagraph(view)
      const title = text || '折叠列表'

      const toggleNode = schema.nodes.bullet_list.create({}, [
        schema.nodes.list_item.create({}, [
          paragraphNode(schema, title),
          schema.nodes.bullet_list.create({}, [
            schema.nodes.list_item.create({}, [
              paragraphNode(schema, ''),
            ]),
          ]),
        ]),
      ])

      const tr = state.tr.replaceWith(from, to, toggleNode)
      dispatch(tr.scrollIntoView())
      selectTextRange(view, from, title)
      return true
    }
    case 'bullet-list':
      return callCommand(editor, wrapInBulletListCommand)
    case 'ordered-list':
      return callCommand(editor, wrapInOrderedListCommand)
    case 'code':
      return callCommand(editor, createCodeBlockCommand)
    case 'table':
      return callCommand(editor, insertTableCommand, { row: 3, col: 3 })
    case 'page': {
      // Insert wiki-style page reference: [[Page Name]]
      const { state, dispatch } = view
      const { from } = state.selection
      const tr = state.tr.insertText('[[Page Name]]', from)
      dispatch(tr.scrollIntoView())
      return true
    }
    case 'link-to-page': {
      // Insert markdown link to page: [Link Text](./page-name.md)
      const { state, dispatch } = view
      const { from } = state.selection
      const tr = state.tr.insertText('[Link Text](./page-name.md)', from)
      dispatch(tr.scrollIntoView())
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

export function handleCollapsibleListClick(event: MouseEvent) {
  const target = event.target
  if (!(target instanceof HTMLElement)) return false
  const item = target.closest<HTMLLIElement>('li')
  if (!item) return false
  if (!item.querySelector(':scope > ul, :scope > ol')) return false
  const rect = item.getBoundingClientRect()
  const before = window.getComputedStyle(item, '::before')
  const iconLeft = rect.left + parseCssNumber(before.left, -24)
  const iconWidth = parseCssNumber(before.width, 18)
  const iconTop = rect.top + parseCssNumber(before.top, 6)
  const iconHeight = parseCssNumber(before.height, 18)
  const inToggleX = event.clientX >= iconLeft - 6 && event.clientX <= iconLeft + iconWidth + 6
  const inToggleY = event.clientY >= iconTop - 6 && event.clientY <= iconTop + iconHeight + 6
  if (!inToggleX || !inToggleY) return false

  event.preventDefault()
  event.stopPropagation()

  item.classList.toggle('md-list-collapsed')
  return true
}
