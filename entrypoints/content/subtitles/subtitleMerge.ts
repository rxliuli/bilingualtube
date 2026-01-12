/**
 * Merge/defragment YouTube timedtext (json3) `events` into readable cues.
 *
 * This extracts ONLY the "merge/defragment" logic from the original extension:
 * - Normalizes whitespace
 * - For CJK-ish languages, removes non-alnum-surrounded spaces
 * - Merges adjacent/overlapping events into a single cue when time ranges overlap
 *
 * Input shape (subset of YouTube timedtext json3):
 *   events: Array<{ tStartMs: number, dDurationMs: number, segs?: Array<{ utf8: string }> }>
 *
 * Output:
 *   Array<{ start: number, end: number, content: string }>
 */

import { TimedtextEvent } from './types'

const CJK_NO_EXTRA_SPACES_LANGS = new Set(['ja', 'zh-Hant', 'zh-Hans'])

// Maximum length for a single subtitle cue (in characters)
// If merging would exceed this, we break into a new cue
const MAX_SUBTITLE_LENGTH = 100

/**
 * @param {string} text
 * @param {string | null | undefined} lang
 */
function normalizeSegmentText(text: string, lang?: string) {
  let normalized = String(text).replace(/\s+/g, ' ').trim()

  // For CJK-ish languages, remove spaces that are not between ASCII alnum.
  // (keeps "ABC 123" spacing but removes "你 好" style spacing)
  if (lang && CJK_NO_EXTRA_SPACES_LANGS.has(lang)) {
    normalized = normalized.replace(/(?<![a-zA-Z0-9])\s+(?![a-zA-Z0-9])/g, '')
  }

  return normalized
}

export interface SubtitleCue {
  start: number
  end: number
  content: string
  translated?: string
}

/**
 * Merge/defragment events.
 *
 * Based on the algorithm from Immersive Translate extension's mergeYoutubeSubtitleFragments.
 * Key logic: if current subtitle's start time < previous subtitle's end time,
 * it means there's overlap, so merge the text (handles fragmented auto-generated subtitles).
 * However, aAppend newline events act as sentence boundaries and prevent merging.
 *
 * @param {any[] | null | undefined} events
 * @param {string | null | undefined} lang
 * @returns {SubtitleCue[]}
 */
