import { OptionalKeysOf } from 'type-fest'
import { DefaultLLMPrompt } from './translate/openai'
import { type ToLang } from './translate/lang'

export interface Settings {
  to?: ToLang
  engine?: 'microsoft' | 'openai'

  'openai.apiKey'?: string
  'openai.model'?: string
  'openai.baseUrl'?: string
  'openai.prompt'?: string
}

export function getDefaultSettings(): Pick<Settings, OptionalKeysOf<Settings>> {
  return {
    to: 'en',
    engine: 'microsoft',
    'openai.baseUrl': 'https://api.openai.com/v1',
    'openai.prompt': DefaultLLMPrompt,
    'openai.model': 'gpt-4.1-mini',
  }
}

export async function getMergedSettings(): Promise<Settings> {
  return Object.freeze({
    ...getDefaultSettings(),
    ...(await getSyncSettings()),
  })
}

export async function getSyncSettings(): Promise<Settings> {
  return {
    ...(
      await browser.storage.sync.get<{
        settings: Settings
      }>(['settings'])
    ).settings,
  }
}

export async function setSyncSettings(settings: Settings) {
  await browser.storage.sync.set<{
    settings: Settings
  }>({ settings })
}
