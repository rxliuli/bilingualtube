import { Translator } from '../types'
import { translate } from './microsoft'

export function microsoft(): Translator {
  return {
    name: 'microsoft',
    async translate(text, to) {
      const r = await translate(text, to)
      return r.map((it) => it.translations[0].text)
    },
  }
}
