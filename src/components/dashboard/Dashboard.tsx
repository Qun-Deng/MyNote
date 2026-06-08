import { CalendarDays, CheckSquare, Clock, FileText, Plus } from 'lucide-react'
import { format } from 'date-fns'
import { zhCN } from 'date-fns/locale'

export default function Dashboard() {
  const today = new Date()
  const greeting = getGreeting(today.getHours())
  const dateStr = format(today, 'yyyy年M月d日 EEEE', { locale: zhCN })

  return (
    <div className="h-full overflow-auto">
      <div className="max-w-4xl mx-auto p-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-surface-900">
            {greeting}
          </h1>
          <p className="text-surface-500 mt-1">{dateStr}</p>
        </div>

        {/* Quick Actions */}
        <div className="grid grid-cols-3 gap-3 mb-8">
          <QuickCard
            icon={<FileText className="w-4 h-4" />}
            label="新建笔记"
            color="accent"
          />
          <QuickCard
            icon={<CalendarDays className="w-4 h-4" />}
            label="今日日记"
            color="green"
          />
          <QuickCard
            icon={<CheckSquare className="w-4 h-4" />}
            label="添加待办"
            color="amber"
          />
        </div>

        {/* Recent Notes */}
        <section className="mb-8">
          <div className="flex items-center justify-between mb-4">
            <h2 className="card-title">最近笔记</h2>
            <button className="text-xs text-accent-600 hover:text-accent-700 font-medium">
              查看全部
            </button>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <EmptyCard
              icon={<FileText className="w-8 h-8 text-surface-300" />}
              text="还没有笔记，点击上方按钮创建你的第一篇笔记"
            />
            <EmptyCard
              icon={<FileText className="w-8 h-8 text-surface-300" />}
              text="笔记会在这里显示"
            />
          </div>
        </section>

        {/* Today + Todos row */}
        <div className="grid grid-cols-2 gap-6">
          {/* Today's Diary */}
          <section className="card">
            <div className="flex items-center justify-between mb-3">
              <h2 className="card-title">今日日记</h2>
              <button className="p-1 hover:bg-surface-100 rounded transition-colors">
                <Plus className="w-4 h-4 text-surface-400" />
              </button>
            </div>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-amber-50 rounded-lg flex items-center justify-center">
                <CalendarDays className="w-5 h-5 text-amber-500" />
              </div>
              <div>
                <p className="text-sm font-medium text-surface-700">还没有今日日记</p>
                <p className="text-xs text-surface-400 mt-0.5">点击右上角 + 开始写作</p>
              </div>
            </div>
          </section>

          {/* Pending Todos */}
          <section className="card">
            <div className="flex items-center justify-between mb-3">
              <h2 className="card-title">待办事项</h2>
              <span className="text-xs text-surface-400">
                <Clock className="w-3 h-3 inline mr-1" />
                0 条待办
              </span>
            </div>
            <div className="text-center py-4">
              <CheckSquare className="w-8 h-8 text-surface-200 mx-auto mb-2" />
              <p className="text-xs text-surface-400">所有待办已完成 🎉</p>
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}

function QuickCard({
  icon,
  label,
  color,
}: {
  icon: React.ReactNode
  label: string
  color: 'accent' | 'green' | 'amber'
}) {
  const colorClasses = {
    accent: 'bg-accent-50 text-accent-600 hover:bg-accent-100 border-accent-200',
    green: 'bg-emerald-50 text-emerald-600 hover:bg-emerald-100 border-emerald-200',
    amber: 'bg-amber-50 text-amber-600 hover:bg-amber-100 border-amber-200',
  }
  return (
    <button
      className={`flex items-center gap-3 px-4 py-3 rounded-lg border transition-colors ${colorClasses[color]}`}
    >
      {icon}
      <span className="text-sm font-medium">{label}</span>
    </button>
  )
}

function EmptyCard({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div className="card flex flex-col items-center justify-center py-8 gap-3">
      {icon}
      <p className="text-xs text-surface-400 text-center">{text}</p>
    </div>
  )
}

function getGreeting(hour: number): string {
  if (hour < 6) return '夜深了 🌙'
  if (hour < 12) return '早上好 ☀️'
  if (hour < 14) return '中午好 🌤️'
  if (hour < 18) return '下午好 🌈'
  return '晚上好 🌆'
}
