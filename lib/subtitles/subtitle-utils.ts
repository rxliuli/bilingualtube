import { TimedToken } from './PunctuationRestorationModel'
import { GetTimedtextResp } from './youtube-types'
import { normalizeLanguageCode } from '@/lib/translate/lang'

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

const CJK_LANGS = new Set(['zh-Hans', 'zh-Hant', 'ja', 'ko'])
const CJK_PUNCT_RE = /[。？！，、.,?!]/
const CJK_PUNCT_RATIO_THRESHOLD = 0.05

/**
 * Determine if subtitles are missing punctuation.
 *
 * For English (and other Latin scripts), any single non-number `[,?!]` is
 * enough to consider the track punctuated. For CJK languages, the check is
 * ratio-based: at least `CJK_PUNCT_RATIO_THRESHOLD` of cues must contain
 * sentence-ending punctuation. This avoids stray `[音楽]?` etc. flipping a
 * whole video into "has punctuation" mode.
 */
export function hasMissingPunctuation(
  tokens: TimedToken[],
  lang: string = 'en',
): boolean {
  if (tokens.length === 0) return true

  if (CJK_LANGS.has(lang)) {
    const withPunct = tokens.filter((t) => CJK_PUNCT_RE.test(t.text)).length
    return withPunct / tokens.length < CJK_PUNCT_RATIO_THRESHOLD
  }

  for (const t of tokens) {
    // Strip number-group commas (e.g. "20,000") before checking
    const text = t.text.trim().replace(/\d,\d/g, '')
    if (/[,?!]/.test(text)) {
      return false
    }
  }
  return true
}

/**
 * How a subtitle track should be processed before display.
 * - `sherpa-en` / `cjk-punct-ja`: run the matching punctuation-restoration model
 * - `sentences`: word-level segments, group into sentences (no model)
 * - `raw`: already line-level cues (manual captions), use as-is
 */
export type SubtitleTrackMode =
  | 'sherpa-en'
  | 'cjk-punct-ja'
  | 'sentences'
  | 'raw'

export interface ResolvedSubtitleTrack {
  /** Effective BCP-47 language of the bytes we received. */
  lang: string
  mode: SubtitleTrackMode
}

/**
 * Decide the language and processing mode of a timedtext response from its
 * request params.
 *
 * The key subtlety is `tlang`: when YouTube auto-translates a track it appends
 * `tlang` and returns text already in that language, while the URL still
 * carries the source `lang` (and often `kind=asr`). That text is clean,
 * human-readable translation — NOT raw ASR — so it must be labelled with
 * `tlang` and must never be fed to the source-language punctuation models.
 */
export function resolveSubtitleTrack(params: {
  rawLang: string
  tlang: string | null
  kind: string | null
  data: TimedToken[]
}): ResolvedSubtitleTrack {
  const { rawLang, tlang, kind, data } = params
  const lang = normalizeLanguageCode(tlang ?? rawLang)

  // Auto-translated track: clean text already in `tlang`. Group word-level
  // segments into sentences; never run the ASR punctuation models.
  if (tlang) {
    return { lang, mode: 'sentences' }
  }

  if (kind === 'asr') {
    if (lang === 'en' && hasMissingPunctuation(data, 'en')) {
      return { lang, mode: 'sherpa-en' }
    }
    // YouTube ASR for Japanese is only ~50% punctuated; the model is a no-op on
    // already-punctuated cues, so always route Japanese ASR through it.
    if (lang === 'ja') {
      return { lang, mode: 'cjk-punct-ja' }
    }
    // Better auto-generated subtitles: already punctuated, just group.
    return { lang, mode: 'sentences' }
  }

  // Manual captions: events are already line-level cues.
  return { lang, mode: 'raw' }
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
    // CJK chars carry more info per char than Latin; 40 chars matches typical
    // subtitle line length and reads as ~one screen of text.
    maxLength: 40,
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

const TIME_GAP_THRESHOLD = 2

export function sentencesInSubtitles(
  tokens: TimedToken[],
  lang: string,
): TimedToken[] {
  const rule = getSentenceSplitRule(lang)
  const sentences: TimedToken[] = []
  let current: TimedToken[] = []
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]

    // Force split when there's a large time gap between tokens
    if (
      current.length > 0 &&
      t.start - current[current.length - 1].end > TIME_GAP_THRESHOLD
    ) {
      sentences.push(mergeTokens(current, rule.separator))
      current = []
    }

    // If appending `t` would push `current` past maxLength, eagerly emit
    // current first. This fires BEFORE the sentence-end branch, so even when
    // `t` ends with `。`, we don't drag an already-comma-terminated clause
    // into the same cue. Without this, a [..., '...感じで、'] buffer would get
    // merged with the next 「…ですね。」 fragment into one 47-char cue even with
    // maxLength=40.
    if (current.length > 0) {
      const projected = getCurrentLength(current) + t.text.length + 1
      if (projected > rule.maxLength) {
        const splitIndex = findBestSplitPoint(
          current,
          rule.maxLength,
          rule.commaRegex,
        )
        if (splitIndex >= 0 && splitIndex < current.length - 1) {
          sentences.push(
            mergeTokens(current.slice(0, splitIndex + 1), rule.separator),
          )
          current = current.slice(splitIndex + 1)
        } else {
          sentences.push(mergeTokens(current, rule.separator))
          current = []
        }
      }
    }

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
      if (rule.sentenceEndRegex.test(t.text)) {
        sentences.push(t)
        continue
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
