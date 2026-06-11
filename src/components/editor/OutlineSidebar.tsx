import { useMemo, useState } from 'react'
import { ListTree, ChevronRight, ChevronDown } from 'lucide-react'

interface Heading {
  level: number
  text: string
  line: number
  children: Heading[]
}

function parseHeadings(markdown: string): Heading[] {
  const lines = markdown.split('\n')
  const headings: Heading[] = []
  const stack: Heading[] = []

  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(/^(#{1,6})\s+(.+)$/)
    if (!match) continue
    const level = match[1].length
    const text = match[2].trim()

    const heading: Heading = { level, text, line: i, children: [] }

    // Find the parent heading
    while (stack.length > 0 && stack[stack.length - 1].level >= level) {
      stack.pop()
    }

    if (stack.length === 0) {
      headings.push(heading)
    } else {
      stack[stack.length - 1].children.push(heading)
    }

    stack.push(heading)
  }

  return headings
}

interface OutlineSidebarProps {
  content: string
  onJumpToHeading?: (lineIndex: number) => void
  width?: number
  embedded?: boolean
}

export default function OutlineSidebar({ content, onJumpToHeading, width, embedded = false }: OutlineSidebarProps) {
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set())

  const headingTree = useMemo(() => parseHeadings(content), [content])

  const toggle = (line: number) => {
    setCollapsed(prev => {
      const next = new Set(prev)
      if (next.has(line)) next.delete(line)
      else next.add(line)
      return next
    })
  }

  const handleClick = (heading: Heading) => {
    const editor = document.querySelector('.ProseMirror')
    if (!editor) return

    // Normalize: strip Milkdown backslash escapes for comparison
    const targetText = heading.text.replace(/\\([[\]])/g, '$1').trim()

    const headings = editor.querySelectorAll('h1, h2, h3, h4, h5, h6')
    for (const h of headings) {
      const domText = (h.textContent ?? '').replace(/\\([[\]])/g, '$1').trim()
      if (domText === targetText || domText.includes(targetText)) {
        h.scrollIntoView({ behavior: 'smooth', block: 'start' })
        h.classList.add('outline-highlight')
        setTimeout(() => h.classList.remove('outline-highlight'), 1500)
        return
      }
    }

    // Fallback: try finding by line index via position
    onJumpToHeading?.(heading.line)
  }

  const tree = headingTree.length === 0 ? (
    <p className="outline-empty">这篇笔记还没有标题。</p>
  ) : (
    <div className="outline-tree">
      {headingTree.map((h) => (
        <OutlineNode
          key={h.line}
          heading={h}
          depth={0}
          collapsed={collapsed}
          onToggle={toggle}
          onClick={handleClick}
        />
      ))}
    </div>
  )

  if (embedded) {
    return tree
  }

  return (
    <div className="outline-sidebar" style={{ width }}>
      <div className="outline-header">
        <ListTree className="w-3.5 h-3.5" />
        <span>大纲</span>
      </div>
      {tree}
    </div>
  )
}

function OutlineNode({
  heading,
  depth,
  collapsed,
  onToggle,
  onClick,
}: {
  heading: Heading
  depth: number
  collapsed: Set<number>
  onToggle: (line: number) => void
  onClick: (h: Heading) => void
}) {
  const isCollapsed = collapsed.has(heading.line)
  const hasChildren = heading.children.length > 0

  return (
    <div>
      <button
        className="outline-item"
        style={{ paddingLeft: `${8 + depth * 14}px` }}
        onClick={() => onClick(heading)}
        title={heading.text}
      >
        {hasChildren ? (
          <span
            className="outline-toggle"
            onClick={(e) => { e.stopPropagation(); onToggle(heading.line) }}
          >
            {isCollapsed ? <ChevronRight className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          </span>
        ) : (
          <span className="outline-bullet" />
        )}
        <span className={`outline-text outline-h${heading.level}`}>
          {heading.text}
        </span>
      </button>
      {!isCollapsed && hasChildren && (
        <div>
          {heading.children.map((child) => (
            <OutlineNode
              key={child.line}
              heading={child}
              depth={depth + 1}
              collapsed={collapsed}
              onToggle={onToggle}
              onClick={onClick}
            />
          ))}
        </div>
      )}
    </div>
  )
}
