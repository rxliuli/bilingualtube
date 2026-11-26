import { expect, it } from 'vitest'
import {
  PunctuationRestorationModel,
  type TimedToken,
} from './PunctuationRestorationModel'
import { BPETokenizer } from './bpeTokenizer'
import type { PublicPath } from 'wxt/browser'

it('should restore punctuation correctly', async () => {
  const tokenizer = new BPETokenizer()
  await tokenizer.load(
    '/sherpa-onnx-online-punct-en-2024-08-06/bpe.vocab' satisfies PublicPath,
  )
  const model = new PunctuationRestorationModel(tokenizer)
  await model.load(
    '/sherpa-onnx-online-punct-en-2024-08-06/model.int8.onnx' satisfies PublicPath,
  )
  const longText = `
      hey there how are you doing today i'm fine thanks 
      this is a long text that will be split into multiple windows
      we are testing the sliding window approach for punctuation restoration
      the model can only handle 200 tokens at a time
      so we need to split the input into smaller chunks
      each chunk will be processed separately
      and the results will be merged together
      the time stamps will be preserved throughout the process
      this is very important for subtitle generation
      or any other application that requires time alignment
      we can also simulate streaming recognition
      where new words arrive one by one in real time
      just like how speech recognition works
      the system will buffer the incoming words
      and process them in batches
      this makes the whole system very efficient
      and suitable for real time applications
      now lets see how well this works
    `
    .trim()
    .split(/\s+/)
  const tokens = longText.map(
    (word, index) =>
      ({
        text: word,
        start: index * 0.5,
        end: index * 0.5 + 0.5,
      } as TimedToken),
  )
  let r
  for await (const processed of model.annotate(tokens)) {
    r = processed
  }
  expect(model.renderAnnotatedTokens(r!))
    .include('.')
    .include(',')
    .include('?')
  expect(model.renderAnnotatedTokens(r!)).toMatch(
    /Hey there[.,] How are you doing today\?/,
  )
})

it('uses SentencePiece Unigram subwords instead of character-by-character fallback', async () => {
  const tokenizer = new BPETokenizer()
  await tokenizer.load(
    '/sherpa-onnx-online-punct-en-2024-08-06/bpe.vocab' satisfies PublicPath,
  )
  // Previously OOV words fell back to char-by-char (e.g. "friendship" = 10 tokens).
  expect(tokenizer.encodeWord('friendship').length).toBeLessThanOrEqual(4)
  expect(tokenizer.encodeWord('princess').length).toBeLessThanOrEqual(4)
  expect(tokenizer.encodeWord("wouldn't").length).toBeLessThanOrEqual(5)
})

// Regression: when OOV/long tokens shrink a sliding window to <= overlap tokens
// (e.g. 30 tokens in L73XYmYTmL8 at 19:00), keepStart >= keepEnd emitted 0
// tokens and dropped the window permanently, shifting every subsequent token.
it('never drops or duplicates tokens when windows shrink below overlap size', async () => {
  const tokenizer = new BPETokenizer()
  await tokenizer.load(
    '/sherpa-onnx-online-punct-en-2024-08-06/bpe.vocab' satisfies PublicPath,
  )
  const model = new PunctuationRestorationModel(tokenizer)
  await model.load(
    '/sherpa-onnx-online-punct-en-2024-08-06/model.int8.onnx' satisfies PublicPath,
  )
  // Force tiny windows (max 24 BPE tokens, overlap 18 -> overlapWords = 9)
  // with multi-subword words so windows regularly hold fewer than 18 tokens.
  model.setWindowConfig(24, 18)
  const words = Array.from(
    { length: 80 },
    (_, i) =>
      [
        'princess',
        'twilight',
        'sparkle',
        'alicorn',
        'amulet',
        'friendship',
        'magical',
        'wonderful',
      ][i % 8]!,
  )
  const tokens: TimedToken[] = words.map((word, index) => ({
    text: word,
    start: index * 0.5,
    end: index * 0.5 + 0.5,
  }))
  let r: TimedToken[] = []
  for await (const processed of model.annotate(tokens)) {
    r = processed
  }
  expect(r.length).toBe(tokens.length)
  expect(r.map((t) => t.text)).toEqual(words)
  expect(r.map((t) => t.start)).toEqual(tokens.map((t) => t.start))
})

// Regression: multi-word tokens (`>> Hello`, `going to`) expand into multiple
// whitespace-separated words inside BPETokenizer.encode(). Predictions must
// advance by each token's subword count so later tokens don't drift off by N.
it('keeps predictions aligned after multi-word tokens in the same window', async () => {
  const tokenizer = new BPETokenizer()
  await tokenizer.load(
    '/sherpa-onnx-online-punct-en-2024-08-06/bpe.vocab' satisfies PublicPath,
  )
  const model = new PunctuationRestorationModel(tokenizer)
  await model.load(
    '/sherpa-onnx-online-punct-en-2024-08-06/model.int8.onnx' satisfies PublicPath,
  )
  const tokens: TimedToken[] = [
    { start: 0, end: 1, text: '>> hey' },
    { start: 1, end: 2, text: 'there' },
    { start: 2, end: 3, text: 'how' },
    { start: 3, end: 4, text: 'are' },
    { start: 4, end: 5, text: 'you' },
    { start: 5, end: 6, text: 'doing' },
    { start: 6, end: 7, text: 'today' },
    { start: 7, end: 8, text: '>> where' },
    { start: 8, end: 9, text: 'are' },
    { start: 9, end: 10, text: 'you' },
    { start: 10, end: 11, text: 'going to' },
    { start: 11, end: 12, text: 'go' },
    { start: 12, end: 13, text: 'next' },
  ]
  let r
  for await (const processed of model.annotate(tokens)) {
    r = processed
  }
  expect(r!.length).toBe(tokens.length)
  // After `>> hey` (+1 extra subword), `?` must still land on "today", not "doing".
  expect(r![5]!.punctuation).toBe('')
  expect(r![6]!.punctuation).toBe('?')
  // After `>> where` and `going to` (+3 extra subwords total), `?` must still land on "next", not "go".
  expect(r![11]!.punctuation).toBe('')
  expect(r![12]!.punctuation).toBe('?')
})

// Regression: after the final window reached the end of the input, the
// overlap rewind ran one extra round and re-emitted the last ~15 tokens.
it('should not duplicate tail tokens across sliding windows', async () => {
  const tokenizer = new BPETokenizer()
  await tokenizer.load(
    '/sherpa-onnx-online-punct-en-2024-08-06/bpe.vocab' satisfies PublicPath,
  )
  const model = new PunctuationRestorationModel(tokenizer)
  await model.load(
    '/sherpa-onnx-online-punct-en-2024-08-06/model.int8.onnx' satisfies PublicPath,
  )
  // Enough words to require several sliding windows (~180 BPE tokens each)
  const words = Array.from(
    { length: 600 },
    (_, i) => ['the', 'quick', 'brown', 'fox', 'jumps', 'over'][i % 6],
  )
  const tokens = words.map(
    (word, index) =>
      ({
        text: word,
        start: index * 0.5,
        end: index * 0.5 + 0.5,
      } as TimedToken),
  )
  let r
  for await (const processed of model.annotate(tokens)) {
    r = processed
  }
  expect(r!.length).toBe(tokens.length)
  expect(r!.map((t) => t.text)).toEqual(words)
})
