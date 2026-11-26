import { ApiError } from './imp'

export type TranslateErrorKind = 'auth' | 'balance' | 'rate-limit' | 'transient'

export interface ClassifiedTranslateError {
  kind: TranslateErrorKind
  message: string
  retryAfterMs?: number
}

const DEFAULT_BASE_DELAY_MS = 5_000
const DEFAULT_MAX_DELAY_MS = 60_000
const DEFAULT_RATE_LIMIT_DELAY_MS = 60_000
const DEFAULT_BALANCE_COOLDOWN_MS = 30_000
const DEFAULT_REPROBE_MIN_DELAY_MS = 30_000

/**
 * Classify a translation error from either the background (raw `ApiError`) or
 * a content script (serialized error message crossing extension messaging).
 */
export function classifyTranslateError(error: unknown): ClassifiedTranslateError {
  if (error instanceof ApiError) {
    if (error.status === 401 || error.status === 403) {
      return { kind: 'auth', message: error.message }
    }
    if (error.status === 402) {
      return { kind: 'balance', message: error.message }
    }
    if (error.status === 429) {
      return {
        kind: 'rate-limit',
        message: error.message,
        retryAfterMs: error.retryAfterMs,
      }
    }
    return { kind: 'transient', message: error.message }
  }

  const message = error instanceof Error ? error.message : String(error)
  if (/balance too low|insufficient (?:balance|credits)|\b402\b/i.test(message)) {
    return { kind: 'balance', message }
  }
  if (
    /session expired|not connected|api key is not set|base url is not set|is not supported|\b401\b|\b403\b/i.test(
      message,
    )
  ) {
    return { kind: 'auth', message }
  }
  if (/rate limit|\b429\b/i.test(message)) {
    return { kind: 'rate-limit', message }
  }
  return { kind: 'transient', message }
}

export interface TranslationGateOptions {
  now?: () => number
  /** Initial delay for transient failures (doubles per consecutive failure). */
  baseDelayMs?: number
  /** Upper bound for exponential backoff on transient failures. */
  maxDelayMs?: number
  /** Fallback cooldown for 429 when no Retry-After header is available. */
  rateLimitDelayMs?: number
  /**
   * How `balance` (402) failures are gated:
   * - `'halt'`: pause automatic retries until `reset()`, a `key` change, or
   *   `allowReprobe()` after `reprobeMinDelayMs` (used in the YouTube content
   *   script so playback never hammers the API).
   * - `'cooldown'`: block requests across all tabs for `balanceCooldownMs`
   *   before allowing a single probe (used in the background service worker).
   */
  balanceMode?: 'halt' | 'cooldown'
  balanceCooldownMs?: number
  reprobeMinDelayMs?: number
}

export interface TranslationGate {
  /** Whether a new translation attempt may run right now (auto-resets if `key` changed). */
  canAttempt(key?: string): boolean
  /** Clear failure counters and any active halt/cooldown. */
  recordSuccess(): void
  /** Record a failed attempt and return the classified error + delay applied. */
  recordFailure(
    error: unknown,
    key?: string,
    displayMessage?: string,
  ): ClassifiedTranslateError & { halted: boolean; delayMs: number }
  /**
   * Allow a single re-probe after a `balance` (402) halt once enough time has
   * elapsed (e.g. user returned to the tab after topping up). Returns true iff
   * the gate transitioned from halted to ready.
   */
  allowReprobe(): boolean
  /** Last recorded failure message, if currently gated. */
  lastErrorMessage(): string | null
  /** Unconditionally clear all backoff/halt state. */
  reset(): void
}

/**
 * Prevents `onVideoProgress` (~4x/sec) or multiple tabs from hammering the
 * translation endpoint after 401/402/429 or transient upstream errors.
 */
export function createTranslationGate(
  options: TranslationGateOptions = {},
): TranslationGate {
  const now = options.now ?? (() => Date.now())
  const baseDelayMs = options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS
  const maxDelayMs = options.maxDelayMs ?? DEFAULT_MAX_DELAY_MS
  const rateLimitDelayMs =
    options.rateLimitDelayMs ?? DEFAULT_RATE_LIMIT_DELAY_MS
  const balanceMode = options.balanceMode ?? 'halt'
  const balanceCooldownMs =
    options.balanceCooldownMs ?? DEFAULT_BALANCE_COOLDOWN_MS
  const reprobeMinDelayMs =
    options.reprobeMinDelayMs ?? DEFAULT_REPROBE_MIN_DELAY_MS

  let consecutiveFailures = 0
  let haltedKind: 'auth' | 'balance' | null = null
  let nextAttemptAt = 0
  let lastFailedAt = 0
  let lastKey: string | undefined
  let lastMessage: string | null = null

  function reset() {
    consecutiveFailures = 0
    haltedKind = null
    nextAttemptAt = 0
    lastFailedAt = 0
    lastKey = undefined
    lastMessage = null
  }

  return {
    canAttempt(key?: string) {
      if (key !== undefined && lastKey !== undefined && key !== lastKey) {
        reset()
        return true
      }
      if (haltedKind !== null) return false
      return now() >= nextAttemptAt
    },

    recordSuccess() {
      reset()
    },

    recordFailure(error: unknown, key?: string, displayMessage?: string) {
      if (key !== undefined && lastKey !== undefined && key !== lastKey) {
        reset()
      }
      const classified = classifyTranslateError(error)
      const message = displayMessage ?? classified.message
      const t = now()
      lastFailedAt = t
      lastKey = key
      lastMessage = message

      if (classified.kind === 'auth') {
        haltedKind = 'auth'
        nextAttemptAt = Number.POSITIVE_INFINITY
        return {
          ...classified,
          message,
          halted: true,
          delayMs: Number.POSITIVE_INFINITY,
        }
      }

      if (classified.kind === 'balance') {
        if (balanceMode === 'halt') {
          haltedKind = 'balance'
          nextAttemptAt = Number.POSITIVE_INFINITY
          return {
            ...classified,
            message,
            halted: true,
            delayMs: Number.POSITIVE_INFINITY,
          }
        }
        haltedKind = null
        nextAttemptAt = t + balanceCooldownMs
        return {
          ...classified,
          message,
          halted: false,
          delayMs: balanceCooldownMs,
        }
      }

      consecutiveFailures++
      const expDelay = Math.min(
        maxDelayMs,
        baseDelayMs * 2 ** (consecutiveFailures - 1),
      )
      const delayMs =
        classified.kind === 'rate-limit'
          ? Math.max(classified.retryAfterMs ?? rateLimitDelayMs, expDelay)
          : expDelay
      haltedKind = null
      nextAttemptAt = t + delayMs
      return { ...classified, message, halted: false, delayMs }
    },

    allowReprobe() {
      if (haltedKind !== 'balance') return false
      if (now() - lastFailedAt < reprobeMinDelayMs) return false
      haltedKind = null
      nextAttemptAt = 0
      return true
    },

    lastErrorMessage() {
      return lastMessage
    },

    reset,
  }
}
