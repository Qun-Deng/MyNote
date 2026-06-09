import { useState, useEffect, useRef, useCallback } from 'react'
import {
  format, startOfMonth, endOfMonth, startOfWeek, endOfWeek, addDays,
  isSameMonth, isSameDay, isToday,
} from 'date-fns'
import { ChevronLeft, ChevronRight, Clock, Plus, Trash2, FileText } from 'lucide-react'
import { useNoteStore } from '../../stores/noteStore'
import { useUIStore } from '../../stores/uiStore'
import { useVaultStore } from '../../stores/vaultStore'

// ====== Time Block Parse ======

interface TimeBlock {
  startTime: string   // HH:MM
  endTime: string | null
  text: string
  raw: string          // original line in markdown
}

/* Supported formats:
   [13:07-15:07] test
   [13:07] test
   - 13:07-15:07 test
   13:07-15:07 test
*/
function parseTimeBlocks(markdown: string): TimeBlock[] {
  // Strip Milkdown backslash-escaped brackets before parsing.
  // Milkdown escapes [ as \[ in saved markdown, which would break regex matching.
  const clean = markdown.replace(/\\([[\]])/g, '$1')
  const lines = clean.split('\n')
  const blocks: TimeBlock[] = []
  for (const line of lines) {
    const t = line.trim()

    // [HH:MM-HH:MM] text
    let m = t.match(/^\[(\d{1,2}:\d{2})(?:-(\d{1,2}:\d{2}))?\]\s+(.+)$/)
    if (m) {
      blocks.push({ startTime: norm(m[1]), endTime: m[2] ? norm(m[2]) : null, text: m[3], raw: t })
      continue
    }
    // - HH:MM-HH:MM text
    m = t.match(/^[-*+]\s+(\d{1,2}:\d{2})(?:-(\d{1,2}:\d{2}))?\s+(.+)$/)
    if (m) {
      blocks.push({ startTime: norm(m[1]), endTime: m[2] ? norm(m[2]) : null, text: m[3], raw: t })
      continue
    }
    // HH:MM-HH:MM text
    m = t.match(/^(\d{1,2}:\d{2})-(\d{1,2}:\d{2})\s+(.+)$/)
    if (m) {
      blocks.push({ startTime: norm(m[1]), endTime: norm(m[2]), text: m[3], raw: t })
    }
  }
  blocks.sort((a, b) => a.startTime.localeCompare(b.startTime))
  return blocks
}

function norm(t: string) { const [h, m] = t.split(':'); return `${h.padStart(2, '0')}:${m}` }
function timeToMin(t: string) { const [h, m] = t.split(':').map(Number); return h * 60 + m }
function fmtRange(s: string, e: string | null) { return e ? `${s} - ${e}` : s }

