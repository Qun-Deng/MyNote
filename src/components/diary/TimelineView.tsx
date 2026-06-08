import { useState, useEffect } from 'react'
import { format, addDays, subDays } from 'date-fns'
import { zhCN } from 'date-fns/locale'
import { Clock, Plus, ChevronLeft, ChevronRight, FileText, Trash2 } from 'lucide-react'
import { useNoteStore } from '../../stores/noteStore'
import { useUIStore } from '../../stores/uiStore'

interface TimeBlock {
  startTime: string  // HH:MM
  endTime: string | null
  text: string
  raw: string
}

// Parse time blocks from markdown content
function parseTimeBlocks(markdown: string): TimeBlock[] {
  const lines = markdown.split('\n')
  const blocks: TimeBlock[] = []

  for (const line of lines) {
    const trimmed = line.trim()

    // Pattern: [HH:MM-HH:MM text] or [HH:MM text]
    const bracketMatch = trimmed.match(/^\[(\d{1,2}:\d{2})(?:-(\d{1,2}:\d{2}))?\s+(.+?)\]$/)
    if (bracketMatch) {
      blocks.push({
        startTime: normalizeTime(bracketMatch[1]),
        endTime: bracketMatch[2] ? normalizeTime(bracketMatch[2]) : null,
        text: bracketMatch[3],
        raw: trimmed,
      })
      continue
    }

    // Pattern: - HH:MM-HH:MM text (list item)
    const listMatch = trimmed.match(/^[-*+]\s+(\d{1,2}:\d{2})(?:-(\d{1,2}:\d{2}))?\s+(.+)$/)
    if (listMatch) {
      blocks.push({
        startTime: normalizeTime(listMatch[1]),
        endTime: listMatch[2] ? normalizeTime(listMatch[2]) : null,
        text: listMatch[3],
        raw: trimmed,
      })
      continue
    }

    // Pattern: HH:MM-HH:MM text (plain time range)
    const plainMatch = trimmed.match(/^(\d{1,2}:\d{2})-(\d{1,2}:\d{2})\s+(.+)$/)
    if (plainMatch) {
      blocks.push({
        startTime: normalizeTime(plainMatch[1]),
        endTime: normalizeTime(plainMatch[2]),
        text: plainMatch[3],
        raw: trimmed,
      })
      continue
    }
  }

  // Sort by start time
  blocks.sort((a, b) => a.startTime.localeCompare(b.startTime))
  return blocks
}

function normalizeTime(time: string): string {
  const [h, m] = time.split(':')
  return `${h.padStart(2, '0')}:${m}`
}

function timeToMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number)
  return h * 60 + m
}

function formatTimeRange(start: string, end: string | null): string {
  if (end) {
    return `${start} - ${end}`
  }
  return start
}

