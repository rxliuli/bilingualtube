import { eventMessager } from '@/lib/eventMessage'
import { messager } from '@/lib/message'

export default defineContentScript({
  matches: ['https://www.youtube.com/**'],
  main() {
    eventMessager.onMessage('translate', (ev) =>
      messager.sendMessage('translate', ev.data),
    )
    eventMessager.onMessage('getSettings', () =>
      messager.sendMessage('getSettings'),
    )
  },
})
