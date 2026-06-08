import { useState } from 'react'
import { format, startOfMonth, endOfMonth, startOfWeek, endOfWeek, addDays, isSameMonth, isSameDay, isToday } from 'date-fns'
import { ChevronLeft, ChevronRight, FileText } from 'lucide-react'

export default function DiaryView() {
  const [currentMonth, setCurrentMonth] = useState(new Date())
  const [selectedDate, setSelectedDate] = useState<Date | null>(null)

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
            week.map((d, di) => (
              <button
                key={`${wi}-${di}`}
                onClick={() => setSelectedDate(d)}
                className={`calendar-day ${
                  !isSameMonth(d, currentMonth) ? 'other-month' : ''
                } ${isToday(d) ? 'today' : ''} ${
                  selectedDate && isSameDay(d, selectedDate) ? 'ring-2 ring-accent-400 ring-inset' : ''
                }`}
              >
                {format(d, 'd')}
              </button>
            ))
          )}
        </div>

        <div className="mt-4">
          <p className="text-xs text-surface-400">
            点击日期查看或创建日记
          </p>
        </div>
      </div>

      {/* Editor Area */}
      <div className="flex-1 flex items-center justify-center">
        {selectedDate ? (
          <div className="text-center text-surface-400">
            <FileText className="w-12 h-12 mx-auto mb-3 text-surface-300" />
            <p className="text-sm">{format(selectedDate, 'yyyy年M月d日')}</p>
            <p className="text-xs mt-1">编辑器将在 Phase 2 中集成</p>
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
