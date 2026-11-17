import { describe, it, expect } from 'vitest'
import { decodeHtmlEntities } from './html-entities'

describe('decodeHtmlEntities', () => {
  it('decodes the &gt; pair the LLM emits for subtitle arrows', () => {
    expect(decodeHtmlEntities('&gt;&gt; [laughter]')).toBe('>> [laughter]')
    expect(decodeHtmlEntities('&gt;&gt; [笑声]')).toBe('>> [笑声]')
  })

  it('decodes the named entities used by providers', () => {
    expect(decodeHtmlEntities('a &amp; b')).toBe('a & b')
    expect(decodeHtmlEntities('&quot;quoted&quot;')).toBe('"quoted"')
    expect(decodeHtmlEntities('&lt;tag&gt;')).toBe('<tag>')
    expect(decodeHtmlEntities("it&apos;s")).toBe("it's")
    expect(decodeHtmlEntities('a&nbsp;b')).toBe('a\u00a0b')
  })

  it('decodes decimal and hexadecimal numeric entities', () => {
    expect(decodeHtmlEntities('it&#39;s')).toBe("it's")
    expect(decodeHtmlEntities('&#x1F600;')).toBe('😀')
    expect(decodeHtmlEntities('&#X1F600;')).toBe('😀')
  })

  it('leaves unknown named entities untouched', () => {
    expect(decodeHtmlEntities('&foo;')).toBe('&foo;')
    expect(decodeHtmlEntities('&unknown123;')).toBe('&unknown123;')
    expect(decodeHtmlEntities('100% &euro;5')).toBe('100% &euro;5')
  })

  it('leaves out-of-range numeric entities untouched', () => {
    expect(decodeHtmlEntities('&#x110000;')).toBe('&#x110000;')
  })

  it('returns strings without entities unchanged', () => {
    expect(decodeHtmlEntities('[laughter] 笑声')).toBe('[laughter] 笑声')
    expect(decodeHtmlEntities('')).toBe('')
    expect(decodeHtmlEntities('>> a & b')).toBe('>> a & b')
  })

  it('decodes exactly one layer', () => {
    expect(decodeHtmlEntities('&amp;gt;')).toBe('&gt;')
    expect(decodeHtmlEntities('&amp;amp;')).toBe('&amp;')
  })
})
