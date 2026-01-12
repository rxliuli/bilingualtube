import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ShadowProvider } from '@/integrations/shadow/ShadowProvider'
import { ThemeProvider } from '@/integrations/theme/ThemeProvider'
import { Toaster } from 'sonner'
import { OptionsForm } from './components/OptionsForm'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
})

export function App(props: { container: HTMLElement }) {
  return (
    <ShadowProvider container={props.container}>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <Toaster richColors={true} closeButton={true} />
          <OptionsForm />
        </ThemeProvider>
      </QueryClientProvider>
    </ShadowProvider>
  )
}
