import { useState } from 'react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Button } from '@/components/ui/button'

import {
  DisplayMode,
  getMergedSettings,
  getSyncSettings,
  setSyncSettings,
  Settings,
} from '@/lib/settings'
import { toast } from 'sonner'
import { FaDiscord } from 'react-icons/fa'
import { ExternalLink } from 'lucide-react'
import { langs, ToLang } from '../../../lib/translate/lang'
import { testOpenAIConnection } from '@/lib/translate/openai'

export function OptionsForm() {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [error, setError] = useState<Error | null>(null)

  if (!settings && !error) {
    getMergedSettings().then(setSettings).catch(setError)
  }

  const updateSetting = (updates: Partial<Settings>) => {
    setSettings((prev) => (prev ? { ...prev, ...updates } : prev))
    getSyncSettings().then((syncSettings) => {
      setSyncSettings({ ...syncSettings, ...updates }).catch((error) => {
        toast.error('Failed to save settings')
        console.error(error)
      })
    })
  }

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-destructive">
          Error loading settings: {error.message}
        </div>
      </div>
    )
  }

  if (!settings) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-muted-foreground">Loading settings...</div>
      </div>
    )
  }

  const currentEngine = settings.engine ?? 'google'

  return (
    <div className="mx-auto max-w-md p-4 space-y-6">
      <header className="flex items-center justify-between">
        <div className="space-y-1">
          <h1 className="text-3xl font-bold tracking-tight">BilingualTube</h1>
          <a
            href="https://store.rxliuli.com/"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-primary transition-colors"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            Explore our other extensions
          </a>
        </div>
        <a
          href="https://discord.gg/gFhKUthc88"
          target="_blank"
          rel="noreferrer"
        >
          <Button variant="outline" size="icon" aria-label="Join Discord">
            <FaDiscord className="h-5 w-5 text-blue-500" />
          </Button>
        </a>
      </header>

      <form className="grid gap-6" onSubmit={(e) => e.preventDefault()}>
        {/* Target Language - Always visible */}
        <div className="space-y-2">
          <Label htmlFor="to">Target Language</Label>
          <NativeSelect
            id="to"
            value={settings.to || 'en'}
            onChange={(e) => updateSetting({ to: e.target.value as ToLang })}
          >
            {Object.entries(langs)
              .filter(([code]) => code !== 'auto')
              .sort(([, nameA], [, nameB]) => nameA.localeCompare(nameB))
              .map(([code, name]) => (
                <NativeSelectOption key={code} value={code}>
                  {name}
                </NativeSelectOption>
              ))}
          </NativeSelect>
        </div>

        {/* Subtitle Display - Always visible */}
        <div className="space-y-2">
          <Label htmlFor="displayMode">Subtitle Display</Label>
          <NativeSelect
            id="displayMode"
            value={settings.displayMode ?? 'bilingual'}
            onChange={(e) =>
              updateSetting({ displayMode: e.target.value as DisplayMode })
            }
          >
            <NativeSelectOption value="bilingual">
              Original + Translation
            </NativeSelectOption>
            <NativeSelectOption value="translation-only">
              Translation only
            </NativeSelectOption>
          </NativeSelect>
        </div>

        {/* Engine - Always visible */}
        <div className="space-y-2">
          <Label htmlFor="engine">Engine</Label>
          <NativeSelect
            id="engine"
            value={currentEngine}
            onChange={(e) =>
              updateSetting({
                engine: e.target.value as 'microsoft' | 'google' | 'openai',
              })
            }
          >
            <NativeSelectOption value="google">Google</NativeSelectOption>
            <NativeSelectOption value="microsoft">Microsoft</NativeSelectOption>
            <NativeSelectOption value="openai">OpenAI</NativeSelectOption>
          </NativeSelect>
        </div>

        {/* OpenAI-specific fields - Only visible when engine is 'openai' */}
        {currentEngine === 'openai' && (
          <>
            <div className="space-y-2">
              <Label htmlFor="openai-api-key">OpenAI API Key</Label>
              <Input
                id="openai-api-key"
                type="password"
                placeholder="sk-..."
                value={settings['openai.apiKey'] || ''}
                onChange={(e) =>
                  updateSetting({ 'openai.apiKey': e.target.value })
                }
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="openai-model">OpenAI Model</Label>
              <Input
                id="openai-model"
                type="text"
                placeholder="gpt-4o-mini"
                value={settings['openai.model'] || ''}
                onChange={(e) =>
                  updateSetting({ 'openai.model': e.target.value })
                }
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="openai-base-url">OpenAI Base URL</Label>
              <Input
                id="openai-base-url"
                type="url"
                placeholder="https://api.openai.com/v1"
                value={settings['openai.baseUrl'] || ''}
                onChange={(e) =>
                  updateSetting({ 'openai.baseUrl': e.target.value })
                }
              />
            </div>

            <TestConnectionButton settings={settings} />
          </>
        )}
      </form>
    </div>
  )
}

function TestConnectionButton({ settings }: { settings: Settings }) {
  const [testing, setTesting] = useState(false)

  async function handleTest() {
    setTesting(true)
    try {
      await testOpenAIConnection({
        apiKey: settings['openai.apiKey'],
        baseUrl: settings['openai.baseUrl'],
        model: settings['openai.model'],
      })
      toast.success('Connection successful!')
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      toast.error('Connection failed: ' + message)
    } finally {
      setTesting(false)
    }
  }

  return (
    <Button type="button" variant="outline" onClick={handleTest} disabled={testing}>
      {testing ? 'Testing...' : 'Test Connection'}
    </Button>
  )
}
