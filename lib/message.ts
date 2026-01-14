import { defineExtensionMessaging } from '@webext-core/messaging'
import { Settings } from './settings'
import { TimedToken } from './subtitles/punctuationRestoration'

export const messager = defineExtensionMessaging<{
  translate(texts: string[]): Promise<string[]>
  getSettings(): Promise<Settings>
}>()
