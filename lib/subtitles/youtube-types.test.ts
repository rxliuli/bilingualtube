import { describe, expect, it } from 'vitest'

describe('subtitle types', () => {
  it('Should compile subtitle types correctly', async () => {
    const data = (await import('../../entrypoints/content/subtitles/assets/timedtext.json')).default
    expect(data.events.length).toBeGreaterThan(0)
  })
})
