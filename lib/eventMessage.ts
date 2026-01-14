import { defineCustomEventMessaging } from '@webext-core/messaging/page'
import { Settings } from './settings'
import { TimedToken } from './subtitles/punctuationRestoration'

export const eventMessager = defineCustomEventMessaging<{
  translate(texts: string[]): Promise<string[]>
  getSettings(): Promise<Settings>
  getPunctuationOptions(): {
    wasmUrl: string
    sherpaModelPath: string
    sherpaVocabPath: string
  }
  restorePunctuationInSubtitles(tokens: TimedToken[]): Promise<TimedToken[]>
}>({
  namespace: 'bilingual-tube-event-message',
})
