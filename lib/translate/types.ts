import { Settings } from '../settings'
import { ToLang } from './lang'

export interface Translator {
  name: Settings['engine']
  translate: (texts: string[], to: ToLang) => Promise<string[]>
}
