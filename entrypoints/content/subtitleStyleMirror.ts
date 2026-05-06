// YouTube renders caption font-size as ~4.445% of player height by default, then
// multiplies by the user's font-size preference. We learn that ratio from the
// live segment and apply 85% on top so two-line bilingual subtitles don't feel
// oversized compared to native single-line ones.
const DEFAULT_FONT_SIZE_RATIO = 0.04445
const BILINGUAL_FONT_SIZE_FACTOR = 0.85

interface MirroredStyle {
  fontFamily: string
  color: string
  backgroundColor: string
  textShadow: string
}

export function mirrorNativeCaptionStyle(overlay: HTMLElement): () => void {
  const moviePlayer = document.querySelector<HTMLElement>('#movie_player')
  if (!moviePlayer) {
    return () => {}
  }

  const innerDivs = Array.from(
    overlay.querySelectorAll<HTMLElement>(
      '.subtitle-original, .subtitle-translated',
    ),
  )

  let cachedRatio = DEFAULT_FONT_SIZE_RATIO
  let cachedStyle: MirroredStyle | null = null

  const sampleSegment = () => {
    const seg = moviePlayer.querySelector<HTMLElement>('.ytp-caption-segment')
    if (!seg) return
    const cs = getComputedStyle(seg)
    const playerHeight = moviePlayer.clientHeight
    const segFontSize = parseFloat(cs.fontSize)
    if (playerHeight > 0 && segFontSize > 0) {
      cachedRatio = segFontSize / playerHeight
    }
    cachedStyle = {
      fontFamily: cs.fontFamily,
      color: cs.color,
      backgroundColor: cs.backgroundColor,
      textShadow: cs.textShadow,
    }
  }

  const apply = () => {
    const fontSize =
      moviePlayer.clientHeight * cachedRatio * BILINGUAL_FONT_SIZE_FACTOR
    overlay.style.fontSize = `${fontSize}px`
    if (cachedStyle) {
      overlay.style.fontFamily = cachedStyle.fontFamily
      overlay.style.color = cachedStyle.color
      overlay.style.textShadow = cachedStyle.textShadow
      innerDivs.forEach((div) => {
        div.style.backgroundColor = cachedStyle!.backgroundColor
      })
    }
  }

  sampleSegment()
  apply()

  // Mirror native style as it appears: every time YouTube renders a segment or
  // updates its inline style (player resize, user changes caption preferences),
  // refresh the cached ratio and non-size styles.
  const segmentObserver = new MutationObserver((mutations) => {
    const isCaptionMutation = mutations.some((m) => {
      const target = m.target as Element
      if (target.classList?.contains?.('ytp-caption-segment')) return true
      for (const node of m.addedNodes) {
        if (!(node instanceof Element)) continue
        if (
          node.classList?.contains?.('ytp-caption-segment') ||
          node.querySelector?.('.ytp-caption-segment')
        ) {
          return true
        }
      }
      return false
    })
    if (!isCaptionMutation) return

    sampleSegment()
    apply()
  })
  segmentObserver.observe(moviePlayer, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['style'],
  })

  // Always recompute font-size on player resize, using the latest learned ratio.
  // This keeps the overlay responsive even during gaps between cues, when the
  // native segment has been removed and we have nothing fresh to sample.
  const resizeObserver = new ResizeObserver(() => {
    apply()
  })
  resizeObserver.observe(moviePlayer)

  return () => {
    segmentObserver.disconnect()
    resizeObserver.disconnect()
  }
}
