import { ShadowProvider } from '@/integrations/shadow/ShadowProvider'
import { ThemeProvider } from '@/integrations/theme/ThemeProvider'
import { Toaster } from 'sonner'
import { OptionsForm } from './components/OptionsForm'

export function App(props: { container: HTMLElement }) {
  return (
    <ShadowProvider container={props.container}>
      <ThemeProvider>
        <Toaster richColors={true} closeButton={true} />
        <OptionsForm />
      </ThemeProvider>
    </ShadowProvider>
  )
}
