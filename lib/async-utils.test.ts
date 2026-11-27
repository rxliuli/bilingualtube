/**
 * Drop overlapping calls with the same key.
 * Without getKey, all calls share one key.
 */
export function skipWhileRunning<A extends unknown[]>(
  fn: (...args: A) => Promise<void>,
  getKey?: (...args: A) => unknown,
): (...args: A) => Promise<void> {
  const running = new Set<unknown>()

  return async (...args: A) => {
    const key = getKey?.(...args)

    if (running.has(key)) return

    running.add(key)

    try {
      await fn(...args)
    } finally {
      running.delete(key)
    }
  }
}
