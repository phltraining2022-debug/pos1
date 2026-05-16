import React, { createContext, useContext, useState } from 'react'

export type ThemeMode = 'dark' | 'light'

export interface Colors {
  bg: string         // root background
  surface: string    // panels, headers, cards
  elevated: string   // raised list items, buttons bg
  input: string      // text input background
  border: string     // normal border
  borderFaint: string// very subtle border / nested bg
  text: string       // primary text
  textSub: string    // secondary text
  textMuted: string  // placeholder/label
  textFaint: string  // very muted
}

export const dark: Colors = {
  bg:          '#111827',
  surface:     '#1f2937',
  elevated:    '#374151',
  input:       '#111827',
  border:      '#374151',
  borderFaint: '#1f2937',
  text:        '#ffffff',
  textSub:     '#d1d5db',
  textMuted:   '#9ca3af',
  textFaint:   '#6b7280',
}

export const light: Colors = {
  bg:          '#f3f4f6',
  surface:     '#ffffff',
  elevated:    '#f9fafb',
  input:       '#ffffff',
  border:      '#e5e7eb',
  borderFaint: '#f3f4f6',
  text:        '#111827',
  textSub:     '#374151',
  textMuted:   '#6b7280',
  textFaint:   '#9ca3af',
}

interface ThemeCtx {
  mode: ThemeMode
  colors: Colors
  toggle: () => void
}

const ThemeContext = createContext<ThemeCtx>({ mode: 'light', colors: dark, toggle: () => {} })

export const ThemeProvider = ({ children }: { children: React.ReactNode }) => {
  const [mode, setMode] = useState<ThemeMode>('light')
  const colors = mode === 'dark' ? dark : light
  return (
    <ThemeContext.Provider value={{ mode, colors, toggle: () => setMode(m => m === 'dark' ? 'light' : 'dark') }}>
      {children}
    </ThemeContext.Provider>
  )
}

export const useTheme = () => useContext(ThemeContext)
