import { describe, expect, it } from 'vitest'
import { classifyTranslateError, createTranslationGate } from './backoff'
import { ApiError, humanizeImpError } from './imp'

describe('classifyTranslateError', () => {
  it('classifies ApiError statuses accurately', () => {
    expect(classifyTranslateError(new ApiError(401, 'unauth')).kind).toBe('auth')
    expect(classifyTranslateError(new ApiError(403, 'disabled')).kind).toBe(
      'auth',
    )
    expect(classifyTranslateError(new ApiError(402, 'low')).kind).toBe(
      'balance',
    )
    expect(classifyTranslateError(new ApiError(429, 'rl', 45_000))).toEqual({
      kind: 'rate-limit',
      message: 'rl',
      retryAfterMs: 45_000,
    })
    expect(classifyTranslateError(new ApiError(502, 'bad gateway')).kind).toBe(
      'transient',
    )
  })

  it('classifies humanized and cross-boundary error messages', () => {
    expect(
      classifyTranslateError(new Error(humanizeImpError(new ApiError(402, ''))))
        .kind,
    ).toBe('balance')
    expect(
      classifyTranslateError(new Error(humanizeImpError(new ApiError(401, ''))))
        .kind,
    ).toBe('auth')
    expect(
      classifyTranslateError(new Error(humanizeImpError(new ApiError(429, ''))))
        .kind,
    ).toBe('rate-limit')
    expect(
      classifyTranslateError(
        new Error('Imp Credits is not connected — connect it in settings'),
      ).kind,
    ).toBe('auth')
    expect(
      classifyTranslateError(new Error('OpenAI API key is not set')).kind,
    ).toBe('auth')
    expect(
      classifyTranslateError(new Error('Google translate failed: 429')).kind,
    ).toBe('rate-limit')
    expect(
      classifyTranslateError(new Error('502 Bad Gateway')).kind,
    ).toBe('transient')
  })
})

describe('createTranslationGate (halt mode — content script)', () => {
  it('halts immediately on 402 and blocks repeated onVideoProgress attempts', () => {
    let clock = 1_000
    const gate = createTranslationGate({
      now: () => clock,
      balanceMode: 'halt',
      reprobeMinDelayMs: 30_000,
    })

    const res = gate.recordFailure(
      new Error(humanizeImpError(new ApiError(402, ''))),
    )
    expect(res.kind).toBe('balance')
    expect(res.halted).toBe(true)

    // Even minutes later, playback progress alone never re-attempts.
    clock += 300_000
    expect(gate.canAttempt()).toBe(false)
  })

  it('allows a single reprobe on tab return after reprobeMinDelayMs, and re-halts if still 402', () => {
    let clock = 1_000
    const gate = createTranslationGate({
      now: () => clock,
      balanceMode: 'halt',
      reprobeMinDelayMs: 30_000,
    })

    gate.recordFailure(new ApiError(402, 'low'))
    expect(gate.canAttempt()).toBe(false)

    // Too soon to reprobe.
    clock += 10_000
    expect(gate.allowReprobe()).toBe(false)
    expect(gate.canAttempt()).toBe(false)

    // Enough time elapsed (user switched away to top up and came back).
    clock += 20_000
    expect(gate.allowReprobe()).toBe(true)
    expect(gate.canAttempt()).toBe(true)

    // Still out of credits -> re-halts immediately.
    gate.recordFailure(new ApiError(402, 'low'))
    expect(gate.canAttempt()).toBe(false)
    expect(gate.allowReprobe()).toBe(false)
  })

  it('never reprobes 401 auth errors on tab return; only reset() clears them', () => {
    let clock = 1_000
    const gate = createTranslationGate({
      now: () => clock,
      balanceMode: 'halt',
      reprobeMinDelayMs: 30_000,
    })

    gate.recordFailure(new ApiError(401, 'expired'))
    clock += 120_000
    expect(gate.allowReprobe()).toBe(false)
    expect(gate.canAttempt()).toBe(false)

    gate.reset()
    expect(gate.canAttempt()).toBe(true)
  })

  it('respects Retry-After on 429 and falls back to rateLimitDelayMs', () => {
    let clock = 1_000
    const gate = createTranslationGate({
      now: () => clock,
      rateLimitDelayMs: 60_000,
    })

    const r1 = gate.recordFailure(new ApiError(429, 'slow down', 45_000))
    expect(r1.delayMs).toBe(45_000)
    expect(gate.canAttempt()).toBe(false)

    clock += 44_999
    expect(gate.canAttempt()).toBe(false)
    clock += 1
    expect(gate.canAttempt()).toBe(true)

    // Serialized message without Retry-After header falls back to 60s.
    const r2 = gate.recordFailure(
      new Error(humanizeImpError(new ApiError(429, ''))),
    )
    expect(r2.delayMs).toBe(60_000)
    expect(gate.canAttempt()).toBe(false)
  })

  it('backs off exponentially on transient errors and resets after success', () => {
    let clock = 1_000
    const gate = createTranslationGate({
      now: () => clock,
      baseDelayMs: 5_000,
      maxDelayMs: 60_000,
    })

    const delays: number[] = []
    for (let i = 0; i < 6; i++) {
      const r = gate.recordFailure(new Error('network error'))
      delays.push(r.delayMs)
      clock += r.delayMs
    }
    expect(delays).toEqual([5_000, 10_000, 20_000, 40_000, 60_000, 60_000])

    gate.recordSuccess()
    expect(gate.canAttempt()).toBe(true)
    expect(gate.recordFailure(new Error('network error')).delayMs).toBe(5_000)
  })
})

describe('createTranslationGate (cooldown mode — background)', () => {
  it('cools down 402 across all tabs, preserves displayMessage, and resets when settings key changes', () => {
    let clock = 1_000
    const gate = createTranslationGate({
      now: () => clock,
      balanceMode: 'cooldown',
      balanceCooldownMs: 30_000,
    })

    const humanized = humanizeImpError(new ApiError(402, '{"error":"raw"}'))
    gate.recordFailure(new ApiError(402, '{"error":"raw"}'), 'imp:key1', humanized)

    expect(gate.canAttempt('imp:key1')).toBe(false)
    expect(gate.lastErrorMessage()).toBe(humanized)

    // Switching engine or reconnecting immediately clears the gate.
    expect(gate.canAttempt('google:')).toBe(true)

    // Re-trigger 402 and verify cooldown expires after 30s.
    gate.recordFailure(new ApiError(402, 'low'), 'imp:key1', humanized)
    clock += 29_999
    expect(gate.canAttempt('imp:key1')).toBe(false)
    clock += 1
    expect(gate.canAttempt('imp:key1')).toBe(true)
  })
})
