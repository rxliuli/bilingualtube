import { TranslationToken } from '../store'

export function getCuesToTranslate(
  cues: TranslationToken[],
  currentTime: number,
): TranslationToken[] {
  // Translate all untranslated subtitles in [currentTime, currentTime + 60s]
  return cues.filter(
    (cue) =>
      cue.end >= currentTime &&
      cue.start <= currentTime + 60 &&
      !cue.translated,
  )
}

// Find matching subtitle based on current time
export function findMatchingSubtitle(
  cues: TranslationToken[],
  currentTime: number,
) {
  for (const cue of cues) {
    if (currentTime >= cue.start - 0.1 && currentTime <= cue.end - 0.1) {
      return cue
    }
  }
  return null
}
