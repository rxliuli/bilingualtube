import { beforeEach, describe, expect, it } from 'vitest'
import { Translator } from '../types'
import { microsoft } from '.'

describe.skip('translate/microsoft', () => {
  let translator: Translator
  beforeEach(() => {
    translator = microsoft()
  })
  it('should translate hello world', async () => {
    const result = await translator.translate(['Hello, world!'], 'es')
    expect(result[0].trim().toLowerCase()).eq('¡hola mundo!'.toLowerCase())
  })
  it('should return correct number of translations', async () => {
    const texts = ['Hello, world!', 'How are you?', 'Goodbye!']
    const result = await translator.translate(texts, 'fr')
    expect(result.length).eq(texts.length)
  })
})
