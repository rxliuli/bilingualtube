// Providers sometimes hand back HTML entity literals (e.g. `&gt;` for `>`).
// Subtitles are rendered with textContent, so entities must be decoded here
// rather than by the DOM. Decoding is deliberately single-pass and confined to
// a small named set: `&amp;gt;` becomes `&gt;`, not `>`, so an escaping bug
// upstream can never be silently un-escaped twice.
const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: '\u00a0',
}

export function decodeHtmlEntities(input: string): string {
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
