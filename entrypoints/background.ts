import { messager } from '@/lib/message'
import { getMergedSettings, Settings } from '@/lib/settings'
import { microsoft } from '@/lib/translate/microsoft'
import { openai } from '@/lib/translate/openai'
import { get, set } from 'idb-keyval'

function getTranslator(settings: Settings) {
  const list = [
    microsoft(),
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

function generateCacheKey(engine: string, to: string, text: string): string {
  return `${engine}-${to}-${text}`
}

async function translate(texts: string[]): Promise<string[]> {
  const settings = await getMergedSettings()
  const targetLang = settings.to!
  const engine = settings.engine!

  // Check cache for each text
  const results: string[] = []
  const uncachedIndices: number[] = []
  const uncachedTexts: string[] = []

  for (let i = 0; i < texts.length; i++) {
    const text = texts[i]
    if (!text) continue

    const cacheKey = generateCacheKey(engine, targetLang, text)
    const cached = await get<string>(cacheKey)
    if (cached !== undefined) {
      results[i] = cached
    } else {
      uncachedIndices.push(i)
      uncachedTexts.push(texts[i])
    }
  }

  // If all texts are cached, return early
  if (uncachedTexts.length === 0) {
    return results
  }

  // Translate uncached texts
  const translator = getTranslator(settings)
  const translated = await translator.translate(uncachedTexts, targetLang)

  // Cache the new translations and fill results
  for (let i = 0; i < uncachedIndices.length; i++) {
    const originalIndex = uncachedIndices[i]
    const translatedText = translated[i]
    results[originalIndex] = translatedText

    // Cache the translation
    const originalText = uncachedTexts[i]
    if (originalText) {
      const cacheKey = generateCacheKey(engine, targetLang, originalText)
      await set(cacheKey, translatedText)
    }
  }

  return results
}

export default defineBackground(() => {
  messager.onMessage('translate', (ev) => translate(ev.data))
  messager.onMessage('getSettings', getMergedSettings)
})
