import { TimedToken } from './PunctuationRestorationModel'
import { GetTimedtextResp } from './youtube-types'

/**
 * Convert YouTube subtitle format to standard timed token format
 */
export function convertYoutubeToStandardFormat(
  youtubeSubtitles: GetTimedtextResp,
): TimedToken[] {
  const events = youtubeSubtitles.events
    .map((event) => ({
      ...event,
      segs: event.segs?.filter((seg) => seg.utf8.trim() !== '') ?? [],
    }))
    .filter((event) => event.segs.length > 0)
  return events
    .flatMap((event, i) => {
      const segs = event.segs ?? []
      return segs.map((seg, k) => {
        const start = event.tStartMs + (seg.tOffsetMs ?? 0)
        const nextSeg = segs[k + 1]
        const nextEvent = events[i + 1]
        let end: number
        if (nextSeg) {
          end = event.tStartMs + (nextSeg.tOffsetMs ?? 0)
        } else if (events[i + 1]) {
          end = Math.min(
            event.tStartMs + (event.dDurationMs ?? 0),
            nextEvent.tStartMs,
          )
        } else {
          end = event.tStartMs + (event.dDurationMs ?? 0)
        }
        return {
          start: start / 1000,
          end: end / 1000,
          text: seg.utf8.replaceAll('\n', ' ').trim(),
        } satisfies TimedToken
      })
    })
    .filter((t) => t.text !== '')
}

/**
 * Determine if subtitles are missing punctuation
 */
export function hasMissingPunctuation(tokens: TimedToken[]): boolean {
  for (const t of tokens) {
    // If punctuation exists, consider it doesn't need conversion
    // not " 13.2" or "37.2c"
    if (
      /[,.?!]/.test(t.text.trim()) &&
      !/^\d+[\.,]\d+c?$/.test(t.text.trim())
    ) {
      return false
    }
  }
  return true
}

function findBestSplitPoint(
  tokens: TimedToken[],
  maxLength: number,
  comma: RegExp,
): number {
  function innerFindBestSplitPoint(points: number[]): number {
    let bestIndex = -1
    let bestLength = 0
    for (let i = 0; i < points.length; i++) {
      const p = points[i]
      const len = Math.abs(
        tokens.slice(0, p + 1).reduce((sum, t) => sum + t.text.length + 1, 0) -
          maxLength,
      )
      if (len < bestLength || bestIndex === -1) {
        bestLength = len
        bestIndex = p
      }
    }
    return bestIndex
  }
  // Prefer splitting at commas
  const commaIndices = tokens
    .map((t) => ({
      isComma: comma.test(t.text),
      index: tokens.indexOf(t),
    }))
    .filter((t) => t.isComma)
    .map((t) => t.index)
  if (commaIndices.length > 0) {
    return innerFindBestSplitPoint(commaIndices)
  }
  // Otherwise find the point closest to maxLength
  return innerFindBestSplitPoint(tokens.map((t, i) => i))
}

// Split subtitles into sentences for display, using heuristic algorithm for punctuation handling

interface SentenceSplitRule {
  maxLength: number
  separator: string
  sentenceStartRegex: RegExp
  sentenceEndRegex: RegExp
  commaRegex: RegExp
  specialTags: string[]
}

function getDefaultSentenceSplitRule(): SentenceSplitRule {
  return {
    maxLength: 100,
    separator: ' ',
    sentenceStartRegex: /^(>>)/,
    sentenceEndRegex: /[.!?]$/,
    commaRegex: /[,;]$/,
    specialTags: ['[Music]', '[Applause]'],
  }
}

function getCJKSentenceSplitRule(lang: string): SentenceSplitRule {
  const specialTagsMap: Record<string, string[]> = {
    'zh-Hans': ['[音乐]'],
    'zh-Hant': ['[音樂]'],
    ja: ['[音楽]'],
    ko: ['[음악]'],
  }
  return {
    maxLength: 100,
    separator: '',
    sentenceStartRegex: /^(>>)/,
    sentenceEndRegex: /[。！？.!?]$/,
    commaRegex: /[、，,;]$/,
    specialTags: specialTagsMap[lang] || [],
  }
}

function getSentenceSplitRule(lang: string): SentenceSplitRule {
  if (
    lang === 'zh-Hans' ||
    lang === 'zh-Hant' ||
    lang === 'ja' ||
    lang === 'ko'
  ) {
    return getCJKSentenceSplitRule(lang)
  }
  return getDefaultSentenceSplitRule()
}

export function sentencesInSubtitles(
  tokens: TimedToken[],
  lang: string,
): TimedToken[] {
  const rule = getSentenceSplitRule(lang)
  const sentences: TimedToken[] = []
  let current: TimedToken[] = []
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]
    // [Music] and [Applause] tags become their own sentences
    if (rule.specialTags.includes(t.text)) {
      if (current.length > 0) {
        // First collect the current sentence
        sentences.push(mergeTokens(current, rule.separator))
        current = []
      }
      sentences.push(t)
      continue
    }
    if (rule.sentenceStartRegex.test(t.text)) {
      if (current.length > 0) {
        // First collect the current sentence
        sentences.push(mergeTokens(current, rule.separator))
        current = []
      }
      current.push(t)
      continue
    }
    // Split on terminal punctuation
    if (rule.sentenceEndRegex.test(t.text)) {
      current.push(t)
      sentences.push(mergeTokens(current, rule.separator))
      current = []
      continue
    }
    current.push(t)

    const wouldExceed =
      getCurrentLength(current) + t.text.length + 1 > rule.maxLength
    if (wouldExceed && current.length > 0) {
      // Find the best split point in current
      const splitIndex = findBestSplitPoint(
        current,
        rule.maxLength,
        rule.commaRegex,
      )
      if (splitIndex !== -1) {
        const toEmit = current.slice(0, splitIndex + 1)
        const remaining = current.slice(splitIndex + 1)
        sentences.push(mergeTokens(toEmit, rule.separator))
        current = remaining
      } else {
        // Cannot split, submit directly
        sentences.push(mergeTokens(current, rule.separator))
        current = []
      }
    }
  }
  if (current.length > 0) {
    sentences.push(mergeTokens(current, rule.separator))
  }
  return sentences
}

function mergeTokens(tokens: TimedToken[], sep: string = ' '): TimedToken {
  if (tokens.length === 0) {
    throw new Error('Cannot merge empty tokens')
  }
  return {
    start: tokens[0].start,
    end: tokens[tokens.length - 1].end,
    text: tokens.map((t) => t.text).join(sep),
  }
}
function getCurrentLength(current: TimedToken[]): number {
  return current.reduce((sum, t) => sum + t.text.length + 1, 0)
}
