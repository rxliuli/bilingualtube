import { PublicPath } from 'wxt/browser'
import { BPETokenizer } from './bpeTokenizer'
import {
  TimedToken,
  PunctuationRestorationModel,
  AnnotatedToken,
} from './PunctuationRestorationModel'

function mapAnnotatedToTimed(tokens: AnnotatedToken[]): TimedToken[] {
  return tokens.map((t) => ({
    ...t,
    // Special handling for [Music] and [Applause] tags, keep unchanged
    text: ['[Music]', '[Applause]'].includes(t.text)
      ? t.text
      : t.casedText + t.punctuation,
  }))
}

interface PunctuationOptions {
  wasmUrl: string
  sherpaModelPath: string
  sherpaVocabPath: string
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

  let result: TimedToken[] = []
  for await (const processed of model.annotate(tokens)) {
    result = mapAnnotatedToTimed(processed)
    yield result
  }
  return result
}
