import { useState, useEffect } from 'react'
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
  const lines = markdown.split('\n')
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
  // Strip Milkdown backslash-escaped brackets before matching.
  const clean = content.replace(/\\([[\]])/g, '$1')
  const headerRe = /^##\s*\[今日记录\]/m
  const headerMatch = clean.match(headerRe)
  if (headerMatch) {
    // Found — append at the end of the time-block section, before
    // the next ## heading (or EOF).  Each block occupies one line.
    const headerLineEnd = content.indexOf('\n', headerMatch.index!)
    const afterHeader = headerLineEnd === -1 ? content.length : headerLineEnd + 1
    const rest = content.slice(afterHeader)
    const nextHeading = rest.search(/^##\s/m)
    if (nextHeading >= 0) {
      let pos = afterHeader + nextHeading
      // Trim trailing blank lines so we insert right before the
      // blank-line separator that precedes the next heading.
      while (pos > afterHeader && content[pos - 1] === '\n') pos--
      // Ensure exactly one blank line between time blocks and the
      // next heading section.
      return content.slice(0, pos) + '\n' + blockLine + '\n\n' + content.slice(afterHeader + nextHeading)
    } else {
      return content.replace(/\n*$/, '\n' + blockLine + '\n')
    }
  }

  // 2. No [今日记录] header yet — create the section after the title.
  const titleMatch = content.match(/^#\s+.+$/m)
  if (titleMatch) {
    const titleLineEnd = content.indexOf('\n', titleMatch.index!)
    let idx = titleLineEnd === -1 ? content.length : titleLineEnd + 1
    if (content[idx] === '\n') idx++
    // content[idx] is the start of the next ## heading.
    // Insert [今日记录] section with one blank line above and below.
    return content.slice(0, idx) + '## [今日记录]\n' + blockLine + '\n\n' + content.slice(idx)
  }

  // 3. No title — insert after frontmatter.
  const fmEnd = content.indexOf('---\n', 3)
  if (fmEnd > -1) {
    const insertAt = content.indexOf('\n', fmEnd + 4)
    return content.slice(0, insertAt + 1) + '## [今日记录]\n' + blockLine + '\n\n' + content.slice(insertAt + 1)
  }

  // 4. Bare content — append.
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
        if (!diary) {
          diary = await window.mynote.diary.create(selectedDate)
          refreshTree()
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
    const lines = diaryContent.split('\n')
    const idx = lines.findIndex((l) => l.trim() === block.raw)
    if (idx > -1) {
      lines.splice(idx, 1)
      const nc = lines.join('\n')
      await window.mynote.notes.write(diaryPath, nc)
      setDiaryContent(nc)
    }
    // If no blocks left, optionally delete the diary file?
    // For now, just keep empty diary
  }

  const handleEditInEditor = async () => {
    if (diaryPath) {
      const opened = await openNote(diaryPath)
      if (opened) setOpenNotePath(diaryPath)
    }
  }

  // ---- Render ----
  const canGoPrev = true
  const canGoNext = true

  return (
    <div className="h-full overflow-auto">
      <div className="max-w-[960px] mx-auto px-6 py-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-surface-800">
            {format(currentMonth, 'yyyy年M月')}
          </h2>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setCurrentMonth((d) => addDays(d, -30))}
              className="p-1 rounded-md hover:bg-surface-100 transition-colors"
            >
              <ChevronLeft className="w-4 h-4 text-surface-500" />
            </button>
            <button
              onClick={() => setCurrentMonth(new Date())}
              className="text-xs px-2 py-0.5 rounded-md hover:bg-surface-100 text-surface-500 transition-colors"
            >
              今天
            </button>
            <button
              onClick={() => setCurrentMonth((d) => addDays(d, 30))}
              className="p-1 rounded-md hover:bg-surface-100 transition-colors"
            >
              <ChevronRight className="w-4 h-4 text-surface-500" />
            </button>
          </div>
        </div>

        {/* Left-Right Layout */}
        <div className="flex gap-6">
          {/* ── Left: Calendar ── */}
          <div className="w-[240px] flex-shrink-0">
            {/* Day headers */}
            <div className="grid grid-cols-7 mb-0.5">
              {['一', '二', '三', '四', '五', '六', '日'].map((d, i) => (
                <div key={i} className="text-center text-[11px] font-medium text-surface-400 py-0.5">
                  {d}
                </div>
              ))}
            </div>
            {/* Weeks */}
            {weeks.map((week, wi) => (
              <div key={wi} className="grid grid-cols-7">
                {week.map((date, di) => {
                  const inMonth = isSameMonth(date, currentMonth)
                  const isSel = isSameDay(date, new Date(selectedDate))
                  const isTD = isToday(date)
                  const dateStr = format(date, 'yyyy-MM-dd')
                  const hasEntry = diaryDates.has(dateStr)
                  return (
                    <button
                      key={di}
                      onClick={() => setSelectedDate(dateStr)}
                      className={`relative flex flex-col items-center py-1 text-xs rounded-md transition-colors
                        ${!inMonth ? 'text-surface-300' : isSel ? 'bg-accent-100 text-accent-700 font-semibold' : 'hover:bg-surface-50 text-surface-600'}
                      `}
                    >
                      <span className={isTD ? 'w-5 h-5 rounded-full bg-accent-500 text-white flex items-center justify-center text-[11px]' : ''}>
                        {format(date, 'd')}
                      </span>
                      {hasEntry && (
                        <span className={`w-1 h-1 rounded-full mt-px ${isSel ? 'bg-accent-500' : 'bg-accent-400'}`} />
                      )}
                    </button>
                  )
                })}
              </div>
            ))}

            {/* Selected date */}
            <div className="mt-4 pt-3 border-t border-surface-150">
              <h3 className="text-sm font-semibold text-surface-700">
                {format(new Date(selectedDate), 'M月d日 EEEE')}
              </h3>
            </div>
          </div>

          {/* ── Right: Timeline ── */}
          <div className="flex-1 min-w-0">
            {loading ? (
              <div className="text-center text-surface-400 py-8 text-sm">Loading...</div>
            ) : (
              <div className="relative">
                {/* Time axis */}
                <div className="absolute left-0 top-0 bottom-0 w-14 flex flex-col pointer-events-none">
                  {hours.map((h) => (
                    <div key={h} className="flex items-start justify-end pr-2 text-[11px] text-surface-400" style={{ height: HOUR_HEIGHT }}>
                      {h}:00
                    </div>
                  ))}
                </div>

                {/* Timeline area */}
                <div className="ml-14 relative" style={{ minHeight: TOTAL_HEIGHT }}>
                  {/* Hour grid lines */}
                  {hours.map((h) => (
                    <div
                      key={h}
                      className="border-t border-surface-150"
                      style={{ height: HOUR_HEIGHT }}
                    />
                  ))}

                  {/* Time blocks */}
                  {blocks.map((block, i) => {
                    const sm = timeToMin(block.startTime) - START_HOUR * 60
                    const durMin = block.endTime ? Math.max(20, timeToMin(block.endTime) - timeToMin(block.startTime)) : 60
                    const topPx = (sm / TOTAL_MIN) * TOTAL_HEIGHT
                    const heightPx = Math.max(24, (durMin / TOTAL_MIN) * TOTAL_HEIGHT)

                    return (
                      <div
                        key={i}
                        className="absolute left-1 right-1 rounded-md px-2 py-1 text-xs border border-accent-200 bg-accent-50 text-surface-700 hover:bg-accent-100 transition-colors group"
                        style={{ top: topPx, height: heightPx }}
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-medium text-accent-700">
                            {fmtRange(block.startTime, block.endTime)}
                          </span>
                          <button
                            onClick={() => handleDeleteBlock(block)}
                            className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 hover:bg-red-100 rounded"
                            title="删除时间块"
                          >
                            <Trash2 className="w-3 h-3 text-red-400" />
                          </button>
                        </div>
                        <div className="truncate text-surface-600">{block.text}</div>
                      </div>
                    )
                  })}

                  {/* Empty state */}
                  {blocks.length === 0 && (
                    <div className="absolute inset-0 flex items-center justify-center text-surface-400 text-sm">
                      暂无记录 — 点击 + 添加时间块
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Add block */}
            <div className="mt-4">
              {showAdd ? (
                <div className="flex items-center gap-2 flex-wrap p-2 border border-surface-200 rounded-lg bg-surface-50">
                  <input
                    type="time" value={newStart}
                    onChange={(e) => setNewStart(e.target.value)}
                    className="px-2 py-1 text-sm border border-surface-200 rounded-md bg-white text-surface-700"
                  />
                  <span className="text-surface-400 text-sm">-</span>
                  <input
                    type="time" value={newEnd}
                    onChange={(e) => setNewEnd(e.target.value)}
                    className="px-2 py-1 text-sm border border-surface-200 rounded-md bg-white text-surface-700"
                    placeholder="结束"
                  />
                  <input
                    type="text" value={newText}
                    onChange={(e) => setNewText(e.target.value)}
                    className="flex-1 min-w-[100px] px-2 py-1 text-sm border border-surface-200 rounded-md bg-white text-surface-700"
                    placeholder="做了什么..."
                    onKeyDown={(e) => { if (e.key === 'Enter') handleAddBlock() }}
                  />
                  <button onClick={handleAddBlock} className="px-3 py-1 text-sm bg-accent-500 text-white rounded-md hover:bg-accent-600 transition-colors">
                    添加
                  </button>
                  <button onClick={() => { setShowAdd(false); setNewStart(''); setNewEnd(''); setNewText('') }} className="px-2 py-1 text-sm text-surface-500 hover:text-surface-700 transition-colors">
                    取消
                  </button>
                </div>
              ) : (
                <button onClick={() => setShowAdd(true)} className="flex items-center gap-1.5 text-sm text-surface-500 hover:text-accent-600 transition-colors px-1 py-0.5">
                  <Plus className="w-4 h-4" /> 添加时间块
                </button>
              )}
            </div>

            {/* Open in editor */}
            <div className="mt-3 pt-3 border-t border-surface-150">
              <button onClick={handleEditInEditor} className="flex items-center gap-1 text-xs text-surface-400 hover:text-accent-600 transition-colors">
                <FileText className="w-3.5 h-3.5" /> 在编辑器中打开
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
