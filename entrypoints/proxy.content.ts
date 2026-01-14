import { eventMessager } from '@/lib/eventMessage'
import { messager } from '@/lib/message'

export default defineContentScript({
  matches: ['https://www.youtube.com/*'],
  runAt: 'document_start',
  async main() {
    eventMessager.onMessage('translate', (ev) =>
      messager.sendMessage('translate', ev.data),
    )
    eventMessager.onMessage('getSettings', () =>
      messager.sendMessage('getSettings'),
    )
    eventMessager.onMessage('getPunctuationOptions', () => ({
      wasmUrl: browser.runtime.getURL(
        '/onnxruntime-web/ort-wasm-simd-threaded.wasm',
      ),
      sherpaModelPath: browser.runtime.getURL(
        '/sherpa-onnx-online-punct-en-2024-08-06/model.int8.onnx',
      ),
      sherpaVocabPath: browser.runtime.getURL(
        '/sherpa-onnx-online-punct-en-2024-08-06/bpe.vocab',
      ),
    }))
  },
})
