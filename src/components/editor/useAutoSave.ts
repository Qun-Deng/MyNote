import { useEffect, useRef, useCallback } from 'react'

interface UseAutoSaveOptions {
  /** Content to save */
  content: string
  /** File path to save to */
  filePath: string | null
  /** Debounce delay in ms */
  delay?: number
  /** Save callback */
  onSave: (filePath: string, content: string) => Promise<void>
}

export function useAutoSave({ content, filePath, delay = 800, onSave }: UseAutoSaveOptions) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const contentRef = useRef(content)
  const savingRef = useRef(false)

  // Keep content ref updated
  contentRef.current = content

  // Debounced save
  useEffect(() => {
    if (!filePath) return

    // Clear existing timer
    if (timerRef.current) {
      clearTimeout(timerRef.current)
    }

    // Set new timer
    timerRef.current = setTimeout(async () => {
      if (savingRef.current) return
      savingRef.current = true
      try {
        await onSave(filePath, contentRef.current)
      } catch (err) {
        console.error('Auto-save failed:', err)
      } finally {
        savingRef.current = false
      }
    }, delay)

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current)
      }
    }
  }, [content, filePath, delay])

  // Flush: save immediately (for close, switch, etc.)
  const flush = useCallback(async () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
    if (filePath && !savingRef.current) {
      savingRef.current = true
      try {
        await onSave(filePath, contentRef.current)
      } catch (err) {
        console.error('Flush save failed:', err)
      } finally {
        savingRef.current = false
      }
    }
  }, [filePath])

  return { flush }
}
