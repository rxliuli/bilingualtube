import { useEffect, useState } from 'react'
import { browser } from 'wxt/browser'
import {
  getMergedSettings,
  setEnabled,
  setTargetLanguage,
} from '@/lib/settings'
import { Settings as SettingsIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  NativeSelect,
  NativeSelectOption,
} from '@/components/ui/native-select'
import { Label } from '@/components/ui/label'
import { langs, type ToLang } from '@/lib/translate/lang'

export function App() {
  const [enabled, updateEnabled] = useState(true)
  const [targetLanguage, updateTargetLanguage] = useState<ToLang>('en')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true

    async function loadSettings() {
      try {
        const settings = await getMergedSettings()

        if (active) {
          updateEnabled(settings.enabled ?? true)
updateTargetLanguage(settings.to ?? 'en')
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
      updateEnabled(nextEnabled)
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
    updateTargetLanguage(nextLanguage)
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
    <main className="popup">
      <header className="popup-header">
  <div className="popup-brand">
    <img
      src={browser.runtime.getURL('/icon/48.png')}
      alt=""
      width={28}
      height={28}
    />
    <h1>BilingualTube</h1>
  </div>

  <Button
    className="settings-button"
    variant="ghost"
    size="icon"
    type="button"
    aria-label="Settings"
    title="Settings"
    onClick={() => {
      void openSettings()
    }}
  >
    <SettingsIcon size={20} aria-hidden="true" />
  </Button>
</header>

      <section className="toggle-section">
        <label className="toggle-row">
          <span>Enable bilingual subtitles</span>

          <input
            className="switch"
            type="checkbox"
            role="switch"
            checked={enabled}
            disabled={loading || saving}
            onChange={(event) => {
              void handleToggle(event.currentTarget.checked)
            }}
          />
        </label>

        <p className="hint">Applies to all YouTube tabs.</p>
      </section>

<div className="language-section">
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
      
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </main>
  )
}
