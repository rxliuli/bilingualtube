import ReactDOM from 'react-dom/client'
import { App } from './App'
import { ShadowProvider } from '@/integrations/shadow/ShadowProvider'
import { ThemeProvider } from '@/integrations/theme/ThemeProvider'
import './style.css'

const root = document.getElementById('root')

if (root) {
  ReactDOM.createRoot(root).render(
    <ShadowProvider container={document.body}>
      <ThemeProvider>
        <App />
      </ThemeProvider>
    </ShadowProvider>,
  )
}
