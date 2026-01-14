import { PublicPath } from 'wxt/browser'
import { BPETokenizer } from './bpeTokenizer'
import {
  TimedToken,
  PunctuationRestorationModel,
} from './punctuationRestoration'

/**
 * 使用 LLM 对缺少标点符号的字幕进行标点修复
 * tip: 仅支持英文字幕
 * @param tokens
 * @returns
 */
export async function restorePunctuationInSubtitles(
  tokens: TimedToken[],
  options?: {
    wasmUrl: string
    sherpaModelPath: string
    sherpaVocabPath: string
  },
): Promise<TimedToken[]> {
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
  const r = await model.annotatePunctuation(tokens)
  return r.map((t) => ({
    ...t,
    // 特殊处理 [Music] 标签，保持不变
    text: t.text === '[Music]' ? t.text : t.casedText + t.punctuation,
  }))
}
