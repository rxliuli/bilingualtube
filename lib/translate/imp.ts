import { Translator } from './types'
import { IMP_API_BASE } from '@/lib/imp'

// Error that carries the HTTP status so callers can humanize it (e.g. the
// options page's connection check) without re-parsing the message.
export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

// Map a thrown error (or status) to something a user can act on. Falls back
// to the original message for non-Imp errors so it's safe to wrap the whole
// translate path.
export function humanizeImpError(error: unknown): string {
  if (error instanceof ApiError) {
    const status = error.status
    if (status === 401) {
      return 'Imp Credits: session expired — reconnect in the extension settings'
    }
    if (status === 402) {
      return 'Imp Credits: balance too low — top up on imp.rxliuli.com'
    }
    if (status === 413) {
      return 'Imp Credits: too many segments for one request'
    }
    if (status === 429) {
      return 'Imp Credits: rate limited — try again shortly'
    }
    if (status >= 500) {
      return 'Imp Credits: server error — try again shortly'
    }
    return `Imp Credits: request failed (${status})`
  }
  return error instanceof Error ? error.message : String(error)
}

export interface ImpConfig {
  apiKey?: string
}

// The /api/v1/translate endpoint is already a 1:1 batch API: send texts, get
// the same number back. The server owns the prompt, source-language
// detection, chunking, and cardinality — the client sends only { to, texts }
// and never a model or prompt.
export function imp(options: ImpConfig): Translator {
  return {
    name: 'imp',
    async translate(texts, to) {
      if (texts.length === 0) return []
      if (!options.apiKey) {
        throw new Error(
          'Imp Credits is not connected — connect it in the extension settings',
        )
      }

      const resp = await fetch(`${IMP_API_BASE}/translate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${options.apiKey}`,
        },
        body: JSON.stringify({ to, texts }),
      })
      if (!resp.ok) {
        throw new ApiError(resp.status, await resp.text())
      }
      const data = await resp.json()
      return data.texts as string[]
    },
  }
}
