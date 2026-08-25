import { describe, it, expect, vi, beforeEach } from 'vitest'
import { imp, ApiError, humanizeImpError } from './imp'

const IMP_API_BASE = 'https://imp.rxliuli.com/api/v1'

function setupFetch(): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function okResponse(texts: string[]) {
  return { ok: true, json: async () => ({ texts, from: 'auto', usage: {} }) }
}

describe('imp', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.restoreAllMocks()
  })

  it('posts a batch and returns the translated texts 1:1', async () => {
    const fetchMock = setupFetch()
    fetchMock.mockResolvedValue(okResponse(['Hola', 'Mundo']))

    const result = await imp({ apiKey: 'test-key' }).translate(
      ['Hello', 'World'],
      'es',
    )

    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ]
    expect(url).toBe(`${IMP_API_BASE}/translate`)
    expect(JSON.parse(init.body as string)).toEqual({
      to: 'es',
      texts: ['Hello', 'World'],
    })
    expect((init.headers as Record<string, string>).Authorization).toBe(
      'Bearer test-key',
    )
    expect(result).toEqual(['Hola', 'Mundo'])
  })

  it('passes BCP 47 language codes through untouched', async () => {
    const fetchMock = setupFetch()
    fetchMock.mockResolvedValue(okResponse(['你好']))

    await imp({ apiKey: 'k' }).translate(['Hello'], 'zh-Hans')
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]

    expect(JSON.parse(init.body as string)).toEqual({
      to: 'zh-Hans',
      texts: ['Hello'],
    })
  })

  it('returns [] for empty input without requesting', async () => {
    const fetchMock = setupFetch()
    const result = await imp({ apiKey: 'k' }).translate([], 'es')

    expect(result).toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('throws a clear message when not connected', async () => {
    const fetchMock = setupFetch()
    await expect(imp({}).translate(['Hello'], 'es')).rejects.toThrow(
      'Imp Credits is not connected',
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('throws an ApiError carrying the status on a non-ok response', async () => {
    const fetchMock = setupFetch()
    fetchMock.mockResolvedValue({
      ok: false,
      status: 429,
      text: async () => 'x',
    })

    let caught: unknown
    try {
      await imp({ apiKey: 'k' }).translate(['Hello'], 'es')
    } catch (e) {
      caught = e
    }
    expect(caught).toBeInstanceOf(ApiError)
    expect((caught as ApiError).status).toBe(429)
  })
})

describe('humanizeImpError', () => {
  it('maps 401 to a reconnect message', () => {
    expect(humanizeImpError(new ApiError(401, ''))).toContain('reconnect')
  })
  it('maps 402 to a top-up message', () => {
    expect(humanizeImpError(new ApiError(402, ''))).toContain('top up')
  })
  it('maps 429 to a rate-limit message', () => {
    expect(humanizeImpError(new ApiError(429, ''))).toContain('rate limited')
  })
  it('maps 5xx to a server-error message', () => {
    expect(humanizeImpError(new ApiError(503, ''))).toContain('server error')
  })
  it('passes non-Imp errors through unchanged', () => {
    expect(humanizeImpError(new Error('Google failed: 429'))).toBe(
      'Google failed: 429',
    )
  })
})
