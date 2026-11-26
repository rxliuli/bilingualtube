import type { PublicPath } from 'wxt/browser'
import { BPETokenizer } from './bpeTokenizer'
import {
  type TimedToken,
  PunctuationRestorationModel,
  type AnnotatedToken,
} from './PunctuationRestorationModel'
import { CjkPunctModel } from './CjkPunctModel'
import { findUnpunctuatedSpans, isStageTagToken } from './subtitle-utils'

const SPAN_CONTEXT_TOKENS = 10
const SPEAKER_PREFIX_RE = /^(>>\s+)/

interface ModelInputEntry {
  origIdx: number
  speakerPrefix: string
  token: TimedToken
}

/**
 * Merge a single model annotation back onto its exact original token.
 *
 * Only CAP (sentence-start) case predictions are honored: the model's
 * UPPER/LOWER predictions are noisy and would clobber YouTube's proper-noun
 * casing. Leading `>> ` speaker markers are preserved outside the capitalized
 * word so `>> morning` + CAP renders as `>> Morning`.
 */
function applyAnnotationToOriginal(
  annotated: AnnotatedToken,
  original: TimedToken,
  speakerPrefix: string,
): TimedToken {
  if (isStageTagToken(original.text) || /[.,!?]$/.test(original.text)) {
    return original
  }
  const cased =
    annotated.caseType === 'CAP'
      ? annotated.text.charAt(0).toUpperCase() + annotated.text.slice(1)
      : annotated.text
  return {
    ...original,
    text: speakerPrefix + cased + annotated.punctuation,
  }
}

/**
 * Extract clean word tokens for `sherpa-en` from `tokens[start..end)`.
 *
 * - Pure stage-tag tokens (`[Music]`, `[music]`, `[singing]`, `>> [music]`,
 *   etc.) are omitted so they never consume BPE budget, confuse the language
 *   model, or receive spurious punctuation like `[music],`.
 * - Leading `>> ` speaker prefixes are stripped before inference and restored
 *   by `origIdx` afterwards so `>>` never becomes `<unk>` tokens or shifts word
 *   predictions.
 * - Existing trailing `[.,!?]+` are stripped so context tokens never double up
 *   punctuation.
 */
function buildModelInputs(
  tokens: TimedToken[],
  start: number,
  end: number,
): ModelInputEntry[] {
  const entries: ModelInputEntry[] = []
  for (let i = start; i < end; i++) {
    const original = tokens[i]
    if (!original || isStageTagToken(original.text)) {
      continue
    }
    const prefixMatch = SPEAKER_PREFIX_RE.exec(original.text)
    const speakerPrefix = prefixMatch?.[1] ?? ''
    const withoutPrefix = speakerPrefix
      ? original.text.slice(speakerPrefix.length)
      : original.text
    const cleaned = withoutPrefix.replace(/[.,!?]+$/, '').trim()
    if (!cleaned) {
      continue
    }
    entries.push({
      origIdx: i,
      speakerPrefix,
      token: { ...original, text: cleaned },
    })
  }
  return entries
}

interface PunctuationOptions {
  wasmUrl: string
  sherpaModelPath: string
  sherpaVocabPath: string
  cjkPunctModelPath?: string
  cjkPunctVocabPath?: string
}

async function createModel(options?: PunctuationOptions) {
  const t0 = performance.now()
  const tokenizer = new BPETokenizer()
  await tokenizer.load(
    options?.sherpaVocabPath ??
      ('/sherpa-onnx-online-punct-en-2024-08-06/bpe.vocab' satisfies PublicPath),
  )
  const t1 = performance.now()
  const model = new PunctuationRestorationModel(tokenizer)
  await model.load(
    options?.sherpaModelPath ??
      ('/sherpa-onnx-online-punct-en-2024-08-06/model.int8.onnx' satisfies PublicPath),
    options?.wasmUrl,
  )
  console.log(
    `[BilingualTube] sherpa-en model loaded: tokenizer ${(t1 - t0).toFixed(0)}ms, session ${(performance.now() - t1).toFixed(0)}ms`,
  )
  return model
}

// Loaded sessions are cached for the lifetime of the page: WASM compile +
// ONNX session init costs seconds on a busy YouTube tab and would otherwise
// be paid again for every video in the same SPA session.
let sherpaModelPromise: Promise<PunctuationRestorationModel> | null = null
let cjkModelPromise: Promise<CjkPunctModel> | null = null

