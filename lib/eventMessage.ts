import { defineCustomEventMessaging } from '@webext-core/messaging/page'
import { Settings } from './settings'

export const eventMessager = defineCustomEventMessaging<{
  translate(texts: string[]): Promise<string[]>
  getSettings(): Promise<Settings>
}>({
  namespace: 'bilingual-tube-event-message',
})
