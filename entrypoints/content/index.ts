import { interceptFetch, interceptXHR, Vista } from '@rxliuli/vista'
import globalStyle from './global.css?inline'
import { store, type TranslationToken } from '../../lib/store'
import { eventMessager } from '@/lib/eventMessage'
import type { GetTimedtextResp } from '../../lib/subtitles/youtube-types'
import { observeElement } from '@/lib/observeElement'
import { normalizeLanguageCode } from '@/lib/translate/lang'
import {
  convertYoutubeToStandardFormat,
  resolveSubtitleTrack,
  sentencesInSubtitles,
  splitBlockTokensToWords,
} from '@/lib/subtitles/subtitle-utils'
import {
  findMatchingSubtitle,
  getCuesToTranslate,
  shouldTriggerTranslation,
} from '@/lib/subtitles/cues-utils'
import {
  restorePunctuation,
  restorePunctuationJa,
} from '@/lib/subtitles/restorePunctuationInSubtitles'
import { mergeRestorationUpdate } from '@/lib/subtitles/restorationMerge'
import { skipWhileRunning } from '@/lib/async-utils'
import { mirrorNativeCaptionStyle } from './subtitleStyleMirror'
import {
  getActiveVideoId,
  getVideoIdFromUrl,
  isTimedtextForActiveVideo,
  shouldResetSubtitleForVideo,
  type ActiveVideoContext,
} from '@/lib/subtitles/video-id'

// Header to identify internal extension requests
const INTERNAL_REQUEST_HEADER = 'X-BilingualTube-Internal'

type MoviePlayerElement = Element & {
  getVideoData?: () => { video_id?: string } | undefined
}

function getActivePlayerVideoId(): string | null {
  const moviePlayer = document.querySelector(
    '#movie_player',
  ) as MoviePlayerElement | null
  if (!moviePlayer) return null
  const rect = moviePlayer.getBoundingClientRect()
  if (rect.width === 0 || rect.height === 0) {
    return null
  }
  return moviePlayer.getVideoData?.()?.video_id || null
}

function getActiveVideoContext(): ActiveVideoContext {
  return {
    urlVideoId: getVideoIdFromUrl(location.href),
    playerVideoId: getActivePlayerVideoId(),
  }
}

export default defineContentScript({
  matches: ['https://www.youtube.com/*'],
  runAt: 'document_start',
  world: 'MAIN',

  async main() {
    console.log('[BilingualTube] Content Script Loaded.')
    setupSubtitleInterception()
    setupPageDataUpdatedListener()
    // Inject UI container script and mount React component (hidden by default)
    observeElement({
      selector: '#movie_player',
      onElement: () => {
        console.log('[BilingualTube] Movie player element observed')
        setupSubtitleUI()
        setupVideoProgressListener()
        console.log('[BilingualTube] Content Script Initialized.')
      },
      root: document.documentElement,
    })
  },
})

