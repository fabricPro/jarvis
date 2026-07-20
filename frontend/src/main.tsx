import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './App.css'

const rootEl = document.getElementById('root')
if (!rootEl) {
  throw new Error('#root elementi bulunamadı')
}

createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
