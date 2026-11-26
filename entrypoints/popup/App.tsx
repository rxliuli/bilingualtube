import { useEffect, useState } from 'react'
import { browser } from 'wxt/browser'
import { getMergedSettings, setEnabled } from '@/lib/settings'

export function App() {
  const [enabled, updateEnabled] = useState(true)
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
      <h1>BilingualTube</h1>

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

      <button
        className="settings-button"
        type="button"
        onClick={() => {
          void openSettings()
        }}
      >
        <span aria-hidden="true">⚙</span>
        Settings
      </button>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </main>
  )
}
