import { ipcMain } from 'electron'
import fs from 'fs'
import path from 'path'
import { getVaultPath } from './notes'
import { format } from 'date-fns'

function getDiaryPath(date: string): string {
  const d = new Date(date)
  const year = d.getFullYear().toString()
  const dateStr = format(d, 'yyyy-MM-dd')
  return `diary/${year}/${dateStr}.md`
}

function getWeekday(date: string): string {
  const weekdays = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六']
  const d = new Date(date)
  return weekdays[d.getDay()]
}

export function registerDiaryIPC() {
  ipcMain.handle('diary:get', async (_event, date: string) => {
    const vaultPath = getVaultPath()
    if (!vaultPath) return null

    const filePath = getDiaryPath(date)
    const fullPath = path.join(vaultPath, filePath)

    if (!fs.existsSync(fullPath)) return null

    const content = fs.readFileSync(fullPath, 'utf-8')
    const stat = fs.statSync(fullPath)

    return {
      id: 0,
      path: filePath,
      title: `${date} 日记`,
      created_at: stat.birthtime.toISOString(),
      updated_at: stat.mtime.toISOString(),
      tags: ['diary'],
      is_diary: true,
      diary_date: date,
    }
  })

  ipcMain.handle('diary:create', async (_event, date: string) => {
    const vaultPath = getVaultPath()
    if (!vaultPath) throw new Error('Vault not initialized')

    const filePath = getDiaryPath(date)
    const fullPath = path.join(vaultPath, filePath)
    const dir = path.dirname(fullPath)

    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }

    const d = new Date(date)
    const dateStr = format(d, 'yyyy年M月d日')
    const weekday = getWeekday(date)
    const isoDate = format(d, 'yyyy-MM-dd')

    const template = `---
date: ${isoDate}
tags: [diary]
---

# ${dateStr} ${weekday}

## [今日记录]

## [待办事项]

## [想法记录]
`

    fs.writeFileSync(fullPath, template, 'utf-8')

    return {
      id: 0,
      path: filePath,
      title: `${date} 日记`,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      tags: ['diary'],
      is_diary: true,
      diary_date: date,
    }
  })

  ipcMain.handle('diary:get-month', async (_event, year: number, month: number) => {
    const vaultPath = getVaultPath()
    if (!vaultPath) return []

    const diaryDir = path.join(vaultPath, 'diary', year.toString())
    const result: { date: string; hasEntry: boolean }[] = []

    // Get number of days in month
    const daysInMonth = new Date(year, month, 0).getDate()

    for (let day = 1; day <= daysInMonth; day++) {
      const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
      const filePath = path.join(diaryDir, `${dateStr}.md`)
      result.push({
        date: dateStr,
        hasEntry: fs.existsSync(filePath),
      })
    }

    return result
  })

  // Get diary entries within a date range
  ipcMain.handle('diary:get-range', async (_event, startDate: string, endDate: string) => {
    const vaultPath = getVaultPath()
    if (!vaultPath) return []

    const results: any[] = []
    const start = new Date(startDate)
    const end = new Date(endDate)

    const walkDiaryDir = (dir: string) => {
      if (!fs.existsSync(dir)) return
      const items = fs.readdirSync(dir)
      for (const item of items) {
        if (item.startsWith('.')) continue
        const fullPath = path.join(dir, item)
        if (fs.statSync(fullPath).isDirectory()) {
          walkDiaryDir(fullPath)
        } else if (item.endsWith('.md')) {
          const dateStr = item.replace('.md', '')
          const entryDate = new Date(dateStr)
          if (!isNaN(entryDate.getTime()) && entryDate >= start && entryDate <= end) {
            const content = fs.readFileSync(fullPath, 'utf-8')
            const relPath = path.relative(vaultPath, fullPath).replace(/\\/g, '/')
            // Extract first paragraph as preview
            const previewMatch = content.match(/^#.+?\n\n([\s\S]{0,120})/)
            const preview = previewMatch ? previewMatch[1].replace(/\n/g, ' ').trim() : ''
            results.push({
              path: relPath,
              date: dateStr,
              title: `${dateStr} 日记`,
              preview,
              updated_at: fs.statSync(fullPath).mtime.toISOString(),
            })
          }
        }
      }
    }

    walkDiaryDir(path.join(vaultPath, 'diary'))
    return results.sort((a, b) => b.date.localeCompare(a.date))
  })
}
