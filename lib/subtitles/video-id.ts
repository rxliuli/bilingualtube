export interface ActiveVideoContext {
  urlVideoId: string | null
  playerVideoId: string | null
}

/**
 * Extract the YouTube video ID from a watch, live, embed, or shorts URL.
 * Returns null for non-video pages such as the home feed or search results.
 */
export function getVideoIdFromUrl(url: string): string | null {
  try {
    const parsed = new URL(url)
    const v = parsed.searchParams.get('v')
    if (v) return v
    const match = parsed.pathname.match(/^\/(?:live|embed|shorts)\/([^/?#]+)/)
    return match?.[1] ?? null
  } catch {
    return null
  }
}

/**
 * Resolve the currently active main-player video ID.
 * Prefers the URL video ID on watch/live/embed/shorts pages so stale player
 * state during SPA navigation cannot win, falling back to the visible
 * `#movie_player` ID for non-watch pages (e.g. Miniplayer on the home feed).
 */
export function getActiveVideoId(context: ActiveVideoContext): string | null {
  return context.urlVideoId ?? context.playerVideoId
}

/**
 * Return true only when a `/api/timedtext` request belongs to the active main
 * video. Filters out requests from `#inline-preview-player` (hover previews on
 * the home feed or related-video sidebar) and stale SPA transitions.
 */
export function isTimedtextForActiveVideo(
  requestVideoId: string | null,
  context: ActiveVideoContext,
): boolean {
  if (!requestVideoId) return false
  const activeVideoId = getActiveVideoId(context)
  if (!activeVideoId) return false
  return requestVideoId === activeVideoId
}

/**
 * Return true when stored subtitles belong to a different video than the
 * currently active one and should be cleared.
 */
export function shouldResetSubtitleForVideo(
  subtitleVideoId: string | undefined,
  activeVideoId: string | null,
): boolean {
  if (!subtitleVideoId) return false
  return subtitleVideoId !== activeVideoId
}
