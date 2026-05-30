import { Translator } from './types'

// Chrome's internal shared key for the translate-pa endpoint (ported from
// imp-translate). Same key/endpoint Chrome's built-in translation uses.
const GOOGLE_TRANSLATE_HTML_KEY = 'AIzaSyATBXajvzQLTDHEQbcpq0Ihe0vWDHmO520'

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
}

function decodeHTML(input: string): string {
  return input.replace(
    /&(#[xX][0-9a-fA-F]+|#[0-9]+|[a-zA-Z][a-zA-Z0-9]*);/g,
    (match, body: string) => {
      if (body[0] === '#') {
        const code =
          body[1] === 'x' || body[1] === 'X'
            ? parseInt(body.slice(2), 16)
            : parseInt(body.slice(1), 10)
        if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return match
        try {
          return String.fromCodePoint(code)
        } catch {
          return match
        }
      }
      return NAMED_ENTITIES[body] ?? match
    },
  )
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// Google's web endpoint expects zh-CN / zh-TW, not BCP 47 zh-Hans / zh-Hant.
function toGoogleLang(to: string): string {
  if (to === 'zh-Hans') return 'zh-CN'
  if (to === 'zh-Hant') return 'zh-TW'
  return to
}

async function translateGoogle(
  texts: string[],
  targetLang: string,
): Promise<string[]> {
  const escaped = texts.map(escapeHtml)
  const resp = await fetch(
    'https://translate-pa.googleapis.com/v1/translateHtml',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json+protobuf',
        'X-Goog-API-Key': GOOGLE_TRANSLATE_HTML_KEY,
      },
      body: JSON.stringify([[escaped, 'auto', targetLang], 'te_lib']),
    },
  )
  if (!resp.ok) {
    throw new Error(`Google translate failed: ${resp.status}`)
  }
  const data = await resp.json()
  const translated = data[0] as string[]
  return translated.map((t) => decodeHTML(t))
}

export function google(): Translator {
  return {
    name: 'google',
    async translate(texts, to) {
      if (texts.length === 0) return []
      return translateGoogle(texts, toGoogleLang(to))
    },
  }
}