function setupSubtitleInterception() {
  const vista = new Vista([interceptFetch, interceptXHR])
  // Inject XHR interception script to listen for YouTube subtitle data requests
  vista
    .use(async (c, next) => {
      if (!c.req.url.startsWith('https://www.youtube.com/api/timedtext')) {
        await next()
        return
      }
      // Skip processing if it's an internal extension request
      if (c.req.headers.get(INTERNAL_REQUEST_HEADER)) {
        await next()
        return
      }
      const searchParams = new URL(c.req.url).searchParams
      const requestVideoId = searchParams.get('v')
      const initialContext = getActiveVideoContext()
      if (!isTimedtextForActiveVideo(requestVideoId, initialContext)) {
        console.log(
          `[BilingualTube] Ignoring timedtext for non-active video (v=${requestVideoId ?? '-'}, active=${getActiveVideoId(initialContext) ?? '-'}).`,
        )
        await next()
        return
      }
      const videoId = requestVideoId!
      // Always reset before awaiting so any in-flight request or punctuation
      // stream for a previous video/track is aborted immediately.
      store.reset()
      const signal = store.getSignal()
      console.log(
        `[BilingualTube] Subtitle store reset for video ${videoId}.`,
      )
      await next()
      if (
        signal.aborted ||
        !isTimedtextForActiveVideo(videoId, getActiveVideoContext())
      ) {
        return
      }
      if (c.res.status !== 200) {
        console.error(
          '[BilingualTube] Subtitle fetch error: ',
          c.res.status,
          c.req.url,
        )
        throw new Error('Subtitle fetch error: ' + c.res.status)
      }
      const resp = (await c.res.clone().json()) as GetTimedtextResp
      if (
        signal.aborted ||
        !isTimedtextForActiveVideo(videoId, getActiveVideoContext())
      ) {
        return
      }
      if (!resp.events) {
        console.error(
          '[BilingualTube] Subtitle response parse error: ',
          c.req.url,
        )
        throw new Error(
          'Subtitle response parse error, see console for details.',
        )
      }
      const rawLang = searchParams.get('lang')
      if (!rawLang) {
        console.error(
          '[BilingualTube] Subtitle lang not found in request URL: ',
          c.req.url,
        )
        throw new Error('Subtitle lang not found in request URL.')
      }
      // `tlang` marks a YouTube auto-translated track (see resolveSubtitleTrack).
      const tlang = searchParams.get('tlang')
      if (tlang) {
        // Re-fetch original subtitles without `tlang` to avoid double
        // translation (e.g. ja→en→zh). The re-fetch is intercepted by
        // Vista again and processed through the normal pipeline.
        const originalUrl = new URL(c.req.url)
        originalUrl.searchParams.delete('tlang')
        console.log(
          `[BilingualTube] Auto-translated track detected (lang=${rawLang}, tlang=${tlang}), re-fetching original subtitles.`,
        )
        fetch(originalUrl.toString())
        return
      }
      const kind = searchParams.get('kind')
      let data = convertYoutubeToStandardFormat(resp)
      const { lang, mode } = resolveSubtitleTrack({
        rawLang,
        tlang,
        kind,
        data,
      })
      console.log(
        `[BilingualTube] Subtitle track: lang=${rawLang} (normalized=${lang}) kind=${kind} tlang=${tlang ?? '-'} mode=${mode}`,
      )
      const t = new URL(location.href).searchParams.get('t')
      let seconds = 0
      if (t && t.match(/^\d+s$/)) {
        seconds = Number.parseInt(t.slice(0, -1), 10)
      }

      if (mode === 'sherpa-en' || mode === 'cjk-punct-ja') {
        try {
          console.log(
            `[BilingualTube] Auto-generated subtitles detected, using ${mode}`,
          )
          // sherpa-en maps predictions 1:1 to input tokens; expand newer
          // block-level ASR segs into word-level tokens so indices stay aligned.
          if (mode === 'sherpa-en') {
            data = splitBlockTokensToWords(data)
          }
          // Show raw cues immediately while the model loads (hardMaxLength
          // caps unpunctuated runs); the stream below progressively replaces
          // them with punctuation-restored text.
          store.setSubtitle({
            videoId,
            lang,
            text: resp,
            cues: sentencesInSubtitles(data, lang),
          })
          triggerTranslation(store.currentTime)
          const options = await eventMessager.sendMessage(
            'getPunctuationOptions',
          )
          if (
            signal.aborted ||
            !isTimedtextForActiveVideo(videoId, getActiveVideoContext())
          ) {
            console.log('[BilingualTube] Punctuation restoration aborted.')
            return
          }
          // Use streaming, update subtitles after each window is processed
          const stream =
            mode === 'sherpa-en'
              ? restorePunctuation(data, options)
              : restorePunctuationJa(data, options)
          for await (const processed of stream) {
            if (
              signal.aborted ||
              !isTimedtextForActiveVideo(videoId, getActiveVideoContext())
            ) {
              console.log('[BilingualTube] Punctuation restoration aborted.')
              return
            }
            const mergedCues = mergeRestorationUpdate(
              processed,
              data,
              store.subtitle?.cues || [],
              lang,
            )

            store.setSubtitle({
              videoId,
              lang,
              text: resp,
              cues: mergedCues,
            })

            // Cheap when nothing changed: only visible untranslated cues are
            // fetched, so this re-translates the cue at the playhead only if
            // restoration just rewrote it.
            triggerTranslation(store.currentTime)
          }
          console.log('[BilingualTube] Auto-generated subtitles processed.')
        } catch (error) {
          if (
            signal.aborted ||
            !isTimedtextForActiveVideo(videoId, getActiveVideoContext())
          ) {
            console.log('[BilingualTube] Punctuation restoration aborted.')
            return
          }
          console.error('[BilingualTube] Punctuation restoration failed:', error)
          // Use original data on failure
          data = sentencesInSubtitles(data, lang)
          store.setSubtitle({
            videoId,
            lang,
            text: resp,
            cues: data,
          })
        }
      } else if (mode === 'sentences') {
        // Already-clean text with word-level segments: better auto-generated
        // ASR, or a YouTube auto-translated track. Group into sentences; never
        // run the source-language punctuation models.
        console.log('[BilingualTube] Clean subtitles, grouping into sentences.')
        data = sentencesInSubtitles(data, lang)
        store.setSubtitle({
          videoId,
          lang,
          text: resp,
          cues: data,
        })
        await triggerTranslation(seconds)
      } else {
        // Manual captions: events are already line-level cues.
        store.setSubtitle({
          videoId,
          lang,
          text: resp,
          cues: data,
        })
        await triggerTranslation(seconds)
      }
      console.log('[BilingualTube] response: ', store.subtitle)
    })
    .intercept()
  return () => {
    vista.destroy()
  }
}

