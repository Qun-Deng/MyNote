import { useState, useEffect } from 'react'
import {
  format, startOfMonth, endOfMonth, startOfWeek, endOfWeek, addDays,
  isSameMonth, isSameDay, isToday,
} from 'date-fns'
import { ChevronLeft, ChevronRight, Clock, Plus, Trash2, FileText } from 'lucide-react'
import { useNoteStore } from '../../stores/noteStore'
import { useUIStore } from '../../stores/uiStore'

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
  const re = /##\s*今日记录\s*\n/
  const m = content.match(re)
  if (m) {
    const idx = m.index! + m[0].length
    return content.slice(0, idx) + `${blockLine}\n` + content.slice(idx)
  }
  const fmEnd = content.indexOf('---\n', 3)
  if (fmEnd > -1) {
    const insertAt = content.indexOf('\n', fmEnd + 4)
    return content.slice(0, insertAt + 1) + `\n## 今日记录\n${blockLine}\n` + content.slice(insertAt + 1)
  }
  return content + `\n${blockLine}\n`
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
    const load = async () => {
      setLoading(true)
      try {
        let diary = await window.mynote.diary.get(selectedDate)
        if (!diary) diary = await window.mynote.diary.create(selectedDate)
        const result = await window.mynote.notes.read(diary.path)
        if (!cancelled && result) {
          setDiaryContent(result.content)
          setDiaryPath(result.meta.path)
          setDiaryDates((prev) => new Set(prev).add(selectedDate))
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
    if (!newStart || !newText || !diaryPath) return
    const endStr = newEnd ? `-${newEnd}` : ''
    // Format: [HH:MM-HH:MM] text
    const line = `[${newStart}${endStr}] ${newText}`
    const newContent = insertBlockIntoContent(diaryContent, line)
    await window.mynote.notes.write(diaryPath, newContent)
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
  }

  const handleEditDiary = async () => {
    if (diaryPath) { await openNote(diaryPath); setOpenNotePath(diaryPath) }
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
                <button key={`${wi}-${di}`} onClick={() => setSelectedDate(ds)}
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
          <h2 className="text-base font-semibold text-surface-900">
            {dateLabel}
            {selectedDate === today && <span className="text-xs text-accent-500 font-normal ml-2">今天</span>}
          </h2>
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
              <p className="text-xs mt-1">点击"添加时间块"或在日记中写入 [HH:MM-HH:MM] 描述</p>
            </div>
          ) : (
            <div className="relative mx-6 my-6" style={{ height: TOTAL_HEIGHT }}>
              {/* Hour grid lines */}
              {hours.map((hour) => {
                const y = ((hour - START_HOUR) / (END_HOUR - START_HOUR)) * TOTAL_HEIGHT
                return (
                  <div key={hour} className="absolute left-0 right-0 flex items-center"
                    style={{ top: y }}>
                    <span className="w-14 text-right text-[11px] text-surface-400 pr-3 select-none flex-shrink-0">
                      {String(hour).padStart(2, '0')}:00
                    </span>
                    <div className="flex-1 h-px bg-surface-200" />
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
                    style={{ top, minHeight: Math.max(32, h) }}>
                    <div className="group relative bg-accent-50/60 border border-accent-200/60 rounded-lg px-3 py-1.5
                                    hover:bg-accent-100 transition-colors h-full">
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
