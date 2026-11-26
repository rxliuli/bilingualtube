import type { TimedToken } from './subtitles/PunctuationRestorationModel'
import type { GetTimedtextResp } from './subtitles/youtube-types'

export interface TranslationToken extends TimedToken {
  translated?: string
}

type SubtitleEntry = {
  videoId: string
  lang: string
  text: GetTimedtextResp
  cues: TranslationToken[]
}

type Listener = (currentTime: number) => void

class SubtitleStore {
  subtitle: SubtitleEntry | null = null
  currentTime: number = 0
  translationError: string | null = null

  private listeners: Set<Listener> = new Set()

  setSubtitle(subtitle: SubtitleEntry) {
    this.subtitle = subtitle
  }

  setTranslationError(error: string | null) {
    if (this.translationError === error) return
    this.translationError = error
    this.listeners.forEach((listener) => listener(this.currentTime))
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
    this.translationError = null
    this.abortController = new AbortController()
    this.listeners.forEach((listener) => listener(0))
  }
  getSignal() {
    return this.abortController.signal
  }
}

export const store = new SubtitleStore()
