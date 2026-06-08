import { create } from 'zustand'

export type Theme = 'light' | 'dark'

interface ThemeState {
  theme: Theme
  setTheme: (theme: Theme) => void
  toggleTheme: () => void
}

export const useThemeStore = create<ThemeState>((set) => ({
  theme: (localStorage.getItem('mynote-theme') as Theme) || 'light',

  setTheme: (theme) => {
    localStorage.setItem('mynote-theme', theme)
    document.documentElement.setAttribute('data-theme', theme)
    set({ theme })
  },

  toggleTheme: () => {
    set((state) => {
      const newTheme = state.theme === 'light' ? 'dark' : 'light'
      localStorage.setItem('mynote-theme', newTheme)
      document.documentElement.setAttribute('data-theme', newTheme)
      return { theme: newTheme }
    })
  },
}))
