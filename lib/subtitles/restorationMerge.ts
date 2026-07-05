import { TranslationToken } from '../store'
import { TimedToken } from './PunctuationRestorationModel'
import { sentencesInSubtitles } from './subtitle-utils'

/**
 * Build the display cues for one punctuation-restoration stream update.
 *
 * The stream yields a prefix of the full track, so the raw tail is appended
 * before sentence grouping — otherwise every cue past the restoration
 * frontier would disappear from view (visible when starting playback
 * mid-video).
 *
 * Existing translations are preserved by cue start time, not array index:
 * restoration changes how the prefix groups into cues, which would shift the
 * index of every tail cue and drop its translation on each update.
 */
export function mergeRestorationUpdate(
  processed: TimedToken[],
  fullTrack: TimedToken[],
  existingCues: TranslationToken[],
  lang: string,
): TranslationToken[] {
  const combined =
    processed.length < fullTrack.length
      ? processed.concat(fullTrack.slice(processed.length))
      : processed
  const cues: TranslationToken[] = sentencesInSubtitles(combined, lang)

  const existingByStart = new Map(existingCues.map((c) => [c.start, c]))
  return cues.map((cue) => {
    const existing = existingByStart.get(cue.start)
    if (existing && existing.text === cue.text && existing.translated) {
      return { ...cue, translated: existing.translated }
    }
    return cue
  })
}
