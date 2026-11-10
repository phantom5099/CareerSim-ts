/** 把错误及其 cause 链拼成一行，用于日志和事件日志。 */
export function errorChain(error: unknown): string {
  if (!(error instanceof Error)) {
    return String(error)
  }

  const parts = [error.message]
  const seen = new Set<unknown>([error])
  let cause: unknown = error.cause
  while (cause instanceof Error && !seen.has(cause)) {
    seen.add(cause)
    parts.push(cause.message)
    cause = cause.cause
  }
  return parts.join(': ')
}
