import { describe, it, expect } from 'vitest'
import { normalizeLanguageCode } from './lang'

describe('normalizeLanguageCode', () => {
  it('should normalize simplified Chinese variants to zh-Hans', () => {
    expect(normalizeLanguageCode('zh-CN')).eq('zh-Hans')
    expect(normalizeLanguageCode('zh-cn')).eq('zh-Hans')
    expect(normalizeLanguageCode('zh-Hans')).eq('zh-Hans')
    expect(normalizeLanguageCode('zh-hans')).eq('zh-Hans')
    expect(normalizeLanguageCode('zh-Hans-CN')).eq('zh-Hans')
    expect(normalizeLanguageCode('zh-SG')).eq('zh-Hans')
  })

  it('should normalize traditional Chinese variants to zh-Hant', () => {
    expect(normalizeLanguageCode('zh-TW')).eq('zh-Hant')
    expect(normalizeLanguageCode('zh-tw')).eq('zh-Hant')
    expect(normalizeLanguageCode('zh-Hant')).eq('zh-Hant')
    expect(normalizeLanguageCode('zh-hant')).eq('zh-Hant')
    expect(normalizeLanguageCode('zh-Hant-TW')).eq('zh-Hant')
    expect(normalizeLanguageCode('zh-HK')).eq('zh-Hant')
    expect(normalizeLanguageCode('zh-MO')).eq('zh-Hant')
  })

  it('should normalize Hebrew legacy code', () => {
    expect(normalizeLanguageCode('iw')).eq('he')
    expect(normalizeLanguageCode('he')).eq('he')
  })

  it('should extract base language code for other languages', () => {
    expect(normalizeLanguageCode('en')).eq('en')
    expect(normalizeLanguageCode('en-US')).eq('en')
    expect(normalizeLanguageCode('en-GB')).eq('en')
    expect(normalizeLanguageCode('fr-FR')).eq('fr')
    expect(normalizeLanguageCode('ja')).eq('ja')
  })

  it('should handle case insensitivity', () => {
    expect(normalizeLanguageCode('EN')).eq('en')
    expect(normalizeLanguageCode('En-Us')).eq('en')
    expect(normalizeLanguageCode('ZH-HANS')).eq('zh-Hans')
  })

  it('should handle whitespace', () => {
    expect(normalizeLanguageCode(' en ')).eq('en')
    expect(normalizeLanguageCode(' zh-Hans ')).eq('zh-Hans')
  })
})

describe('language code comparison scenarios', () => {
  it('should correctly identify same language despite different formats', () => {
    // YouTube (zh-Hans) vs Settings (zh-CN)
    expect(normalizeLanguageCode('zh-Hans')).eq(
      normalizeLanguageCode('zh-CN'),
    )

    // YouTube (zh-Hant) vs Settings (zh-TW)
    expect(normalizeLanguageCode('zh-Hant')).eq(
      normalizeLanguageCode('zh-TW'),
    )

    // YouTube (en-US) vs Settings (en)
    expect(normalizeLanguageCode('en-US')).eq(normalizeLanguageCode('en'))
  })

  it('should correctly identify different Chinese variants', () => {
    expect(normalizeLanguageCode('zh-Hans')).not.eq(
      normalizeLanguageCode('zh-Hant'),
    )
    expect(normalizeLanguageCode('zh-CN')).not.eq(
      normalizeLanguageCode('zh-TW'),
    )
  })
})

describe('Chinese variant conversion detection', () => {
  it('should detect simplified to traditional conversion', () => {
    const source = normalizeLanguageCode('zh-Hans')
    const target = normalizeLanguageCode('zh-TW')
    const chineseVariants = ['zh-Hans', 'zh-Hant']

    const isConversion =
      chineseVariants.includes(source) &&
      chineseVariants.includes(target) &&
      source !== target

    expect(isConversion).eq(true)
  })

  it('should detect traditional to simplified conversion', () => {
    const source = normalizeLanguageCode('zh-Hant')
    const target = normalizeLanguageCode('zh-CN')
    const chineseVariants = ['zh-Hans', 'zh-Hant']

    const isConversion =
      chineseVariants.includes(source) &&
      chineseVariants.includes(target) &&
      source !== target

    expect(isConversion).eq(true)
  })

  it('should not detect conversion for same variant', () => {
    const source = normalizeLanguageCode('zh-Hans')
    const target = normalizeLanguageCode('zh-CN')
    const chineseVariants = ['zh-Hans', 'zh-Hant']

    const isConversion =
      chineseVariants.includes(source) &&
      chineseVariants.includes(target) &&
      source !== target

    expect(isConversion).eq(false)
  })

  it('should not detect conversion for non-Chinese languages', () => {
    const source = normalizeLanguageCode('en')
    const target = normalizeLanguageCode('zh-Hans')
    const chineseVariants = ['zh-Hans', 'zh-Hant']

    const isConversion =
      chineseVariants.includes(source) &&
      chineseVariants.includes(target) &&
      source !== target

    expect(isConversion).eq(false)
  })
})