function setupSubtitleUI() {
  // Hide default subtitle display UI
  const style = document.createElement('style')
  style.textContent = globalStyle
  document.head.appendChild(style)
  // Inject subtitle overlay UI component
  const subtitleOverlay = createSubtitleOverlay()
  const stopStyleMirror = mirrorNativeCaptionStyle(subtitleOverlay.element)
  if (!isLive()) {
    subtitleOverlay.update('BilingualTube Subtitle Loaded')
  }
  let currentCue: TranslationToken | null = null
  const clean = store.subscribe(async (currentTime) => {
    const signal = store.getSignal()
    const cue = findMatchingSubtitle(store.subtitle?.cues || [], currentTime)
    const translationText = cue?.translated

    // Check if there are changes
    if (
      cue?.text === currentCue?.text &&
      translationText === currentCue?.translated
    ) {
      return
    }

    if (cue) {
      const settings = await eventMessager.sendMessage('getSettings')
      // Simplified/Traditional Chinese conversion is implicitly translation-only:
      // same content, different characters, so bilingual display is meaningless.
      const isChineseConversion = await isChineseVariantConversion()
      if (signal.aborted) {
        return
      }
      const displayMode = settings.displayMode ?? 'bilingual'
      if (
        translationText &&
        (displayMode === 'translation-only' || isChineseConversion)
      ) {
        // Translation-only: hide the original line. Falls through to bilingual
        // when no translation exists yet (e.g. still translating, or same lang).
        subtitleOverlay.update(translationText)
      } else {
        // Normal case: show original and translation (if available)
        subtitleOverlay.update(cue.text, translationText)
      }
    } else {
      subtitleOverlay.update('')
    }
    currentCue = cue ? JSON.parse(JSON.stringify(cue)) : null
  })
  return () => {
    document.head.removeChild(style)
    stopStyleMirror()
    subtitleOverlay.destroy()
    clean()
  }
}

function createSubtitleOverlay() {
  const moviePlayer = document.querySelector('#movie_player')
  if (!moviePlayer) {
    throw new Error('Movie player not found')
  }
  let container = document.querySelector<HTMLDivElement>(
    '#bilingual-tube-subtitle-overlay',
  )
  if (!container) {
    container = document.createElement('div')
    container.id = 'bilingual-tube-subtitle-overlay'

    // Pre-create two divs
    const originalDiv = document.createElement('div')
    originalDiv.className = 'subtitle-original'

    const translatedDiv = document.createElement('div')
    translatedDiv.className = 'subtitle-translated'

    container.appendChild(originalDiv)
    container.appendChild(translatedDiv)

    moviePlayer.appendChild(container)
  }

  const originalDiv = container.querySelector(
    '#bilingual-tube-subtitle-overlay .subtitle-original',
  ) as HTMLDivElement
  const translatedDiv = container.querySelector(
    '#bilingual-tube-subtitle-overlay .subtitle-translated',
  ) as HTMLDivElement

  return {
    element: container,
    update(original: string, translated?: string) {
      originalDiv.textContent = original
      if (translated) {
        translatedDiv.textContent = translated
        translatedDiv.style.display = 'block'
      } else {
        translatedDiv.textContent = ''
        translatedDiv.style.display = 'none'
      }
    },
    destroy() {
      container?.remove()
    },
  }
}