export function getSherpaModel(options?: PunctuationOptions) {
  if (!sherpaModelPromise) {
    sherpaModelPromise = createModel(options)
    // Clear on failure so the next video retries instead of caching the error.
    sherpaModelPromise.catch(() => {
      sherpaModelPromise = null
    })
  }
  return sherpaModelPromise
}

async function createCjkModel(options: PunctuationOptions) {
  const t0 = performance.now()
  const model = new CjkPunctModel()
  await model.load(
    options.cjkPunctModelPath ??
      ('/cjk-punct-ja/model.int8.onnx' satisfies PublicPath),
    options.cjkPunctVocabPath ?? ('/cjk-punct-ja/vocab.json' satisfies PublicPath),
    options.wasmUrl,
  )
  console.log(
    `[BilingualTube] cjk-punct-ja model loaded in ${(performance.now() - t0).toFixed(0)}ms`,
  )
  return model
}

export function getCjkModel(options: PunctuationOptions) {
  if (!cjkModelPromise) {
    cjkModelPromise = createCjkModel(options)
    cjkModelPromise.catch(() => {
      cjkModelPromise = null
    })
  }
  return cjkModelPromise
}

/**
 * Streaming punctuation restoration using AsyncGenerator for window-by-window
 * output.
 *
 * For partially punctuated tracks (e.g. YouTube Gemini ASR with a few
 * unpunctuated stretches), only the unpunctuated spans (plus a small window of
 * surrounding context) are passed through `sherpa-en`. Already-punctuated
 * regions stay 100% verbatim. Yields progressively longer prefixes of the
 * full track so downstream `mergeRestorationUpdate` keeps index alignment
 * invariant at every step.
 */
export async function* restorePunctuation(
  tokens: TimedToken[],
  options?: PunctuationOptions,
): AsyncGenerator<TimedToken[], TimedToken[]> {
  if (tokens.length === 0) {
    yield []
    return []
  }

  const spans = findUnpunctuatedSpans(tokens)
  if (spans.length === 0) {
    const copy = tokens.slice()
    yield copy
    return copy
  }

  const model = await getSherpaModel(options)
  const output = tokens.slice()
  let lastYieldedFrontier = 0

  for (const span of spans) {
    const ctxStart = Math.max(0, span.start - SPAN_CONTEXT_TOKENS)
    const ctxEnd = Math.min(tokens.length, span.end + SPAN_CONTEXT_TOKENS)
    const entries = buildModelInputs(tokens, ctxStart, ctxEnd)
    if (entries.length === 0) {
      continue
    }

    const modelInputs = entries.map((e) => e.token)
    let appliedCount = 0

    for await (const processed of model.annotate(modelInputs)) {
      let maxUpdatedOrigIdx = -1
      for (let k = appliedCount; k < processed.length; k++) {
        const entry = entries[k]
        const annotated = processed[k]
        if (!entry || !annotated) continue
        if (entry.origIdx >= span.start && entry.origIdx < span.end) {
          const original = tokens[entry.origIdx]
          if (original) {
            output[entry.origIdx] = applyAnnotationToOriginal(
              annotated,
              original,
              entry.speakerPrefix,
            )
            maxUpdatedOrigIdx = entry.origIdx
          }
        }
      }
      appliedCount = processed.length

      if (maxUpdatedOrigIdx >= 0) {
        const frontier = Math.min(
          span.end,
          Math.max(lastYieldedFrontier, maxUpdatedOrigIdx + 1),
        )
        lastYieldedFrontier = frontier
        yield output.slice(0, frontier)
      }
    }
  }

  if (lastYieldedFrontier < output.length) {
    yield output.slice()
  }
  return output
}

/**
 * Japanese punctuation restoration via the char-level CJK model. Streams
 * token-with-punctuation arrays for compatibility with the same downstream
 * pipeline that consumes restorePunctuation's output.
 */
export async function* restorePunctuationJa(
  tokens: TimedToken[],
  options: PunctuationOptions,
): AsyncGenerator<TimedToken[], TimedToken[]> {
  const model = await getCjkModel(options)

  let result: TimedToken[] = []
  for await (const annotated of model.annotate(tokens)) {
    result = annotated
    yield result
  }
  return result
}