function insertBlockIntoContent(content: string, blockLine: string): string {
  // Match ## [今日记录] header with optional Milkdown backslash escapes on brackets.
  // Milkdown escapes [ → \[ and ] → \], so the header can be:
  //   ## [今日记录]   or   ## \[今日记录\]   or   ## \[今日记录]
  const headerRe = /^##\s*\\?\[今日记录\\?\]/m
  const headerMatch = content.match(headerRe)
  if (headerMatch) {
    // Found — append block at end of section, before next ## heading (or EOF).
    const headerLineEnd = content.indexOf('\n', headerMatch.index!)
    const afterHeader = headerLineEnd === -1 ? content.length : headerLineEnd + 1
    const rest = content.slice(afterHeader)
    const nextHeading = rest.search(/^##\s/m)
    if (nextHeading >= 0) {
      let pos = afterHeader + nextHeading
      while (pos > afterHeader && content[pos - 1] === '\n') pos--
      return content.slice(0, pos) + '\n\n' + blockLine + '\n\n' + content.slice(afterHeader + nextHeading)
    } else {
      return content.replace(/\n*$/, '\n' + blockLine + '\n')
    }
  }

  // 2. No [今日记录] — try to find the title (# ...) and insert after it
  const titleMatch = content.match(/^#\s+.+$/m)
  if (titleMatch) {
    const titleLineEnd = content.indexOf('\n', titleMatch.index!)
    let idx = titleLineEnd === -1 ? content.length : titleLineEnd + 1
    if (content[idx] === '\n') idx++
    return content.slice(0, idx) + '## [今日记录]\n\n' + blockLine + '\n\n' + content.slice(idx)
  }

  // 3. No title either — try to insert after frontmatter
  const fmEnd = content.indexOf('---\n', 3)
  if (fmEnd > -1) {
    const insertAt = content.indexOf('\n', fmEnd + 4)
    return content.slice(0, insertAt + 1) + '## [今日记录]\n\n' + blockLine + '\n\n' + content.slice(insertAt + 1)
  }

  // 4. No structure at all — just append
  return content + '\n## [今日记录]\n' + blockLine + '\n'
}

function buildDiaryTemplate(date: string): string {
  const d = new Date(date)
  const dateStr = format(d, 'yyyy年M月d日')
  const weekdays = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六']
  const weekday = weekdays[d.getDay()]
  const isoDate = format(d, 'yyyy-MM-dd')
  return `---
date: ${isoDate}
tags: [diary]
---

# ${dateStr} ${weekday}

## [待办事项]

## [想法记录]
`
}

// ====== Const ======

const START_HOUR = 6
const END_HOUR = 24
const TOTAL_MIN = (END_HOUR - START_HOUR) * 60    // 1080
const HOUR_HEIGHT = 64   // px per hour
const TOTAL_HEIGHT = (END_HOUR - START_HOUR) * HOUR_HEIGHT

const hours: number[] = []
for (let h = START_HOUR; h <= END_HOUR; h++) hours.push(h)

// ====== Component ======

export default function DiaryView() {
  const today = format(new Date(), 'yyyy-MM-dd')
  const [currentMonth, setCurrentMonth] = useState(new Date())
  const [selectedDate, setSelectedDate] = useState(today)
  const [diaryDates, setDiaryDates] = useState<Set<string>>(new Set())
  const [diaryContent, setDiaryContent] = useState('')
  const [diaryPath, setDiaryPath] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [showAdd, setShowAdd] = useState(false)
  const [newStart, setNewStart] = useState('')
  const [newEnd, setNewEnd] = useState('')
  const [newText, setNewText] = useState('')

  // Resize state
  const [resizing, setResizing] = useState<{
    blockIdx: number
    edge: 'top' | 'bottom'
    startY: number
    initialStartMin: number
    initialEndMin: number
  } | null>(null)
  const [resizePreview, setResizePreview] = useState<{ startMin: number; endMin: number } | null>(null)
  const timelineRef = useRef<HTMLDivElement>(null)
  const MIN_DURATION = 10

  // DDL items
  const [ddlItems, setDdlItems] = useState<any[]>([])
  const [addingDdl, setAddingDdl] = useState(false)
  const [newDdlContent, setNewDdlContent] = useState('')
  const [newDdlDeadline, setNewDdlDeadline] = useState('')

  const loadDDL = async () => {
    try {
      const all = await window.mynote.ddl.list()
      all.sort((a: any, b: any) => a.deadline.localeCompare(b.deadline))
      setDdlItems(all)
    } catch { setDdlItems([]) }
  }

  useEffect(() => { loadDDL() }, [selectedDate])

  const handleDdlAdd = async () => {
    if (!newDdlContent.trim() || !newDdlDeadline) return
    await window.mynote.ddl.add(newDdlContent.trim(), newDdlDeadline)
    setNewDdlContent('')
    setNewDdlDeadline('')
    setAddingDdl(false)
    loadDDL()
  }

  const handleDdlDelete = async (id: string) => {
    await window.mynote.ddl.delete(id)
    loadDDL()
  }

  const openNote = useNoteStore((s) => s.openNote)
  const setOpenNotePath = useUIStore((s) => s.setOpenNotePath)
  const refreshTree = useVaultStore((s) => s.refreshTree)

  // Month diary dots
  useEffect(() => {
    const load = async () => {
      try {
        const entries = await window.mynote.diary.getMonth(
          currentMonth.getFullYear(), currentMonth.getMonth() + 1
        )
        setDiaryDates(new Set(entries.filter((e: any) => e.hasEntry).map((e: any) => e.date)))
      } catch {}
    }
    load()
  }, [currentMonth])

  // Load selected-date diary (auto-create)
  useEffect(() => {
    let cancelled = false
    // Immediately clear old content to prevent date bleed
    setDiaryContent('')
    setDiaryPath(null)
    setLoading(true)
    const load = async () => {
      try {
        let diary = await window.mynote.diary.get(selectedDate)
        const isNew = !diary
        if (!diary) {
          diary = await window.mynote.diary.create(selectedDate)
          refreshTree()
        }
        // Sync todoPage items into diary's [待办事项] section
        if (isNew || selectedDate === today) {
          try { await window.mynote.diary.syncFromPage(selectedDate) } catch {}
        }
        const result = await window.mynote.notes.read(diary.path)
        if (!cancelled) {
          if (result) {
            setDiaryContent(result.content)
            setDiaryPath(result.meta.path)
            setDiaryDates((prev) => new Set(prev).add(selectedDate))
          } else {
            // File was deleted externally, recreate
            diary = await window.mynote.diary.create(selectedDate)
            refreshTree()
            const retry = await window.mynote.notes.read(diary.path)
            if (retry) {
              setDiaryContent(retry.content)
              setDiaryPath(retry.meta.path)
            }
          }
        }
      } catch {} finally { if (!cancelled) setLoading(false) }
    }
    load()
    return () => { cancelled = true }
  }, [selectedDate])

  // ---- Calendar ----
  const monthStart = startOfMonth(currentMonth)
  const monthEnd = endOfMonth(currentMonth)
  const calStart = startOfWeek(monthStart, { weekStartsOn: 1 })
  const calEnd = endOfWeek(monthEnd, { weekStartsOn: 1 })
  const weeks: Date[][] = []
  let d = calStart
  while (d <= calEnd) {
    const week: Date[] = []
    for (let i = 0; i < 7; i++) { week.push(d); d = addDays(d, 1) }
    weeks.push(week)
  }

  // ---- Timeline ----
  const blocks = parseTimeBlocks(diaryContent)

  const handleAddBlock = async () => {
    if (!newStart || !newText) return
    // Auto-create diary if needed
    let path = diaryPath
    let content = diaryContent
    if (!path) {
      const diary = await window.mynote.diary.create(selectedDate)
      path = diary.path
      refreshTree()
      // Read the actual template content; fall back to building it ourselves
      const result = await window.mynote.notes.read(diary.path)
      content = result?.content || buildDiaryTemplate(selectedDate)
      setDiaryPath(path)
      setDiaryDates((prev) => new Set(prev).add(selectedDate))
    }
    const endStr = newEnd ? `-${newEnd}` : ''
    const line = `[${newStart}${endStr}] ${newText}`
    const newContent = insertBlockIntoContent(content, line)
    await window.mynote.notes.write(path!, newContent)
    setDiaryContent(newContent)
    setNewStart(''); setNewEnd(''); setNewText(''); setShowAdd(false)
  }

  const handleDeleteBlock = async (block: TimeBlock) => {
    if (!diaryPath) return
    const stripEscapes = (s: string) => s.replace(/\\([[\]])/g, '$1').trim()
    const target = stripEscapes(block.raw)
    const lines = diaryContent.split('\n')
    const idx = lines.findIndex((l) => stripEscapes(l) === target)
    if (idx > -1) {
      lines.splice(idx, 1)
      const nc = lines.join('\n')
      await window.mynote.notes.write(diaryPath, nc)
      setDiaryContent(nc)
    }
  }

  const updateBlockEndTime = async (block: TimeBlock, newEndMin: number) => {
    if (!diaryPath) return
    const newEnd = `${String(Math.floor(newEndMin / 60)).padStart(2, '0')}:${String(newEndMin % 60).padStart(2, '0')}`
    // Replace end time in [HH:MM-HH:MM] or add end time to [HH:MM]
    const newLine = block.raw.replace(
      /\[(\d{1,2}:\d{2})(?:-(\d{1,2}:\d{2}))?\]/,
      `[$1-${newEnd}]`
    )
    if (newLine === block.raw) return
    await replaceBlockLine(block, newLine)
  }

  const updateBlockStartTime = async (block: TimeBlock, newStartMin: number) => {
    if (!diaryPath) return
    const newStart = `${String(Math.floor(newStartMin / 60)).padStart(2, '0')}:${String(newStartMin % 60).padStart(2, '0')}`
    const oldEnd = block.endTime || `${String(Math.floor((timeToMin(block.startTime) + 60) / 60)).padStart(2, '0')}:${String((timeToMin(block.startTime) + 60) % 60).padStart(2, '0')}`
    const newLine = block.raw.replace(
      /\[(\d{1,2}:\d{2})(?:-(\d{1,2}:\d{2}))?\]/,
      `[${newStart}-${oldEnd}]`
    )
    if (newLine === block.raw) return
    await replaceBlockLine(block, newLine)
  }

  const replaceBlockLine = async (block: TimeBlock, newLine: string) => {
    if (!diaryPath) return
    const stripEscapes = (s: string) => s.replace(/\\([[\]])/g, '$1').trim()
    const target = stripEscapes(block.raw)
    const lines = diaryContent.split('\n')
    const idx = lines.findIndex((l) => stripEscapes(l) === target)
    if (idx > -1) {
      lines[idx] = newLine
      const nc = lines.join('\n')
      await window.mynote.notes.write(diaryPath, nc)
      setDiaryContent(nc)
    }
  }

  // ── Resize handlers (delta-based, no dead zone) ──

  const handleResizeStart = useCallback((e: React.MouseEvent, blockIdx: number, edge: 'top' | 'bottom', block: TimeBlock) => {
    e.preventDefault()
    e.stopPropagation()
    const startMin = timeToMin(block.startTime)
    const endMin = block.endTime ? timeToMin(block.endTime) : startMin + 60
    setResizing({ blockIdx, edge, startY: e.clientY, initialStartMin: startMin, initialEndMin: endMin })
    setResizePreview({ startMin, endMin })
  }, [])

  useEffect(() => {
    if (!resizing) return

    const handleMouseMove = (e: MouseEvent) => {
      const deltaY = e.clientY - resizing.startY
      const deltaMin = (deltaY / TOTAL_HEIGHT) * TOTAL_MIN
      const snappedDelta = Math.round(deltaMin / 10) * 10 // 10-min snap

      if (resizing.edge === 'bottom') {
        let newEnd = resizing.initialEndMin + snappedDelta
        newEnd = Math.max(newEnd, resizing.initialStartMin + MIN_DURATION)
        newEnd = Math.min(newEnd, END_HOUR * 60)
        setResizePreview({ startMin: resizing.initialStartMin, endMin: newEnd })
      } else {
        let newStart = resizing.initialStartMin + snappedDelta
        newStart = Math.min(newStart, resizing.initialEndMin - MIN_DURATION)
        newStart = Math.max(newStart, START_HOUR * 60)
        setResizePreview({ startMin: newStart, endMin: resizing.initialEndMin })
      }
    }

    const handleMouseUp = async () => {
      if (!resizePreview) { setResizing(null); setResizePreview(null); return }
      const block = blocks[resizing.blockIdx]
      if (block) {
        if (resizing.edge === 'bottom' && resizePreview.endMin !== resizing.initialEndMin) {
          await updateBlockEndTime(block, resizePreview.endMin)
        } else if (resizing.edge === 'top' && resizePreview.startMin !== resizing.initialStartMin) {
          await updateBlockStartTime(block, resizePreview.startMin)
        }
      }
      setResizing(null)
      setResizePreview(null)
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [resizing, resizePreview, blocks, diaryPath])

  const handleEditDiary = async () => {
    if (diaryPath) {
      const opened = await openNote(diaryPath)
      if (opened) setOpenNotePath(diaryPath)
    }
  }

  // Click date → auto-create + open editor
  const goPrevDay = () => {
    const prev = format(addDays(new Date(selectedDate), -1), 'yyyy-MM-dd')
    setSelectedDate(prev)
  }
  const goNextDay = () => {
    const next = format(addDays(new Date(selectedDate), 1), 'yyyy-MM-dd')
    setSelectedDate(next)
  }

  const handleSelectDate = async (ds: string) => {
    setSelectedDate(ds)
    try {
      let diary = await window.mynote.diary.get(ds)
      if (!diary) {
        diary = await window.mynote.diary.create(ds)
        refreshTree()
      }
      if (diary) {
        const opened = await openNote(diary.path)
        if (opened) setOpenNotePath(diary.path)
      }
    } catch {}
  }

  const dateLabel = format(new Date(selectedDate), 'M月d日 EEEE')

  // ---- Render ----
  return (
    <div className="h-full grid grid-cols-2">
      {/* ====== LEFT: Calendar ====== */}
      <div className="border-r border-surface-200 p-5 overflow-auto flex flex-col">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold text-surface-900">
            {format(currentMonth, 'yyyy年M月')}
          </h2>
          <div className="flex gap-0.5">
            <button onClick={() => setCurrentMonth(addDays(monthStart, -1))}
              className="p-1 hover:bg-surface-100 rounded transition-colors">
              <ChevronLeft className="w-4 h-4 text-surface-500" />
            </button>
            <button onClick={() => setCurrentMonth(addDays(monthEnd, 1))}
              className="p-1 hover:bg-surface-100 rounded transition-colors">
              <ChevronRight className="w-4 h-4 text-surface-500" />
            </button>
          </div>
        </div>

        <div className="calendar-grid flex-shrink-0">
          {['一','二','三','四','五','六','日'].map(h => <div key={h} className="calendar-day-header">{h}</div>)}
          {weeks.map((week, wi) =>
            week.map((day, di) => {
              const ds = format(day, 'yyyy-MM-dd')
              const sel = ds === selectedDate
              return (
                <button key={`${wi}-${di}`} onClick={() => handleSelectDate(ds)}
                  className={`calendar-day ${!isSameMonth(day, currentMonth) ? 'other-month' : ''} ${
                    isToday(day) ? 'today' : ''} ${diaryDates.has(ds) ? 'has-entry' : ''} ${
                    sel ? '!bg-accent-500 !text-white font-semibold' : ''}`}>
                  {format(day, 'd')}
                </button>
              )
            })
          )}
        </div>

        {/* DDL — deadline items */}
        <div className="mt-5 pt-4 border-t border-surface-150 flex-1 overflow-auto flex flex-col">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-xs font-medium text-surface-500 uppercase tracking-wider">
              DDL
              <span className="ml-1 text-surface-400">({ddlItems.length})</span>
            </h3>
            <button
              onClick={() => { setAddingDdl(!addingDdl); setNewDdlContent(''); setNewDdlDeadline('') }}
              className="p-0.5 hover:bg-surface-100 rounded transition-colors"
              title="添加DDL"
            >
              <Plus className="w-3.5 h-3.5 text-surface-400" />
            </button>
          </div>

          {/* Add form */}
          {addingDdl && (
            <div className="mb-2 p-2 rounded border border-accent-200 bg-accent-50/50 space-y-1.5">
              <input
                type="text"
                value={newDdlContent}
                onChange={e => setNewDdlContent(e.target.value)}
                placeholder="事项内容..."
                className="w-full text-xs px-2 py-1 rounded border border-surface-200 outline-none focus:border-accent-400"
                autoFocus
                onKeyDown={e => { if (e.key === 'Enter') handleDdlAdd(); if (e.key === 'Escape') setAddingDdl(false) }}
              />
              <div className="flex items-center gap-2">
                <input
                  type="date"
                  value={newDdlDeadline}
                  onChange={e => setNewDdlDeadline(e.target.value)}
                  className="flex-1 text-xs px-2 py-1 rounded border border-surface-200 outline-none focus:border-accent-400"
                />
                <button
                  onClick={handleDdlAdd}
                  disabled={!newDdlContent.trim() || !newDdlDeadline}
                  className="text-xs bg-accent-500 text-white px-2.5 py-1 rounded font-medium hover:bg-accent-600 disabled:opacity-50"
                >
                  确认
                </button>
                <button onClick={() => setAddingDdl(false)} className="text-xs text-surface-400 hover:text-surface-600">
                  取消
                </button>
              </div>
            </div>
          )}

          {ddlItems.length === 0 && !addingDdl ? (
            <p className="text-xs text-surface-400">暂无截止事项</p>
          ) : (
            <div className="space-y-1">
              {ddlItems.map((item: any) => {
                const deadlineDate = new Date(item.deadline)
                const todayDate = new Date(format(new Date(), 'yyyy-MM-dd'))
                const daysLeft = Math.ceil((deadlineDate.getTime() - todayDate.getTime()) / 86400000)
                const overdue = daysLeft < 0
                return (
                  <div
                    key={item.id}
                    className="group px-3 py-2.5 rounded-lg border border-surface-200 bg-white hover:shadow-sm transition-shadow"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-sm text-surface-800 font-medium truncate flex-1">{item.content}</span>
                      <span className={`flex-shrink-0 text-xs font-medium px-2 py-0.5 rounded-full ${
                        overdue
                          ? 'bg-red-100 text-red-600'
                          : daysLeft <= 3
                            ? 'bg-amber-100 text-amber-700'
                            : 'bg-emerald-100 text-emerald-700'
                      }`}>
                        {overdue ? `逾期${Math.abs(daysLeft)}天` : `剩${daysLeft}天`}
                      </span>
                    </div>
                    <div className="flex items-center justify-between mt-1">
                      <p className="text-xs text-surface-400">📅 {item.deadline}</p>
                      <button
                        onClick={() => handleDdlDelete(item.id)}
                        className="opacity-0 group-hover:opacity-100 p-1 hover:bg-red-50 rounded transition-all"
                        title="删除"
                      >
                        <Trash2 className="w-3 h-3 text-red-400" />
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* ====== RIGHT: Timeline ====== */}
      <div className="flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-3 border-b border-surface-200 flex-shrink-0">
          <div className="flex items-center gap-2">
            <button onClick={goPrevDay} className="p-0.5 hover:bg-surface-100 rounded transition-colors">
              <ChevronLeft className="w-4 h-4 text-surface-500" />
            </button>
            <h2 className="text-base font-semibold text-surface-900">
              {dateLabel}
              {selectedDate === today && <span className="text-xs text-accent-500 font-normal ml-2">今天</span>}
            </h2>
            <button onClick={goNextDay} className="p-0.5 hover:bg-surface-100 rounded transition-colors">
              <ChevronRight className="w-4 h-4 text-surface-500" />
            </button>
          </div>
          <div className="flex gap-2">
            <button onClick={() => setShowAdd(!showAdd)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-accent-600
                         bg-accent-50 hover:bg-accent-100 rounded-md transition-colors">
              <Plus className="w-3.5 h-3.5" />添加时间块
            </button>
            <button onClick={handleEditDiary}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-surface-600
                         bg-surface-100 hover:bg-surface-200 rounded-md transition-colors">
              <FileText className="w-3.5 h-3.5" />编辑日记
            </button>
          </div>
        </div>

        {/* Add form */}
        {showAdd && (
          <div className="px-6 py-3 border-b border-surface-200 bg-surface-50 flex-shrink-0">
            <div className="flex items-center gap-2">
              <input type="time" value={newStart} onChange={e => setNewStart(e.target.value)}
                className="px-2 py-1.5 text-sm border border-surface-300 rounded-md outline-none focus:border-accent-400 w-32" />
              <span className="text-surface-400 text-sm">-</span>
              <input type="time" value={newEnd} onChange={e => setNewEnd(e.target.value)}
                className="px-2 py-1.5 text-sm border border-surface-300 rounded-md outline-none focus:border-accent-400 w-32" />
              <input type="text" value={newText} onChange={e => setNewText(e.target.value)} placeholder="做了什么..."
                className="flex-1 min-w-0 px-3 py-1.5 text-sm border border-surface-300 rounded-md outline-none focus:border-accent-400"
                onKeyDown={e => { if (e.key === 'Enter') handleAddBlock() }} />
              <button onClick={handleAddBlock} disabled={!newStart || !newText}
                className="px-4 py-1.5 text-sm bg-accent-600 text-white rounded-md hover:bg-accent-700 disabled:opacity-40 transition-colors whitespace-nowrap">
                添加
              </button>
            </div>
          </div>
        )}

        {/* Timeline */}
        <div className="flex-1 overflow-auto">
          {loading ? (
            <div className="flex items-center justify-center h-full text-surface-400 text-sm">加载中...</div>
          ) : blocks.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-surface-400">
              <Clock className="w-12 h-12 text-surface-200 mb-3" />
              <p className="text-sm">该日暂无时间记录</p>
            </div>
          ) : (
            <div ref={timelineRef} className="relative mx-6 my-6" style={{ height: TOTAL_HEIGHT }}>
              {/* Hour grid lines */}
              {hours.map((hour) => {
                const y = ((hour - START_HOUR) / (END_HOUR - START_HOUR)) * TOTAL_HEIGHT
                return (
                  <div key={hour}>
                    <span
                      className="absolute left-0 w-14 -translate-y-1/2 text-right text-[11px] text-surface-400 pr-3 select-none"
                      style={{ top: y }}
                    >
                      {String(hour).padStart(2, '0')}:00
                    </span>
                    <div
                      className="absolute left-14 right-0 h-px bg-surface-200"
                      style={{ top: y }}
                    />
                  </div>
                )
              })}
              {/* Time blocks — in same coordinate system */}
              {blocks.map((block, idx) => {
                const isResizing = resizing?.blockIdx === idx
                const baseStartMin = timeToMin(block.startTime)
                const baseEndMin = block.endTime ? timeToMin(block.endTime) : baseStartMin + 60

                const previewStartMin = isResizing && resizePreview ? resizePreview.startMin : baseStartMin
                const previewEndMin = isResizing && resizePreview ? resizePreview.endMin : baseEndMin

                const sm = previewStartMin - START_HOUR * 60
                const top = (sm / TOTAL_MIN) * TOTAL_HEIGHT
                const durMin = Math.max(20, previewEndMin - previewStartMin)
                const h = (durMin / TOTAL_MIN) * TOTAL_HEIGHT

                const displayStart = `${String(Math.floor(previewStartMin / 60)).padStart(2, '0')}:${String(previewStartMin % 60).padStart(2, '0')}`
                const displayEnd = `${String(Math.floor(previewEndMin / 60)).padStart(2, '0')}:${String(previewEndMin % 60).padStart(2, '0')}`

                return (
                  <div key={idx} className="absolute left-14 right-6"
                    style={{ top, height: Math.max(32, h) }}>
                    <div className="group relative bg-accent-50/60 border border-accent-200/60 rounded-lg px-3 py-1
                                    hover:bg-accent-100 transition-colors h-full flex items-center gap-2">
                      {/* Top resize handle */}
                      <div
                        className="absolute top-0 left-0 right-0 h-2 cursor-ns-resize
                                   opacity-0 group-hover:opacity-100 transition-opacity
                                   hover:bg-accent-300/30 rounded-t-lg"
                        onMouseDown={(e) => handleResizeStart(e, idx, 'top', block)}
                      />
                      <span className="text-[11px] font-medium text-accent-700 bg-accent-100 px-1.5 py-0.5 rounded flex-shrink-0">
                        {fmtRange(displayStart, block.endTime ? displayEnd : null)}
                      </span>
                      <span className="text-sm text-surface-700 truncate flex-1 min-w-0">{block.text}</span>
                      <button onClick={() => handleDeleteBlock(block)}
                        className="opacity-0 group-hover:opacity-100 p-0.5 hover:bg-red-100 rounded transition-all flex-shrink-0">
                        <Trash2 className="w-3 h-3 text-red-400" />
                      </button>
                      {/* Bottom resize handle */}
                      <div
                        className="absolute bottom-0 left-0 right-0 h-2 cursor-ns-resize
                                   opacity-0 group-hover:opacity-100 transition-opacity
                                   hover:bg-accent-300/30 rounded-b-lg"
                        onMouseDown={(e) => handleResizeStart(e, idx, 'bottom', block)}
                      />
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
