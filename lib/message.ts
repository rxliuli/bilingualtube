import { defineExtensionMessaging } from '@webext-core/messaging'
import { Settings } from './settings'

export const messager = defineExtensionMessaging<{
  translate(texts: string[]): Promise<string[]>
  getSettings(): Promise<Settings>
}>()
