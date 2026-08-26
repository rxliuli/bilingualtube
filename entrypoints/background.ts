import { checkConnection, exchangeCode, humanizeError } from '@rxliuli/imp-credits-sdk'
import { messager, ConnectionCheckResult } from '@/lib/message'
import {
  getMergedSettings,
  getSyncSettings,
  setSyncSettings,
  Settings,
} from '@/lib/settings'
import { microsoft } from '@/lib/translate/microsoft'
import { google } from '@/lib/translate/google'
import { openai } from '@/lib/translate/openai'
import { ApiError, humanizeImpError, imp } from '@/lib/translate/imp'
import { IMP_API_BASE, IMP_ORIGIN } from '@/lib/imp'
import { getCached, setCached, evictOldEntries } from '@/lib/cache'

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
      uncachedTexts.push(texts[i])
    }
  }

  if (uncachedTexts.length === 0) {
    return results
  }

  const translator = getTranslator(settings)
  let translated: string[]
  try {
    translated = await translator.translate(uncachedTexts, targetLang)
  } catch (error) {
    // humanizeImpError passes non-Imp errors through unchanged, so this is
    // safe to wrap the whole path; Imp 401/402/413/429 become actionable.
    throw new Error(humanizeImpError(error))
  }

  for (let i = 0; i < uncachedIndices.length; i++) {
    const originalIndex = uncachedIndices[i]
    const translatedText = translated[i]
    results[originalIndex] = translatedText

    const originalText = uncachedTexts[i]
    if (originalText) {
      await setCached(engine, targetLang, originalText, translatedText)
    }
  }

  evictOldEntries()

  return results
}

export default defineBackground(() => {
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

  browser.action.onClicked.addListener(async () => {
    await browser.runtime.openOptionsPage()
  })
})
