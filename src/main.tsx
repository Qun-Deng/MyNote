import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { api } from './api'
import './styles/index.css'

// Initialize theme
const savedTheme = localStorage.getItem('mynote-theme') || 'light'
document.documentElement.setAttribute('data-theme', savedTheme)

// Inject Tauri-compatible API (replaces electron/preload.ts contextBridge)
window.mynote = api

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
