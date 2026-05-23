import { defineCustomEventMessaging } from '@webext-core/messaging/page'
import type { Settings } from './settings'

export const eventMessager = defineCustomEventMessaging<{
  translate(texts: string[]): Promise<string[]>
  getSettings(): Promise<Settings>
  getPunctuationOptions(): {
    wasmUrl: string
    sherpaModelPath: string
    sherpaVocabPath: string
    cjkPunctModelPath: string
    cjkPunctVocabPath: string
  }
}>({
  namespace: 'bilingual-tube-event-message',
})
