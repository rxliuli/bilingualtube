import { expect, it } from 'vitest'
import { skipWhileRunning } from './async-utils'

// Regression: triggerTranslation set its in-flight guard only after the
// first await, so a stream-yield trigger and a timeupdate trigger arriving
// in the same tick both passed the check and translated the same batch
// twice (duplicate "Translating 10 cues" log pairs at identical timestamps).
it('drops calls made while a previous invocation is in flight', async () => {
  let runs = 0
  let release!: () => void
  const gate = new Promise<void>((r) => (release = r))
  const fn = skipWhileRunning(async () => {
    // The guard must already be set here, before this first await.
    await gate
    runs++
  })

  const first = fn()
  const second = fn() // same tick, while the first is still pending
  release()
  await Promise.all([first, second])
  expect(runs).toBe(1)
})

it('allows calls again after the previous invocation settles', async () => {
  let runs = 0
  const fn = skipWhileRunning(async () => {
    runs++
  })
  await fn()
  await fn()
  expect(runs).toBe(2)
})

it('releases the guard when the wrapped function throws', async () => {
  let attempts = 0
  const fn = skipWhileRunning(async () => {
    attempts++
    throw new Error('boom')
  })
  await expect(fn()).rejects.toThrow('boom')
  await expect(fn()).rejects.toThrow('boom')
  expect(attempts).toBe(2)
})
