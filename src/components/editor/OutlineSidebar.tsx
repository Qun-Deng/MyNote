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
}

export default function OutlineSidebar({ content, onJumpToHeading }: OutlineSidebarProps) {
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
    // Find the heading element in the editor DOM and scroll to it
    const editor = document.querySelector('.ProseMirror')
    if (!editor) return

    // Try finding by heading ID (milkdown generates IDs like h-n)
    // Also try matching by text content
    const headings = editor.querySelectorAll('h1, h2, h3, h4, h5, h6')
    for (const h of headings) {
      if (h.textContent?.trim() === heading.text) {
        h.scrollIntoView({ behavior: 'smooth', block: 'start' })
        // Highlight briefly
        h.classList.add('outline-highlight')
        setTimeout(() => h.classList.remove('outline-highlight'), 1500)
        return
      }
    }

    // Fallback: notify parent to use custom jump logic
    onJumpToHeading?.(heading.line)
  }

  if (headingTree.length === 0) return null

  return (
    <div className="outline-sidebar">
      <div className="outline-header">
        <ListTree className="w-3.5 h-3.5" />
        <span>大纲</span>
      </div>
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
