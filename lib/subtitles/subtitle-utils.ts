import { TimedToken } from './punctuationRestoration'
import { GetTimedtextResp } from './youtube-types'

/**
 * 转换 YouTube 字幕格式为标准时间标记格式
 * @param youtubeSubtitles
 * @returns
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
 * 确定字幕中是否存在缺失标点符号的情况
 * @param tokens
 * @returns
 */
export function hasMissingPunctuation(tokens: TimedToken[]): boolean {
  for (const t of tokens) {
    // 如果有标点符号，则认为不需要转换
    if (/[,.?!]/.test(t.text.trim())) {
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
  // 优先在逗号处分割
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
  // 否则找到最接近 maxLength 的点
  return innerFindBestSplitPoint(tokens.map((t, i) => i))
}

// 将字幕进行分句，便于显示为字幕，使用启发式的算法处理标点符号
export function sentencesInSubtitles(
  tokens: TimedToken[],
  lang: string,
): TimedToken[] {
  if (
    lang === 'zh-Hans' ||
    lang === 'zh-Hant' ||
    lang === 'ja' ||
    lang === 'ko'
  ) {
    return sentencesInSubtitlesOnCJK(tokens, lang)
  }
  return sentencesInSubtitlesOnDefault(tokens, lang)
}

function sentencesInSubtitlesOnCJK(
  tokens: TimedToken[],
  lang: string,
): TimedToken[] {
  const MAX_LENGTH = 100
  const SEPARATOR = ''
  const sentenceEndRegex = /[。！？.!?]$/
  const commaRegex = /[、，,;]$/
  const sentences: TimedToken[] = []
  let current: TimedToken[] = []
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]
    if (t.text === '[音楽]' || t.text === '[音乐]' || t.text === '[음악]') {
      if (current.length > 0) {
        // 先把当前句子收集起来
        sentences.push(mergeTokens(current, SEPARATOR))
        current = []
      }
      sentences.push(t)
      continue
    }
    if (sentenceEndRegex.test(t.text)) {
      current.push(t)
      sentences.push(mergeTokens(current, SEPARATOR))
      current = []
      continue
    }

    const wouldExceed =
      getCurrentLength(current) + t.text.length + 1 > MAX_LENGTH
    if (wouldExceed && current.length > 0) {
      // 在当前 current 中找最佳分割点
      const splitIndex = findBestSplitPoint(current, MAX_LENGTH, commaRegex)
      if (splitIndex !== -1) {
        const toEmit = current.slice(0, splitIndex + 1)
        const remaining = current.slice(splitIndex + 1)
        sentences.push(mergeTokens(toEmit, SEPARATOR))
        current = remaining
      } else {
        // 无法分割，直接提交
        sentences.push(mergeTokens(current, SEPARATOR))
        current = []
      }
    }
    current.push(t)
  }
  if (current.length > 0) {
    sentences.push(mergeTokens(current, SEPARATOR))
  }
  return sentences
}

function sentencesInSubtitlesOnDefault(
  tokens: TimedToken[],
  lang: string,
): TimedToken[] {
  const MAX_LENGTH = 100
  const sentences: TimedToken[] = []
  let current: TimedToken[] = []
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]
    // 遇到 [Music] 标签则直接作为一个句子
    if (t.text === '[Music]') {
      if (current.length > 0) {
        // 先把当前句子收集起来
        sentences.push(mergeTokens(current))
        current = []
      }
      sentences.push(t)
      continue
    }
    // 遇到终止符号则分割
    if (/[.!?]$/.test(t.text)) {
      current.push(t)
      sentences.push(mergeTokens(current))
      current = []
      continue
    }
    current.push(t)

    const wouldExceed =
      getCurrentLength(current) + t.text.length + 1 > MAX_LENGTH
    if (wouldExceed && current.length > 0) {
      // 在当前 current 中找最佳分割点
      const splitIndex = findBestSplitPoint(current, MAX_LENGTH, /[,;]$/)
      if (splitIndex !== -1) {
        const toEmit = current.slice(0, splitIndex + 1)
        const remaining = current.slice(splitIndex + 1)
        sentences.push(mergeTokens(toEmit))
        current = remaining
      } else {
        // 无法分割，直接提交
        sentences.push(mergeTokens(current))
        current = []
      }
    }
  }
  if (current.length > 0) {
    sentences.push(mergeTokens(current))
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
