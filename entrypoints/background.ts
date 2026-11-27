import { checkConnection, exchangeCode, humanizeError } from '@rxliuli/imp-credits-sdk'
import { messager, type ConnectionCheckResult } from '@/lib/message'
import {
  getMergedSettings,
  getSyncSettings,
  setSyncSettings,
  type Settings,
} from '@/lib/settings'
import { microsoft } from '@/lib/translate/microsoft'
import { google } from '@/lib/translate/google'
import { openai } from '@/lib/translate/openai'
import { humanizeImpError, imp } from '@/lib/translate/imp'
import { createTranslationGate } from '@/lib/translate/backoff'
import { IMP_API_BASE, IMP_ORIGIN } from '@/lib/imp'
import { getCached, setCached, evictOldEntries } from '@/lib/cache'

// Shared across all YouTube tabs so a 401/402/429 in one tab never lets other
// tabs (or rapid video switches) keep hammering the backend.
const translationGate = createTranslationGate({ balanceMode: 'cooldown' })

function settingsGateKey(settings: Settings): string {
  return [
    settings.engine ?? '',
    settings['imp.apiKey'] ?? '',
    settings['openai.apiKey'] ?? '',
    settings['openai.baseUrl'] ?? '',
  ].join('\0')
}

function getTranslator(settings: Settings) {
  const list = [
    microsoft(),
    google(),
    openai({
      apiKey: settings['openai.apiKey'],
      baseUrl: settings['openai.baseUrl'],
      model: settings['openai.model'],
      prompt: settings['openai.prompt'],
    }),
    imp({ apiKey: settings['imp.apiKey'] }),
  ]
  const translator = list.find(
    (translator) => translator.name === settings.engine,
  )
  if (!translator) {
    throw new Error(`Translator engine "${settings.engine}" is not supported.`)
  }
  return translator
}

async function translate(texts: string[]): Promise<string[]> {
  const settings = await getMergedSettings()

  if (settings.enabled === false) {
    return []
  }

  const targetLang = settings.to!
  const engine = settings.engine!

  const results: string[] = []
  const uncachedIndices: number[] = []
  const uncachedTexts: string[] = []

  for (let i = 0; i < texts.length; i++) {
    const text = texts[i]
    if (!text) continue

    const cached = await getCached(engine, targetLang, text)
    if (cached !== undefined) {
      results[i] = cached
    } else {
      uncachedIndices.push(i)
      uncachedTexts.push(text)
    }
  }

  if (uncachedTexts.length === 0) {
    return results
  }

  const gateKey = settingsGateKey(settings)
  if (!translationGate.canAttempt(gateKey)) {
    throw new Error(
      translationGate.lastErrorMessage() ?? 'Translation temporarily paused',
    )
  }

  const translator = getTranslator(settings)
  let translated: string[]
  try {
    translated = await translator.translate(uncachedTexts, targetLang)
    translationGate.recordSuccess()
  } catch (error) {
    // humanizeImpError passes non-Imp errors through unchanged, so this is
    // safe to wrap the whole path; Imp 401/402/413/429 become actionable.
    const message = humanizeImpError(error)
    translationGate.recordFailure(error, gateKey, message)
    throw new Error(message)
  }

  for (const [i, originalIndex] of uncachedIndices.entries()) {
    const translatedText = translated[i]
    const originalText = uncachedTexts[i]
    // A short translator result leaves its slot unset (readable as undefined by
    // the caller) instead of caching a missing translation.
    if (translatedText === undefined) continue
    results[originalIndex] = translatedText

    if (originalText) {
      await setCached(engine, targetLang, originalText, translatedText)
    }
  }

  evictOldEntries()

  return results
}

async function updateEnabledBadge(enabled?: boolean) {
  const isEnabled = enabled ?? (await getMergedSettings()).enabled !== false
  await browser.action.setBadgeText({
    text: isEnabled ? '' : 'OFF',
  })
  if (!isEnabled) {
    await browser.action.setBadgeBackgroundColor({ color: '#71717a' })
    // Safari doesn't implement action.setBadgeTextColor; guard with optional chaining.
    await browser.action.setBadgeTextColor?.({ color: '#FFFFFF' })
  }
}

export default defineBackground(() => {
  const refreshBadge = (enabled?: boolean) => {
    void updateEnabledBadge(enabled).catch((error) => {
      console.error('[BilingualTube] Failed to update badge:', error)
    })
  }

  browser.runtime.onStartup.addListener(() => refreshBadge())
  browser.runtime.onInstalled.addListener(() => refreshBadge())

  browser.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'sync' || !('settings' in changes)) return

    translationGate.reset()
    const nextSettings = changes.settings.newValue as Settings | undefined
    refreshBadge(nextSettings?.enabled !== false)
  })

  messager.onMessage('translate', (ev) => translate(ev.data))
  messager.onMessage('getSettings', getMergedSettings)

  messager.onMessage('impConnect', async (ev) => {
    try {
      // The SDK exchanges the one-time code for { apiKey, baseUrl, model };
      // only the api key is persisted (base/model derive from IMP_ORIGIN).
      const { apiKey } = await exchangeCode({ code: ev.data, origin: IMP_ORIGIN })
      // Persist the key and auto-select the Imp engine. Spread the current
      // stored settings (never persist the runtime defaults) so existing
      // OpenAI/provider settings are untouched.
      const settings = await getSyncSettings()
      await setSyncSettings({
        ...settings,
        engine: 'imp',
        'imp.apiKey': apiKey,
      })
      return { ok: true }
    } catch (error) {
      // Humanize in `imp` mode so a 400 (invalid/already-used code) and a
      // network error both become something the banner can say.
      return { ok: false, error: humanizeError(error, 'imp') }
    }
  })

  // Zero-cost status check for the options page: the stored Imp key is valid
  // iff GET {baseUrl}/me accepts it. The session cookie is excluded via
  // credentials: 'omit' — the check must reflect the KEY only, and /me
  // accepts session-OR-key, so a logged-in user's cookie would otherwise
  // make a revoked key still return 200 while real requests 401.
  messager.onMessage('checkConnection', async (): Promise<ConnectionCheckResult> => {
    const settings = await getMergedSettings()
    const apiKey = settings['imp.apiKey']
    if (!apiKey) {
      return { ok: false, error: 'not connected' }
    }
    try {
      // The SDK GETs {baseUrl}/me with credentials:'omit' — the status check
      // must reflect the KEY only, not a logged-in session cookie (which
      // would make a revoked key still return 200).
      return await checkConnection({ baseUrl: IMP_API_BASE, apiKey })
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  })

})
