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
  // 1. Try to find existing ## [今日记录] header
  const headerRe = /^##\s*\[今日记录\]/m
  const headerMatch = content.match(headerRe)
  if (headerMatch) {
    // Found — insert time block on the next line after this header
    const lineEnd = content.indexOf('\n', headerMatch.index!)
    const idx = lineEnd === -1 ? content.length : lineEnd + 1
    return content.slice(0, idx) + `${blockLine}\n` + content.slice(idx)
  }

  // 2. No [今日记录] — try to find the title (# ...) and insert after it
  const titleMatch = content.match(/^#\s+.+$/m)
  if (titleMatch) {
    const titleLineEnd = content.indexOf('\n', titleMatch.index!)
    let idx = titleLineEnd === -1 ? content.length : titleLineEnd + 1
    // Skip one blank line after title if present
    if (content[idx] === '\n') idx++
    return content.slice(0, idx) + `\n## [今日记录]\n${blockLine}\n` + content.slice(idx)
  }

  // 3. No title either — try to insert after frontmatter
  const fmEnd = content.indexOf('---\n', 3)
  if (fmEnd > -1) {
    const insertAt = content.indexOf('\n', fmEnd + 4)
    return content.slice(0, insertAt + 1) + `\n## [今日记录]\n${blockLine}\n` + content.slice(insertAt + 1)
  }

  // 4. No structure at all — just append
  return content + `\n${blockLine}\n`
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
    <div className="h-full flex">
      {/* ====== LEFT: Calendar ====== */}
      <div className="w-72 flex-shrink-0 border-r border-surface-200 p-5 overflow-auto">
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

        <div className="calendar-grid">
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
      </div>

      {/* ====== RIGHT: Timeline ====== */}
      <div className="flex-1 flex flex-col overflow-hidden">
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
                className="flex-1 px-3 py-1.5 text-sm border border-surface-300 rounded-md outline-none focus:border-accent-400"
                onKeyDown={e => { if (e.key === 'Enter') handleAddBlock() }} />
              <button onClick={handleAddBlock} disabled={!newStart || !newText}
                className="px-4 py-1.5 text-sm bg-accent-600 text-white rounded-md hover:bg-accent-700 disabled:opacity-40 transition-colors">
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
            <div className="relative mx-6 my-6" style={{ height: TOTAL_HEIGHT }}>
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
                const sm = timeToMin(block.startTime) - START_HOUR * 60   // minutes from START_HOUR
                const top = (sm / TOTAL_MIN) * TOTAL_HEIGHT
                const durMin = block.endTime ? Math.max(20, timeToMin(block.endTime) - timeToMin(block.startTime)) : 60
                const h = (durMin / TOTAL_MIN) * TOTAL_HEIGHT
                return (
                  <div key={idx} className="absolute left-14 right-6"
                    style={{ top, height: Math.max(32, h) }}>
                    <div className="group relative bg-accent-50/60 border border-accent-200/60 rounded-lg px-3 py-1.5
                                    hover:bg-accent-100 transition-colors h-full flex flex-col">
                      <div className="flex items-start justify-between">
                        <span className="text-[11px] font-medium text-accent-700 bg-accent-100 px-1.5 py-0.5 rounded">
                          {fmtRange(block.startTime, block.endTime)}
                        </span>
                        <button onClick={() => handleDeleteBlock(block)}
                          className="opacity-0 group-hover:opacity-100 p-0.5 hover:bg-red-100 rounded transition-all ml-2">
                          <Trash2 className="w-3 h-3 text-red-400" />
                        </button>
                      </div>
                      <p className="text-sm text-surface-700 mt-1">{block.text}</p>
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
