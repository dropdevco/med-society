import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './i18n'          // initialize i18next before the app renders
import App from './App.tsx'
import i18n from './i18n'
import { initAnalytics } from './lib/posthog'
import { installErrorCapture } from './lib/clientErrors'

initAnalytics(i18n.language)
installErrorCapture()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
