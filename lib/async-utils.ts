/**
 * Wrap an async function so calls made while a previous invocation is still
 * in flight are dropped instead of run concurrently. The guard is set
 * synchronously, before the wrapped function's first await — otherwise two
 * callers arriving in the same tick could both pass the check and run the
 * same work twice.
 */
export function skipWhileRunning<A extends unknown[]>(
  fn: (...args: A) => Promise<void>,
): (...args: A) => Promise<void> {
  let running = false
  return async (...args: A) => {
    if (running) return
    running = true
    try {
      await fn(...args)
    } finally {
      running = false
    }
  }
}
