import { defineExtensionMessaging } from '@webext-core/messaging'
import { Settings } from './settings'
import { TimedToken } from './subtitles/PunctuationRestorationModel'

// Result of validating the stored Imp key without calling the model (401 ==
// revoked/expired), so the options-page Connected badge is honest.
export type ConnectionCheckResult =
  | { ok: true }
  | { ok: false; error: string }

export const messager = defineExtensionMessaging<{
  translate(texts: string[]): Promise<string[]>
  getSettings(): Promise<Settings>

  // imp-connect content script => background: exchange the one-time code.
  impConnect(code: string): Promise<{ ok: boolean; error?: string }>

  // options page => background: validate the stored Imp key via /me.
  checkConnection(): Promise<ConnectionCheckResult>
}>()
