import { defineCustomEventMessaging } from '@webext-core/messaging/page'
import type { Settings } from './settings'

export const eventMessager = defineCustomEventMessaging<{
  translate(texts: string[]): Promise<string[]>
  getSettings(): Promise<Settings>
  getPunctuationOptions(): {
    wasmUrl: string
    sherpaModelPath: string
    sherpaVocabPath: string
  }
}>({
  namespace: 'bilingual-tube-event-message',
})
