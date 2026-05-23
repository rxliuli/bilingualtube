import { expect, it } from 'vitest'
import { PublicPath } from 'wxt/browser'
import { CjkPunctModel } from './CjkPunctModel'
import {
  convertYoutubeToStandardFormat,
  sentencesInSubtitles,
} from './subtitle-utils'
import type { GetTimedtextResp } from './youtube-types'

const MODEL_PATH: PublicPath = '/cjk-punct-ja/model.int8.onnx'
const VOCAB_PATH: PublicPath = '/cjk-punct-ja/vocab.json'

/**
 * End-to-end smoke through the production pipeline on a real cooking-channel
 * Japanese ASR track. Doesn't pin exact output (the model is non-deterministic
 * across versions), but scans for known-bad patterns we've seen in production.
 */
it('full pipeline on real ja ASR cooking video', async () => {
  const data = (await import('./assets/timedtext-MeQue7FK_Nk.json'))
    .default as GetTimedtextResp
  const tokens = convertYoutubeToStandardFormat(data)
  console.log(`raw tokens: ${tokens.length}`)

  const model = new CjkPunctModel()
  await model.load(MODEL_PATH, VOCAB_PATH)

  let annotated = tokens
  for await (const batch of model.annotate(tokens)) {
    annotated = batch
  }
  console.log(`annotated tokens (after model split): ${annotated.length}`)

  const cues = sentencesInSubtitles(annotated, 'ja')
  console.log(`final cues: ${cues.length}`)

  // Quality scans
  const doublePunct: string[] = []
  const standalonePunct: string[] = []
  const tooLong: string[] = []
  const tooShort: string[] = []
  for (const c of cues) {
    if (/[。、！？]{2,}|[.,!?]{2,}/.test(c.text)) doublePunct.push(c.text)
    if (c.text.replace(/[\s。、！？,.?!]/g, '').length === 0)
      standalonePunct.push(c.text)
    const cpLen = [...c.text].length
    if (cpLen > 60) tooLong.push(`(${cpLen}) ${c.text}`)
    if (cpLen <= 5) tooShort.push(`(${cpLen}) ${c.text}`)
  }

  console.log('\n--- problem patterns ---')
  console.log(
    `double-punctuation cues: ${doublePunct.length}  e.g.`,
    doublePunct.slice(0, 5),
  )
  console.log(
    `standalone-punct cues: ${standalonePunct.length}  e.g.`,
    standalonePunct.slice(0, 5),
  )
  console.log(
    `over-long (>60 cp) cues: ${tooLong.length}  e.g.`,
    tooLong.slice(0, 3),
  )
  console.log(
    `tiny (≤5 cp) cues: ${tooShort.length}  e.g.`,
    tooShort.slice(0, 8),
  )

  console.log('\n--- first 30 cues ---')
  cues.slice(0, 30).forEach((c, i) =>
    console.log(
      `  [${i}] ${c.start.toFixed(1)}-${c.end.toFixed(1)}  ${c.text}`,
    ),
  )

  // Pipeline must run end-to-end; we assert the worst regressions don't happen.
  expect(standalonePunct.length, 'standalone-punct cues').toBe(0)
  expect(doublePunct.length, 'cues with 。。/、、 doubles').toBe(0)
  expect(tooLong.length, 'over-long cues (>60 cp)').toBe(0)
  // Some tiny cues are unavoidable: YouTube ASR itself emits 0.1s-long
  // single-fragment cues like 「ま、」. Cap at a reasonable ratio.
  expect(
    tooShort.length / cues.length,
    `tiny-cue ratio: ${tooShort.length} of ${cues.length}`,
  ).toBeLessThan(0.2)
}, 120000)
