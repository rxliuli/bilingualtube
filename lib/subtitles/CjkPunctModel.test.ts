import { expect, it } from 'vitest'
import { PublicPath } from 'wxt/browser'
import { CjkPunctModel } from './CjkPunctModel'
import type { TimedToken } from './PunctuationRestorationModel'

const MODEL_PATH: PublicPath = '/cjk-punct-ja/model.int8.onnx'
const VOCAB_PATH: PublicPath = '/cjk-punct-ja/vocab.json'

it('inserts Japanese punctuation on a long YouTube-style run', async () => {
  const model = new CjkPunctModel()
  await model.load(MODEL_PATH, VOCAB_PATH)

  const tokens: TimedToken[] = [
    {
      start: 0,
      end: 10,
      text: 'もうすぐ発売なので楽しみにしてるんですよそれに向けてねたくさん練習していきましょう',
    },
  ]
  let final: TimedToken[] = []
  for await (const annotated of model.annotate(tokens)) {
    final = annotated
  }
  const joinedText = final.map((t) => t.text).join('')
  console.log('output:', joinedText)
  console.log('  split into', final.length, 'sub-cues')
  // (a) at least one terminal punct emitted somewhere, (b) all original chars
  // preserved (after stripping the inserted punct).
  expect(joinedText).toMatch(/[。！？]/)
  expect(joinedText.replace(/[。、？！]/g, '')).toBe(tokens[0].text)
}, 60000)

it('never produces a sub-cue that is just punctuation', async () => {
  const model = new CjkPunctModel()
  await model.load(MODEL_PATH, VOCAB_PATH)
  // Inputs that include YouTube's own punctuation — model should not split
  // such that a stray `。` becomes its own cue.
  const tokens: TimedToken[] = [
    { start: 0, end: 5, text: '届けたいと思ってます。' },
    { start: 5, end: 10, text: 'いいものしか出さないっていうのは' },
    { start: 10, end: 15, text: 'やっぱり一番大事ですよね。' },
  ]
  let final: TimedToken[] = []
  for await (const annotated of model.annotate(tokens)) {
    final = annotated
  }
  console.log('out:', final.map((t) => t.text))
  for (const t of final) {
    const stripped = t.text.replace(/[。、？！,.?!\s]/g, '')
    expect(stripped.length, `sub-cue is punctuation-only: ${t.text}`).toBeGreaterThan(0)
  }
}, 60000)

it('annotates fragmented tokens, attaching punctuation to the token that ends a clause', async () => {
  const model = new CjkPunctModel()
  await model.load(MODEL_PATH, VOCAB_PATH)

  // Tokens split so that the boundary between "ですよ" and "それに" is across
  // tokens — model should put a sentence-terminator on the "ですよ" token.
  const tokens: TimedToken[] = [
    { start: 0, end: 1, text: 'もうすぐ発売なので' },
    { start: 1, end: 2, text: '楽しみにしてるんですよ' },
    { start: 2, end: 3, text: 'それに向けてね' },
    { start: 3, end: 4, text: 'たくさん練習していきましょう' },
  ]
  let final: TimedToken[] = []
  for await (const annotated of model.annotate(tokens)) {
    final = annotated
  }
  console.log('annotated tokens:', final.map((t) => t.text))

  // Timing preserved
  expect(final.length).toBe(tokens.length)
  expect(final[0].start).toBe(0)
  expect(final.at(-1)!.end).toBe(4)
  // Concatenated original chars round-trip (after stripping inserted punct).
  const concatStripped = final
    .map((t) => t.text)
    .join('')
    .replace(/[。、？！]/g, '')
  const concatOriginal = tokens.map((t) => t.text).join('')
  expect(concatStripped).toBe(concatOriginal)
  // At least one token should end with terminal punctuation.
  expect(final.some((t) => /[。！？]$/.test(t.text))).toBe(true)
}, 60000)
