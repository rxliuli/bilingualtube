import { messager } from '@/lib/message'
import { getMergedSettings, Settings } from '@/lib/settings'
import { microsoft } from '@/lib/translate/microsoft'
import { google } from '@/lib/translate/google'
import { openai } from '@/lib/translate/openai'
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
  const translated = await translator.translate(uncachedTexts, targetLang)

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
  browser.action.onClicked.addListener(async () => {
    await browser.runtime.openOptionsPage()
  })
})
