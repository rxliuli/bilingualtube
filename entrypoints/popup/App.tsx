import { useEffect, useState } from 'react'
import { browser } from 'wxt/browser'
import { Settings as SettingsIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import {
  NativeSelect,
  NativeSelectOption,
} from '@/components/ui/native-select'
import { Switch } from '@/components/ui/switch'
import {
  getMergedSettings,
  setEnabled,
  setTargetLanguage,
} from '@/lib/settings'
import { langs, type ToLang } from '@/lib/translate/lang'

export function App() {
  const [enabled, setEnabledState] = useState(true)
  const [targetLanguage, setTargetLanguageState] = useState<ToLang>('en')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true

    async function loadSettings() {
      try {
        const settings = await getMergedSettings()
        if (active) {
          setEnabledState(settings.enabled ?? true)
          setTargetLanguageState(settings.to ?? 'en')
          setLoading(false)
        }
      } catch {
        if (active) {
          setError('Could not load settings. Please reopen this popup.')
        }
      }
    }

    void loadSettings()

    return () => {
      active = false
    }
  }, [])

  async function handleToggle(nextEnabled: boolean) {
    setSaving(true)
    setError('')
    try {
      await setEnabled(nextEnabled)
      setEnabledState(nextEnabled)
    } catch {
      setError('Could not save the change. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  async function handleLanguageChange(nextLanguage: ToLang) {
    setSaving(true)
    setError('')
    try {
      await setTargetLanguage(nextLanguage)
      setTargetLanguageState(nextLanguage)
    } catch {
      setError('Could not save the language. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  async function openSettings() {
    try {
      await browser.runtime.openOptionsPage()
      window.close()
    } catch {
      setError('Could not open settings. Please try again.')
    }
  }

  return (
    <main className="w-80 space-y-4 p-4">
      <header className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <img
            src={browser.runtime.getURL('/icon/48.png')}
            alt=""
            width={24}
            height={24}
            className="shrink-0"
          />
          <h1 className="text-base font-semibold tracking-tight">
            BilingualTube
          </h1>
        </div>

        <Button
          variant="ghost"
          size="icon-sm"
          type="button"
          aria-label="Settings"
          title="Settings"
          onClick={() => {
            void openSettings()
          }}
        >
          <SettingsIcon className="size-4" aria-hidden="true" />
        </Button>
      </header>

      <div className="space-y-4 border-t pt-4">
        <div className="flex items-center justify-between gap-4">
          <Label htmlFor="bilingual-enabled" className="cursor-pointer">
            Enable subtitles
          </Label>
          <Switch
            id="bilingual-enabled"
            checked={enabled}
            disabled={loading || saving}
            onCheckedChange={(checked) => {
              void handleToggle(checked)
            }}
          />
        </div>

        <div className="space-y-2 [&_[data-slot=native-select-wrapper]]:w-full">
          <Label htmlFor="target-language">Target Language</Label>
          <NativeSelect
            id="target-language"
            value={targetLanguage}
            disabled={loading || saving}
            onChange={(event) => {
              void handleLanguageChange(event.currentTarget.value as ToLang)
            }}
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
      </div>

      {error && (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      )}
    </main>
  )
}
