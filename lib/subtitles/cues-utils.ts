import { TranslationToken } from '../store'

const MAX_CUES_TO_TRANSLATE = 10

export function shouldTriggerTranslation(
  cues: TranslationToken[],
  currentTime: number,
): boolean {
  // Check if there are any untranslated cues in the next MAX_CUES_TO_TRANSLATE cues
  const futureCues = cues.filter((cue) => cue.end >= currentTime)
  const nextCues = futureCues.slice(0, MAX_CUES_TO_TRANSLATE)
  return nextCues.some((cue) => !cue.translated)
}

export function getCuesToTranslate(
  cues: TranslationToken[],
  currentTime: number,
): TranslationToken[] {
  // Get the next MAX_CUES_TO_TRANSLATE untranslated cues from current time
  return cues
    .filter((cue) => cue.end >= currentTime && !cue.translated)
    .slice(0, MAX_CUES_TO_TRANSLATE)
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