export default function TimelineView() {
  const today = format(new Date(), 'yyyy-MM-dd')
  const [selectedDate, setSelectedDate] = useState(today)
  const [diaryContent, setDiaryContent] = useState('')
  const [diaryPath, setDiaryPath] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const [newStart, setNewStart] = useState('')
  const [newEnd, setNewEnd] = useState('')
  const [newText, setNewText] = useState('')

  const openNote = useNoteStore((s) => s.openNote)
  const setOpenNotePath = useUIStore((s) => s.setOpenNotePath)
  const refreshTree = useNoteStore((s) => s.openNote) // placeholder, will refresh manually

  const loadDiary = async (date: string) => {
    setLoading(true)
    try {
      let diary = await window.mynote.diary.get(date)
      if (!diary) {
        diary = await window.mynote.diary.create(date)
      }
      const result = await window.mynote.notes.read(diary.path)
      if (result) {
        setDiaryContent(result.content)
        setDiaryPath(result.meta.path)
      }
    } catch (err) {
      console.error('Failed to load diary:', err)
      setDiaryContent('')
      setDiaryPath(null)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadDiary(selectedDate)
  }, [selectedDate])

  const blocks = parseTimeBlocks(diaryContent)

  // Timeline hour range
  const startHour = 6
  const endHour = 24
  const hours: number[] = []
  for (let h = startHour; h <= endHour; h++) hours.push(h)

  const goPrevDay = () => setSelectedDate(format(subDays(new Date(selectedDate), 1), 'yyyy-MM-dd'))
  const goNextDay = () => setSelectedDate(format(addDays(new Date(selectedDate), 1), 'yyyy-MM-dd'))

  const handleAddBlock = async () => {
    if (!newStart || !newText || !diaryPath) return
    const endStr = newEnd ? `-${newEnd}` : ''
    const newLine = `\n[${newStart}${endStr} ${newText}]`
    const newContent = diaryContent + newLine
    await window.mynote.notes.write(diaryPath, newContent)
    setDiaryContent(newContent)
    setNewStart('')
    setNewEnd('')
    setNewText('')
    setShowAdd(false)
  }

  const handleDeleteBlock = async (block: TimeBlock) => {
    if (!diaryPath) return
    const lines = diaryContent.split('\n')
    const idx = lines.findIndex((l) => l.trim() === block.raw)
    if (idx > -1) {
      lines.splice(idx, 1)
      const newContent = lines.join('\n')
      await window.mynote.notes.write(diaryPath, newContent)
      setDiaryContent(newContent)
    }
  }

  const handleEditDiary = async () => {
    if (diaryPath) {
      await openNote(diaryPath)
      setOpenNotePath(diaryPath)
    }
  }

  const dateStr = format(new Date(selectedDate), 'yyyy年M月d日 EEEE', { locale: zhCN })
  const isToday = selectedDate === today

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-3 border-b border-surface-200">
        <div className="flex items-center gap-3">
          <button onClick={goPrevDay} className="p-1 hover:bg-surface-100 rounded transition-colors">
            <ChevronLeft className="w-4 h-4 text-surface-500" />
          </button>
          <h2 className="text-lg font-semibold text-surface-900">
            {dateStr}
            {isToday && <span className="text-xs text-accent-500 font-normal ml-2">今天</span>}
          </h2>
          <button onClick={goNextDay} className="p-1 hover:bg-surface-100 rounded transition-colors">
            <ChevronRight className="w-4 h-4 text-surface-500" />
          </button>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setShowAdd(!showAdd)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-accent-600
                       bg-accent-50 hover:bg-accent-100 rounded-md transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            添加时间块
          </button>
          <button
            onClick={handleEditDiary}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-surface-600
                       bg-surface-100 hover:bg-surface-200 rounded-md transition-colors"
          >
            <FileText className="w-3.5 h-3.5" />
            编辑日记
          </button>
        </div>
      </div>

      {/* Add Block Form */}
      {showAdd && (
        <div className="px-6 py-3 border-b border-surface-200 bg-surface-50">
          <div className="flex items-center gap-2">
            <input
              type="time"
              value={newStart}
              onChange={(e) => setNewStart(e.target.value)}
              placeholder="开始"
              className="px-2 py-1.5 text-sm border border-surface-300 rounded-md outline-none focus:border-accent-400"
            />
            <span className="text-surface-400 text-sm">-</span>
            <input
              type="time"
              value={newEnd}
              onChange={(e) => setNewEnd(e.target.value)}
              placeholder="结束(可选)"
              className="px-2 py-1.5 text-sm border border-surface-300 rounded-md outline-none focus:border-accent-400"
            />
            <input
              type="text"
              value={newText}
              onChange={(e) => setNewText(e.target.value)}
              placeholder="做了什么..."
              className="flex-1 px-3 py-1.5 text-sm border border-surface-300 rounded-md outline-none focus:border-accent-400"
              onKeyDown={(e) => { if (e.key === 'Enter') handleAddBlock() }}
            />
            <button
              onClick={handleAddBlock}
              disabled={!newStart || !newText}
              className="px-3 py-1.5 text-sm bg-accent-600 text-white rounded-md
                         hover:bg-accent-700 disabled:opacity-40 transition-colors"
            >
              添加
            </button>
          </div>
          <p className="text-[11px] text-surface-400 mt-2">
            格式示例: [8:00-9:00 洗漱] 或 [9:00-11:00 工作]
          </p>
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
            <p className="text-xs mt-1">点击"添加时间块"或在日记中使用 [HH:MM-HH:MM 事项] 格式</p>
          </div>
        ) : (
          <div className="py-6 px-8">
            {/* Timeline with hour markers */}
            <div className="relative">
              {hours.map((hour) => {
                const minutePos = (hour - startHour) / (endHour - startHour) * 100
                return (
                  <div
                    key={hour}
                    className="absolute left-0 w-full"
                    style={{ top: `${minutePos}%` }}
                  >
                    <div className="flex items-center">
                      <span className="w-12 text-right text-[11px] text-surface-400 pr-3 flex-shrink-0 select-none">
                        {hour}:00
                      </span>
                      <div className="flex-1 h-px bg-surface-200" />
                    </div>
                  </div>
                )
              })}

              {/* Spacing for the hour markers */}
              <div className="relative pt-6 pb-6" style={{ minHeight: `${((endHour - startHour) * 56)}px` }}>
                {/* Time blocks */}
                <div className="pl-12 relative">
                  {blocks.map((block, idx) => {
                    const startMin = timeToMinutes(block.startTime)
                    const totalMinutes = (endHour - startHour) * 60
                    const topPercent = ((startMin - startHour * 60) / totalMinutes) * 100
                    const duration = block.endTime
                      ? timeToMinutes(block.endTime) - startMin
                      : 60 // default 1 hour
                    const heightPx = Math.max(40, (duration / totalMinutes) * (endHour - startHour) * 56)

                    return (
                      <div
                        key={idx}
                        className="absolute left-12 right-8"
                        style={{ top: `${topPercent}%` }}
                      >
                        <div className="group relative bg-accent-50 border border-accent-200 rounded-lg px-3 py-2
                                        hover:bg-accent-100 transition-colors cursor-default"
                             style={{ minHeight: `${heightPx}px` }}>
                          {/* Dot on the left */}
                          <div className="absolute -left-[22px] top-2.5 w-2.5 h-2.5 rounded-full bg-accent-400 ring-2 ring-white" />
                          <div className="flex items-start justify-between">
                            <div>
                              <span className="text-[11px] font-medium text-accent-700 bg-accent-100 px-1.5 py-0.5 rounded">
                                {formatTimeRange(block.startTime, block.endTime)}
                              </span>
                            </div>
                            <button
                              onClick={() => handleDeleteBlock(block)}
                              className="opacity-0 group-hover:opacity-100 p-0.5 hover:bg-red-100 rounded transition-all"
                            >
                              <Trash2 className="w-3 h-3 text-red-400" />
                            </button>
                          </div>
                          <p className="text-sm text-surface-700 mt-1">{block.text}</p>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
