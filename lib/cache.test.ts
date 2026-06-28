import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { getCached, setCached, evictOldEntries, clearCache } from './cache'

describe('cache', () => {
  beforeEach(async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2025-01-01'))
    await clearCache()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should return undefined for uncached text', async () => {
    expect(await getCached('openai', 'zh', 'hello')).toBeUndefined()
  })

  it('should return cached translation', async () => {
    await setCached('openai', 'zh', 'hello', '你好')
    expect(await getCached('openai', 'zh', 'hello')).toBe('你好')
  })

  it('should separate cache by engine', async () => {
    await setCached('openai', 'zh', 'hello', '你好-openai')
    await setCached('microsoft', 'zh', 'hello', '你好-microsoft')
    expect(await getCached('openai', 'zh', 'hello')).toBe('你好-openai')
    expect(await getCached('microsoft', 'zh', 'hello')).toBe('你好-microsoft')
  })

  it('should separate cache by target language', async () => {
    await setCached('openai', 'zh', 'hello', '你好')
    await setCached('openai', 'ja', 'hello', 'こんにちは')
    expect(await getCached('openai', 'zh', 'hello')).toBe('你好')
    expect(await getCached('openai', 'ja', 'hello')).toBe('こんにちは')
  })

  it('should return undefined for expired entries', async () => {
    await setCached('openai', 'zh', 'hello', '你好')
    vi.advanceTimersByTime(31 * 24 * 60 * 60 * 1000)
    expect(await getCached('openai', 'zh', 'hello')).toBeUndefined()
  })

  it('should evict expired entries', async () => {
    await setCached('openai', 'zh', 'old1', '旧1')
    await setCached('openai', 'zh', 'old2', '旧2')

    vi.advanceTimersByTime(31 * 24 * 60 * 60 * 1000)
    await setCached('openai', 'zh', 'new1', '新1')

    await evictOldEntries()

    expect(await getCached('openai', 'zh', 'old1')).toBeUndefined()
    expect(await getCached('openai', 'zh', 'old2')).toBeUndefined()
    expect(await getCached('openai', 'zh', 'new1')).toBe('新1')
  })

  it('should keep fresh entries when evicting', async () => {
    await setCached('openai', 'zh', 'a', '甲')
    await setCached('openai', 'zh', 'b', '乙')
    await evictOldEntries()
    expect(await getCached('openai', 'zh', 'a')).toBe('甲')
    expect(await getCached('openai', 'zh', 'b')).toBe('乙')
  })
})
