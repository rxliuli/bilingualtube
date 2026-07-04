import { PublicPath } from 'wxt/browser'
import { BPETokenizer } from './bpeTokenizer'
import {
  TimedToken,
  PunctuationRestorationModel,
  AnnotatedToken,
} from './PunctuationRestorationModel'
import { CjkPunctModel } from './CjkPunctModel'

/**
 * Merge model annotations back into display text. Tracks can be partially
 * punctuated (e.g. interviews where only the anchor's speech is punctuated),
 * so tokens that already carry punctuation are kept verbatim — YouTube's own
 * punctuation and casing beat the model's re-annotation. For the rest, only
 * CAP (sentence-start) case predictions are honored: the model's UPPER/LOWER
 * predictions are noisy and would clobber YouTube's proper-noun casing.
 */
function mapAnnotatedToTimed(
  tokens: AnnotatedToken[],
  originals: TimedToken[],
): TimedToken[] {
  return tokens.map((t, i) => {
    const original = originals[i].text
    // Special handling for [Music] and [Applause] tags, keep unchanged
    if (['[Music]', '[Applause]'].includes(original)) {
      return { ...t, text: original }
    }
    if (/[.,!?]$/.test(original)) {
      return { ...t, text: original }
    }
    const cased =
      t.caseType === 'CAP'
        ? t.text.charAt(0).toUpperCase() + t.text.slice(1)
        : t.text
    return { ...t, text: cased + t.punctuation }
  })
}

interface PunctuationOptions {
  wasmUrl: string
  sherpaModelPath: string
  sherpaVocabPath: string
  cjkPunctModelPath?: string
  cjkPunctVocabPath?: string
}

async function createModel(options?: PunctuationOptions) {
  const tokenizer = new BPETokenizer()
  await tokenizer.load(
    options?.sherpaVocabPath ??
      ('/sherpa-onnx-online-punct-en-2024-08-06/bpe.vocab' satisfies PublicPath),
  )
  const model = new PunctuationRestorationModel(tokenizer)
  await model.load(
    options?.sherpaModelPath ??
      ('/sherpa-onnx-online-punct-en-2024-08-06/model.int8.onnx' satisfies PublicPath),
    options?.wasmUrl,
  )
  return model
}

/**
 * Streaming punctuation restoration using AsyncGenerator for window-by-window output
 */
export async function* restorePunctuation(
  tokens: TimedToken[],
  options?: PunctuationOptions,
): AsyncGenerator<TimedToken[], TimedToken[]> {
  const model = await createModel(options)

  // Strip existing trailing punctuation before feeding the model so it never
  // doubles up (e.g. "2026." + predicted "." -> "2026.."). The original text
  // is restored verbatim for those tokens in mapAnnotatedToTimed. Tokens that
  // are pure punctuation stay unchanged to keep word alignment intact.
  const stripped = tokens.map((t) => {
    const text = t.text.replace(/[.,!?]+$/, '')
    return text === '' ? t : { ...t, text }
  })

  let result: TimedToken[] = []
  for await (const processed of model.annotate(stripped)) {
    // annotate() yields prefixes of the input, so index i maps to tokens[i]
    result = mapAnnotatedToTimed(processed, tokens)
    yield result
  }
  return result
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
  const model = new CjkPunctModel()
  await model.load(
    options.cjkPunctModelPath ??
      ('/cjk-punct-ja/model.int8.onnx' satisfies PublicPath),
    options.cjkPunctVocabPath ??
      ('/cjk-punct-ja/vocab.json' satisfies PublicPath),
    options.wasmUrl,
  )

  let result: TimedToken[] = []
  for await (const annotated of model.annotate(tokens)) {
    result = annotated
    yield result
  }
  return result
}
