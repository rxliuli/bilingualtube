import { describe, it, expect, vi, beforeEach } from 'vitest'

const BING_PAGE = `
<html><body data-iid="translator.5023"><script>
var params_AbusePreventionHelper = [123456,"test-token",3600000];
_G={IG:"TESTIG123"};
</script></body></html>
`

function mockTranslateResponse(text: string) {
  return {
    ok: true,
    json: async () => [
      { translations: [{ text }], detectedLanguage: { language: 'en' } },
    ],
  }
}

function setupFetch(onTranslate: (body: URLSearchParams) => any) {
  const fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
  let pageCalls = 0
  let translateCalls = 0
  fetchMock.mockImplementation(async (url: string | URL, init?: RequestInit) => {
    if (url.toString() === 'https://www.bing.com/translator') {
      pageCalls++
      return { ok: true, text: async () => BING_PAGE }
    }
    translateCalls++
    return onTranslate(new URLSearchParams(init?.body as string))
  })
  return {
    fetchMock,
    getPageCalls: () => pageCalls,
    getTranslateCalls: () => translateCalls,
  }
}

// Echo-style mock: translates each line of the request to "[T] <line>"
function echoTranslate(body: URLSearchParams) {
  const text = body.get('text')!
  return mockTranslateResponse(
    text
      .split('\n')
      .map((l) => `[T] ${l}`)
      .join('\n'),
  )
}

describe('translateMicrosoft', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.restoreAllMocks()
  })

  it('joins a batch into one request and splits the result back', async () => {
    const { getTranslateCalls } = setupFetch(echoTranslate)

    const { translateMicrosoft } = await import('./microsoft')
    const result = await translateMicrosoft(['Hello', 'World', 'Bye'], 'es')

    expect(result).toEqual(['[T] Hello', '[T] World', '[T] Bye'])
    expect(getTranslateCalls()).toBe(1)
  })

  it('flattens cue-internal newlines so they cannot break alignment', async () => {
    let sent = ''
    setupFetch((body) => {
      sent = body.get('text')!
      return echoTranslate(body)
    })

    const { translateMicrosoft } = await import('./microsoft')
    const result = await translateMicrosoft(['Hello\nthere', 'World'], 'es')

    expect(sent).toBe('Hello there\nWorld')
    expect(result).toEqual(['[T] Hello there', '[T] World'])
  })

  it('falls back to per-line requests when the line count changes', async () => {
    let calls = 0
    setupFetch((body) => {
      calls++
      if (calls === 1) {
        // Simulate the translator merging the two lines into one
        return mockTranslateResponse('[merged]')
      }
      return echoTranslate(body)
    })

    const { translateMicrosoft } = await import('./microsoft')
    const result = await translateMicrosoft(['Hello', 'World'], 'es')

    expect(result).toEqual(['[T] Hello', '[T] World'])
    expect(calls).toBe(3)
  })

  it('maps language codes to Bing codes and passes BCP 47 codes through', async () => {
    const seen: string[] = []
    setupFetch((body) => {
      seen.push(body.get('to')!)
      return echoTranslate(body)
    })

    const { translateMicrosoft } = await import('./microsoft')
    await translateMicrosoft(['Hello'], 'tl')
    await translateMicrosoft(['Hello'], 'zh-Hans')

    expect(seen).toEqual(['fil', 'zh-Hans'])
  })

  it('reuses the cached session across calls', async () => {
    const { getPageCalls } = setupFetch(echoTranslate)

    const { translateMicrosoft } = await import('./microsoft')
    await translateMicrosoft(['first'], 'ja')
    await translateMicrosoft(['second'], 'ja')

    expect(getPageCalls()).toBe(1)
  })

  it('expired token response refreshes the session and retries once', async () => {
    let calls = 0
    const { getPageCalls } = setupFetch((body) => {
      calls++
      if (calls === 1) {
        return { ok: true, json: async () => ({ statusCode: 400 }) }
      }
      return echoTranslate(body)
    })

    const { translateMicrosoft } = await import('./microsoft')
    const result = await translateMicrosoft(['Hello'], 'ja')

    expect(result).toEqual(['[T] Hello'])
    expect(getPageCalls()).toBe(2)
  })

  it('empty input returns empty output without any request', async () => {
    const { fetchMock } = setupFetch(echoTranslate)

    const { translateMicrosoft } = await import('./microsoft')
    expect(await translateMicrosoft([], 'ja')).toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
