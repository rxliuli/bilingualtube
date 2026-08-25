import { OptionalKeysOf } from 'type-fest'
import { DefaultLLMPrompt } from './translate/openai'
import { type ToLang } from './translate/lang'

export type DisplayMode = 'bilingual' | 'translation-only'

export interface Settings {
  to?: ToLang
  engine?: 'microsoft' | 'google' | 'openai' | 'imp'
  displayMode?: DisplayMode

  'openai.apiKey'?: string
  'openai.model'?: string
  'openai.baseUrl'?: string
  'openai.prompt'?: string

  // Imp Credits connection, filled in automatically by the connect flow.
  // Only the api key is persisted — the service's origin and API base are
  // constants (lib/imp.ts), and the model is server-authoritative so it is
  // never stored (lib/translate/imp.ts never sends one).
  'imp.apiKey'?: string
}

export function getDefaultSettings(): Pick<Settings, OptionalKeysOf<Settings>> {
  return {
    to: 'en',
    engine: 'google',
    displayMode: 'bilingual',
    'openai.baseUrl': 'https://api.openai.com/v1',
    'openai.prompt': DefaultLLMPrompt,
    'openai.model': 'gpt-4o-mini',
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
