import { beforeEach, describe, expect, it } from 'vitest'
import { openai } from './openai'
import { Translator } from './types'

describe('translate/openai', () => {
  let translator: Translator
  beforeEach(() => {
    translator = openai({
      apiKey: import.meta.env.VITE_OPENAI_API_KEY,
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4.1-mini',
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
  it('should translate 10 texts correctly', async () => {
    const texts = [
      'And what is the way that one becomes a powerful unicorn?',
      '>> Work hard, learn, and use your skills to better Equestria.',
      '>> And how do these help you to learn magic?',
      '>> I want to be strong enough to stop windos and help ponies.',
      ">> That's just a story we tell little ponies.",
      'Real magic takes time to learn.',
      "It's your choice.",
      'Spend your time learning to become a powerful unicorn or play with your toys and make nothing',
      'of yourself.',
      '>> Then some distress careless standing there.',
    ]
    const result = await translator.translate(texts, 'ja')
    expect(result.length).toBe(10)
    expect(result).length(texts.length)
  })
})
