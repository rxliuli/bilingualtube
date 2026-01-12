import { beforeEach, describe, expect, it } from 'vitest'
import { openai } from './openai'
import { Translator } from './types'

describe.skip('translate/openai', () => {
  let translator: Translator
  beforeEach(() => {
    translator = openai({
      apiKey: import.meta.env.VITE_OPENAI_API_KEY,
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini',
    })
  })
  it('should translate hello world', async () => {
    const result = await translator.translate(['Hello, world!'], 'es')
    expect(result[0].trim().toLowerCase()).eq('¡hola, mundo!'.toLowerCase())
  })
  it('should return correct number of translations', async () => {
    const texts = ['Hello, world!', 'How are you?', 'Goodbye!']
    const result = await translator.translate(texts, 'fr')
    expect(result.length).eq(texts.length)
  })
})
