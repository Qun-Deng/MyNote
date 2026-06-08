import { useState, useEffect } from 'react'
import { format, subDays, subWeeks, subMonths, subYears } from 'date-fns'
import { zhCN } from 'date-fns/locale'
import { Clock, FileText, ChevronDown } from 'lucide-react'
import { useNoteStore } from '../../stores/noteStore'
import { useUIStore } from '../../stores/uiStore'

interface TimelineEntry {
  path: string
  date: string
  title: string
  preview: string
  updated_at: string
}

type RangeOption = 'week' | 'month' | 'year' | 'all'

const rangeOptions: { value: RangeOption; label: string }[] = [
  { value: 'week', label: '本周' },
  { value: 'month', label: '本月' },
  { value: 'year', label: '本年' },
  { value: 'all', label: '全部' },
]

export default function TimelineView() {
  const [entries, setEntries] = useState<TimelineEntry[]>([])
  const [range, setRange] = useState<RangeOption>('month')
  const [rangeMenuOpen, setRangeMenuOpen] = useState(false)

  const openNote = useNoteStore((s) => s.openNote)
  const setOpenNotePath = useUIStore((s) => s.setOpenNotePath)

  const getDateRange = (r: RangeOption): { start: string; end: string } => {
    const today = new Date()
    let start: Date
    switch (r) {
      case 'week':
        start = subWeeks(today, 1)
        break
      case 'month':
        start = subMonths(today, 1)
        break
      case 'year':
        start = subYears(today, 1)
        break
      default:
        start = new Date(2000, 0, 1)
    }
    return {
      start: format(start, 'yyyy-MM-dd'),
      end: format(today, 'yyyy-MM-dd'),
    }
  }

  const loadEntries = async () => {
    const { start, end } = getDateRange(range)
    try {
      const items = await window.mynote.diary.getRange(start, end)
      setEntries(items)
    } catch {
      setEntries([])
    }
  }

  useEffect(() => {
    loadEntries()
  }, [range])

  const handleOpenEntry = async (entry: TimelineEntry) => {
    await openNote(entry.path)
    setOpenNotePath(entry.path)
  }

  // Group entries by date for the timeline
  const groupedByDate = new Map<string, TimelineEntry[]>()
  for (const entry of entries) {
    if (!groupedByDate.has(entry.date)) {
      groupedByDate.set(entry.date, [])
    }
    groupedByDate.get(entry.date)!.push(entry)
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-surface-200">
        <h2 className="text-lg font-semibold text-surface-900">时间轴</h2>

        {/* Range Selector */}
        <div className="relative">
          <button
            onClick={() => setRangeMenuOpen(!rangeMenuOpen)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-surface-600
                       bg-surface-100 hover:bg-surface-200 rounded-md transition-colors"
          >
            <Clock className="w-3.5 h-3.5" />
            {rangeOptions.find((o) => o.value === range)?.label}
            <ChevronDown className="w-3 h-3" />
          </button>

          {rangeMenuOpen && (
            <div
              className="absolute right-0 top-full mt-1 w-28 bg-white border border-surface-200
                         rounded-md shadow-lg py-1 z-50"
              onMouseLeave={() => setRangeMenuOpen(false)}
            >
              {rangeOptions.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => { setRange(opt.value); setRangeMenuOpen(false) }}
                  className={`w-full text-left px-3 py-1.5 text-sm transition-colors ${
                    range === opt.value
                      ? 'bg-accent-50 text-accent-700 font-medium'
                      : 'text-surface-600 hover:bg-surface-50'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Timeline Content */}
      <div className="flex-1 overflow-auto">
        {entries.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-surface-400">
            <FileText className="w-12 h-12 text-surface-200 mb-3" />
            <p className="text-sm">该时间范围内暂无日记</p>
            <p className="text-xs mt-1">在日历视图中创建日记后，会在这里显示</p>
          </div>
        ) : (
          <div className="py-6 px-8">
            {/* Vertical line */}
            <div className="relative pl-10 before:absolute before:left-[19px] before:top-2 before:bottom-2 before:w-px before:bg-surface-200">
              {Array.from(groupedByDate.entries()).map(([date, dayEntries]) => (
                <div key={date} className="mb-6 last:mb-0">
                  {/* Date marker */}
                  <div className="relative flex items-center gap-3 mb-3">
                    <div className="absolute left-[-22px] w-2 h-2 rounded-full bg-accent-400 ring-4 ring-white" />
                    <span className="text-sm font-semibold text-surface-800">
                      {format(new Date(date), 'M月d日 EEEE', { locale: zhCN })}
                    </span>
                  </div>

                  {/* Entries for this date */}
                  <div className="space-y-2">
                    {dayEntries.map((entry) => (
                      <button
                        key={entry.path}
                        onClick={() => handleOpenEntry(entry)}
                        className="w-full text-left p-3 rounded-lg border border-surface-200
                                   hover:border-accent-200 hover:bg-surface-50 transition-colors"
                      >
                        <div className="flex items-center gap-2 mb-1">
                          <FileText className="w-3.5 h-3.5 text-surface-400" />
                          <span className="text-sm font-medium text-surface-700">
                            {entry.title}
                          </span>
                          <span className="text-xs text-surface-400">
                            {format(new Date(entry.updated_at), 'HH:mm')}
                          </span>
                        </div>
                        {entry.preview && (
                          <p className="text-xs text-surface-500 line-clamp-2 ml-6">
                            {entry.preview}
                          </p>
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
