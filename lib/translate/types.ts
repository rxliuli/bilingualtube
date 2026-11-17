import type { Settings } from '../settings'
import type { ToLang } from './lang'

export interface Translator {
  name: Settings['engine']
  translate: (texts: string[], to: ToLang) => Promise<string[]>
}