function isLive() {
  return document.querySelector('#movie_player .ytp-live') !== null
}

/**
 * Check if source and target languages are the same (no translation needed)
 * Uses BCP 47 standard for language code comparison
 */
async function isSameLanguage(): Promise<boolean> {
  const sourceLang = store.subtitle?.lang
  if (!sourceLang) return false

  const settings = await eventMessager.sendMessage('getSettings')
  const targetLang = settings.to ?? 'en'

  // Normalize to BCP 47 standard format before comparison
  const normalizedSource = normalizeLanguageCode(sourceLang)
  const normalizedTarget = normalizeLanguageCode(targetLang)

  return normalizedSource === normalizedTarget
}

/**
 * Check if it's a conversion between simplified and traditional Chinese
 * Simplified/Traditional Chinese needs translation, but should not display bilingual subtitles (same content, different characters)
 */
async function isChineseVariantConversion(): Promise<boolean> {
  const sourceLang = store.subtitle?.lang
  if (!sourceLang) return false

  const settings = await eventMessager.sendMessage('getSettings')
  const targetLang = settings.to ?? 'en'

  const normalizedSource = normalizeLanguageCode(sourceLang)
  const normalizedTarget = normalizeLanguageCode(targetLang)

  // Check if it's a conversion between simplified and traditional Chinese
  const chineseVariants = ['zh-Hans', 'zh-Hant']
  return (
    chineseVariants.includes(normalizedSource) &&
    chineseVariants.includes(normalizedTarget) &&
    normalizedSource !== normalizedTarget
  )
}

// skipWhileRunning drops calls arriving while a translation batch is in
// flight (stream yields and timeupdate can fire in the same tick).
const triggerTranslation = skipWhileRunning(async (currentTime: number) => {
  const signal = store.getSignal()
  const cues = store.subtitle?.cues ?? []
  if (!shouldTriggerTranslation(cues, currentTime)) {
    return
  }

  // Check if source and target languages are the same
  if (await isSameLanguage()) {
    return
  }
  if (signal.aborted) {
    return
  }

  const cuesToTranslate = getCuesToTranslate(cues, currentTime)
  if (cuesToTranslate.length === 0) return

  try {
    console.log(`[BilingualTube] Translating ${cuesToTranslate.length} cues`)
    const texts = cuesToTranslate.map((cue) => cue.text)
    const translations = await eventMessager.sendMessage('translate', texts)
    if (signal.aborted) {
      console.log('[BilingualTube] Translation aborted.')
      return
    }

    // Update translations of cues
    cuesToTranslate.forEach((cue, index) => {
      cue.translated = translations[index]
    })
    // Trigger subtitle display update
    store.setCurrentTime(store.currentTime)

    console.log(`[BilingualTube] Translated ${cuesToTranslate.length} cues`)
  } catch (error) {
    if (signal.aborted) {
      console.log('[BilingualTube] Translation aborted.')
      return
    }
    console.error('[BilingualTube] Translation failed:', error)
    throw new Error(
      `Translation failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    )
  }
})

function setupVideoProgressListener() {
  const moviePlayer = document.querySelector('#movie_player')
  if (!moviePlayer) {
    throw new Error('Movie player not found')
  }
  moviePlayer.addEventListener('onVideoProgress', (ev) => {
    const currentTime = ev as unknown as number
    store.setCurrentTime(currentTime)
    // Trigger translation
    triggerTranslation(currentTime)
  })
}

function setupPageDataUpdatedListener() {
  const onPageDataUpdated = () => {
    const activeVideoId = getActiveVideoId(getActiveVideoContext())
    if (shouldResetSubtitleForVideo(store.subtitle?.videoId, activeVideoId)) {
      store.reset()
      console.log(
        `[BilingualTube] Navigated to different video, subtitle store reset (active=${activeVideoId ?? '-'}).`,
      )
    }
  }
  document.addEventListener('yt-navigate-finish', onPageDataUpdated)
  document.addEventListener('yt-page-data-updated', onPageDataUpdated)
  return () => {
    document.removeEventListener('yt-navigate-finish', onPageDataUpdated)
    document.removeEventListener('yt-page-data-updated', onPageDataUpdated)
  }
}