export function mergeTimedtextEvents(
  events: TimedtextEvent[],
  lang: string,
): SubtitleCue[] {
  if (!Array.isArray(events) || events.length === 0) {
    return []
  }

  // Find newline boundaries (aAppend === 1 with '\n')
  const newlineBoundaries = new Set<number>()
  for (let i = 0; i < events.length; i++) {
    const event = events[i]
    if (
      event?.aAppend === 1 &&
      event?.segs?.[0]?.utf8 === '\n' &&
      event?.tStartMs !== undefined
    ) {
      newlineBoundaries.add(event.tStartMs)
    }
  }

  // Filter out append segments and invalid events
  const filteredEvents = events.filter(
    (event) =>
      event &&
      event.segs &&
      event.segs.length &&
      event.tStartMs !== undefined &&
      event.dDurationMs !== undefined &&
      event.aAppend !== 1
  )

  if (filteredEvents.length === 0) {
    return []
  }

  // Sort by start time
  filteredEvents.sort((a, b) => a.tStartMs - b.tStartMs)

  // Process each event's segs and split on terminal punctuation at seg level
  const eventsWithText: Array<{
    tStartMs: number
    dDurationMs: number
    text: string
  }> = []

  for (const event of filteredEvents) {
    // Build an array of segs with their absolute timestamps
    interface SegWithTime {
      text: string
      startMs: number
      endMs: number
    }

    const segsWithTime: SegWithTime[] = event.segs!.map((seg, index) => {
      const startMs = event.tStartMs + (seg.tOffsetMs || 0)
      // End time is either the next seg's start time, or the event's end time
      const nextSeg = event.segs![index + 1]
      const endMs = nextSeg
        ? event.tStartMs + (nextSeg.tOffsetMs || 0)
        : event.tStartMs + event.dDurationMs!

      return {
        text: seg.utf8.replaceAll('\n', ' '),
        startMs,
        endMs,
      }
    })

    // Now split on terminal punctuation (.!?) at seg boundaries
    let currentSentence = ''
    let currentStartMs = segsWithTime[0]?.startMs || event.tStartMs
    let currentEndMs = currentStartMs

    for (let i = 0; i < segsWithTime.length; i++) {
      const seg = segsWithTime[i]
      currentSentence += seg.text
      currentEndMs = seg.endMs

      // Check if this seg ends with terminal punctuation
      const trimmedText = seg.text.trim()
      if (/[.!?]$/.test(trimmedText)) {
        // Found a sentence boundary, emit the current sentence
        if (currentSentence.trim()) {
          eventsWithText.push({
            tStartMs: currentStartMs,
            dDurationMs: currentEndMs - currentStartMs,
            text: currentSentence.trim(),
          })
        }
        // Start a new sentence from the next seg
        currentSentence = ''
        if (i + 1 < segsWithTime.length) {
          currentStartMs = segsWithTime[i + 1].startMs
        }
      }
    }

    // Don't forget the last sentence if there's any remaining text
    if (currentSentence.trim()) {
      eventsWithText.push({
        tStartMs: currentStartMs,
        dDurationMs: currentEndMs - currentStartMs,
        text: currentSentence.trim(),
      })
    }
  }

  // Merge overlapping fragments using reduce
  const merged = eventsWithText.reduce((acc, current, index) => {
    // First event, just add it
    if (index === 0) {
      return [current]
    }

    const previous = acc[acc.length - 1]

    // If completely duplicate, skip
    if (
      current.tStartMs === previous.tStartMs &&
      current.text === previous.text &&
      current.dDurationMs === previous.dDurationMs
    ) {
      return acc
    }

    // Check if there's a newline boundary between previous and current
    // AND if the previous text ends with sentence-ending punctuation
    const previousEndMs = previous.tStartMs + previous.dDurationMs
    let hasNewlineBoundary = false
    for (const boundaryMs of newlineBoundaries) {
      if (boundaryMs > previous.tStartMs && boundaryMs <= current.tStartMs) {
        hasNewlineBoundary = true
        break
      }
    }

    // Check if previous text ends with sentence-ending punctuation
    const previousTextTrimmed = previous.text.trim()
    const endsWithTerminalPunctuation = /[.!?]$/.test(previousTextTrimmed)
    const endsWithComma = /,$/.test(previousTextTrimmed)

    // If previous text ends with terminal punctuation (.!?), ALWAYS start a new cue
    // These punctuation marks indicate a complete sentence and should force a break
    if (endsWithTerminalPunctuation) {
      return acc.concat(current)
    }

    // For commas, only break if there's a newline boundary or if events are adjacent (not overlapping)
    // This allows commas to continue merging in most cases, but respect boundaries when present
    const isAdjacent = current.tStartMs === previousEndMs
    const isOverlapping = current.tStartMs < previousEndMs
    if (endsWithComma && hasNewlineBoundary) {
      return acc.concat(current)
    }
    if (endsWithComma && isAdjacent && !isOverlapping) {
      return acc.concat(current)
    }

    // Key logic: if current start time <= previous end time, merge the text
    if (current.tStartMs <= previousEndMs) {
      // Check if merging would exceed max length
      const mergedText = previous.text + ' ' + current.text
      if (mergedText.length > MAX_SUBTITLE_LENGTH) {
        // If it would be too long, start a new cue instead of merging
        return acc.concat(current)
      }

      previous.text = mergedText
      // When merging overlapping fragments, use the current (later) fragment's end time
      // This is important because when we split on punctuation, each fragment has
      // accurate timing based on seg tOffsetMs, and we should respect that
      const currentEndMs = current.tStartMs + current.dDurationMs
      previous.dDurationMs = currentEndMs - previous.tStartMs
      return acc
    }

    // Otherwise, add as a new subtitle entry
    return acc.concat(current)
  }, [] as Array<{ tStartMs: number; dDurationMs: number; text: string }>)

  // Convert to output format with normalized text
  return merged.map((item) => ({
    start: item.tStartMs / 1000,
    end: (item.tStartMs + item.dDurationMs) / 1000,
    content: normalizeSegmentText(item.text, lang),
  }))
}
