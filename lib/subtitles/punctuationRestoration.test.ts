import { expect, it } from 'vitest'
import {
  PunctuationRestorationModel,
  TimedToken,
} from './punctuationRestoration'
import { BPETokenizer } from './bpeTokenizer'
import { PublicPath } from 'wxt/browser'

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
  const r = await model.annotatePunctuation(tokens)
  expect(model.renderAnnotatedTokens(r))
    .include('.')
    .include(',')
    .include('?')
    .include('Hey there. How are you doing today?')
})
