import { Translator } from '../types'
import { translateMicrosoft } from './microsoft'

export function microsoft(): Translator {
  return {
    name: 'microsoft',
    async translate(texts, to) {
      return translateMicrosoft(texts, to)
    },
  }
}
