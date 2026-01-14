import { TimedToken } from './subtitles/PunctuationRestorationModel'
import { GetTimedtextResp } from './subtitles/youtube-types'

export interface TranslationToken extends TimedToken {
  translated?: string
}

type SubtitleEntry = {
  lang: string
  text: GetTimedtextResp
  cues: TranslationToken[]
  officialTranslation?: {
    lang: string
    text: GetTimedtextResp
    cues: TranslationToken[]
  }
}

type Listener = (currentTime: number) => void

class SubtitleStore {
  subtitle: SubtitleEntry | null = null
  currentTime: number = 0

  private listeners: Set<Listener> = new Set()

  setSubtitle(subtitle: SubtitleEntry) {
    this.subtitle = subtitle
  }

  setOfficialTranslation(
    lang: string,
    text: GetTimedtextResp,
    cues: TranslationToken[],
  ) {
    if (this.subtitle) {
      this.subtitle.officialTranslation = { lang, text, cues }
    }
  }

  setCurrentTime(time: number) {
    this.currentTime = time
    // Notify all listeners
    this.listeners.forEach((listener) => listener(time))
  }

  subscribe(listener: Listener) {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  abortController: AbortController = new AbortController()
  reset() {
    this.abortController.abort()
    this.subtitle = null
    this.currentTime = 0
    this.abortController = new AbortController()
  }
  getSignal() {
    return this.abortController.signal
  }
}

export const subtitleStore = new SubtitleStore()
