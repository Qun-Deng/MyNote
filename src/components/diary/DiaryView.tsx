import { useState, useEffect } from 'react'
import {
  format, startOfMonth, endOfMonth, startOfWeek, endOfWeek, addDays,
  isSameMonth, isSameDay, isToday,
} from 'date-fns'
import { ChevronLeft, ChevronRight, FileText } from 'lucide-react'
import { useNoteStore } from '../../stores/noteStore'
import { useUIStore } from '../../stores/uiStore'

export default function DiaryView() {
  const [currentMonth, setCurrentMonth] = useState(new Date())
  const [selectedDate, setSelectedDate] = useState<Date | null>(new Date())
  const [diaryDates, setDiaryDates] = useState<Set<string>>(new Set())
  const [loadingEntry, setLoadingEntry] = useState(false)

  const openNote = useNoteStore((s) => s.openNote)
  const currentMeta = useNoteStore((s) => s.currentMeta)
  const currentContent = useNoteStore((s) => s.currentContent)
  const setContent = useNoteStore((s) => s.setContent)
  const closeNote = useNoteStore((s) => s.closeNote)
  const setOpenNotePath = useUIStore((s) => s.setOpenNotePath)
  const openNotePath = useUIStore((s) => s.openNotePath)

  // Load diary entries for current month
  useEffect(() => {
    const loadMonthData = async () => {
      const year = currentMonth.getFullYear()
      const month = currentMonth.getMonth() + 1
      try {
        const entries = await window.mynote.diary.getMonth(year, month)
        const dates = new Set<string>(entries.filter((e: { date: string; hasEntry: boolean }) => e.hasEntry).map((e: { date: string; hasEntry: boolean }) => e.date))
        setDiaryDates(dates)
      } catch {}
    }
    loadMonthData()
  }, [currentMonth])

  const monthStart = startOfMonth(currentMonth)
  const monthEnd = endOfMonth(currentMonth)
  const calStart = startOfWeek(monthStart, { weekStartsOn: 1 })
  const calEnd = endOfWeek(monthEnd, { weekStartsOn: 1 })

  const weeks: Date[][] = []
  let day = calStart
  while (day <= calEnd) {
    const week: Date[] = []
    for (let i = 0; i < 7; i++) {
      week.push(day)
      day = addDays(day, 1)
    }
    weeks.push(week)
  }

  const dayHeaders = ['一', '二', '三', '四', '五', '六', '日']

  const prevMonth = () => {
    setCurrentMonth(addDays(monthStart, -1))
  }

  const nextMonth = () => {
    setCurrentMonth(addDays(monthEnd, 1))
  }

  const handleSelectDate = async (date: Date) => {
    setSelectedDate(date)
    setLoadingEntry(true)

    const dateStr = format(date, 'yyyy-MM-dd')
    try {
      // Check if diary exists
      let diary = await window.mynote.diary.get(dateStr)
      if (!diary) {
        // Create new diary entry
        diary = await window.mynote.diary.create(dateStr)
        setDiaryDates((prev) => new Set(prev).add(dateStr))
      }
      await openNote(diary.path)
      setOpenNotePath(diary.path)
    } catch (err) {
      console.error('Failed to open diary:', err)
    } finally {
      setLoadingEntry(false)
    }
  }

  const isDiaryOpen = openNotePath && currentMeta?.is_diary

  return (
    <div className="h-full flex">
      {/* Calendar Panel */}
      <div className="w-80 flex-shrink-0 border-r border-surface-200 p-6 overflow-auto">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-surface-900">
            {format(currentMonth, 'yyyy年M月')}
          </h2>
          <div className="flex gap-1">
            <button
              onClick={prevMonth}
              className="p-1.5 hover:bg-surface-100 rounded transition-colors"
            >
              <ChevronLeft className="w-4 h-4 text-surface-500" />
            </button>
            <button
              onClick={nextMonth}
              className="p-1.5 hover:bg-surface-100 rounded transition-colors"
            >
              <ChevronRight className="w-4 h-4 text-surface-500" />
            </button>
          </div>
        </div>

        <div className="calendar-grid">
          {dayHeaders.map((h) => (
            <div key={h} className="calendar-day-header">{h}</div>
          ))}
          {weeks.map((week, wi) =>
            week.map((d, di) => {
              const dateStr = format(d, 'yyyy-MM-dd')
              const hasEntry = diaryDates.has(dateStr)
              const isSelected = selectedDate && isSameDay(d, selectedDate)
              return (
                <button
                  key={`${wi}-${di}`}
                  onClick={() => handleSelectDate(d)}
                  className={`calendar-day ${!isSameMonth(d, currentMonth) ? 'other-month' : ''
                    } ${isToday(d) ? 'today' : ''} ${hasEntry ? 'has-entry' : ''} ${isSelected ? 'ring-2 ring-accent-400 ring-inset' : ''
                    }`}
                >
                  {format(d, 'd')}
                </button>
              )
            })
          )}
        </div>

        <div className="mt-4">
          <p className="text-xs text-surface-400">
            点击日期查看或创建日记
          </p>
          <p className="text-xs text-surface-300 mt-1">
            有标记的日期表示已有日记
          </p>
        </div>
      </div>

      {/* Editor / Info Area */}
      <div className="flex-1 flex items-center justify-center">
        {loadingEntry ? (
          <div className="text-center text-surface-400">
            <p className="text-sm">加载中...</p>
          </div>
        ) : isDiaryOpen ? (
          <div className="text-center text-surface-400">
            <FileText className="w-12 h-12 mx-auto mb-3 text-surface-300" />
            <p className="text-sm text-surface-500 font-medium">
              正在编辑: {currentMeta?.title}
            </p>
            <p className="text-xs mt-1 text-surface-400">
              日记内容已在编辑器中打开，在左侧文件树可返回查看
            </p>
          </div>
        ) : selectedDate ? (
          <div className="text-center text-surface-400">
            <FileText className="w-12 h-12 mx-auto mb-3 text-surface-300" />
            <p className="text-sm">{format(selectedDate, 'yyyy年M月d日')}</p>
            <p className="text-xs mt-1">点击日历日期开始写日记</p>
          </div>
        ) : (
          <div className="text-center text-surface-400">
            <FileText className="w-12 h-12 mx-auto mb-3 text-surface-200" />
            <p className="text-sm">选择日期开始写日记</p>
          </div>
        )}
      </div>
    </div>
  )
}
