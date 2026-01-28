import { interceptFetch, interceptXHR, Vista } from '@rxliuli/vista'
import globalStyle from './global.css?inline'
import { store, TranslationToken } from '../../lib/store'
import { eventMessager } from '@/lib/eventMessage'
import { GetTimedtextResp } from '../../lib/subtitles/youtube-types'
import { observeElement } from '@/lib/observeElement'
import { normalizeLanguageCode } from '@/lib/translate/lang'
import {
  convertYoutubeToStandardFormat,
  hasMissingPunctuation,
  sentencesInSubtitles,
} from '@/lib/subtitles/subtitle-utils'
import {
  findMatchingSubtitle,
  getCuesToTranslate,
  shouldTriggerTranslation,
} from '@/lib/subtitles/cues-utils'
import { restorePunctuation } from '@/lib/subtitles/restorePunctuationInSubtitles'

// Header to identify internal extension requests
const INTERNAL_REQUEST_HEADER = 'X-BilingualTube-Internal'

export default defineContentScript({
  matches: ['https://www.youtube.com/*'],
  runAt: 'document_start',
  world: 'MAIN',

  async main() {
    console.log('[BilingualTube] Content Script Loaded.')
    setupSubtitleInterception()
    // Inject UI container script and mount React component (hidden by default)
    observeElement({
      selector: '#movie_player',
      onElement: () => {
        console.log('[BilingualTube] Movie player element observed')
        setupSubtitleUI()
        setupVideoProgressListener()
        // setupPageDataUpdatedListener()
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
      // Each time new subtitles are loaded, it means a new video is loaded, so we need to clear the previous subtitle data
      if (store.subtitle) {
        store.reset()
        console.log('[BilingualTube] Subtitle store reset for new video.')
      }
      await next()
      if (c.res.status !== 200) {
        console.error(
          '[BilingualTube] Subtitle fetch error: ',
          c.res.status,
          c.req.url,
        )
        throw new Error('Subtitle fetch error: ' + c.res.status)
      }
      const resp = (await c.res.clone().json()) as GetTimedtextResp
      if (!resp.events) {
        console.error(
          '[BilingualTube] Subtitle response parse error: ',
          c.req.url,
        )
        throw new Error(
          'Subtitle response parse error, see console for details.',
        )
      }
      const searchParams = new URL(c.req.url).searchParams
      const lang = searchParams.get('lang')
      if (!lang) {
        console.error(
          '[BilingualTube] Subtitle lang not found in request URL: ',
          c.req.url,
        )
        throw new Error('Subtitle lang not found in request URL.')
      }
      const kind = searchParams.get('kind')
      let data = convertYoutubeToStandardFormat(resp)
      const t = new URL(location.href).searchParams.get('t')
      let seconds = 0
      if (t && t.match(/^\d+s$/)) {
        seconds = Number.parseInt(t.slice(0, -1), 10)
      }

      if (kind === 'asr') {
        if (lang === 'en' && hasMissingPunctuation(data)) {
          try {
            console.log('[BilingualTube] Auto-generated subtitles detected.')
            const options = await eventMessager.sendMessage(
              'getPunctuationOptions',
            )
            // Use streaming, update subtitles after each window is processed
            const signal = store.getSignal()
            let lastCuesLength = 0
            for await (const processed of restorePunctuation(data, options)) {
              if (signal.aborted) {
                console.log('[BilingualTube] Punctuation restoration aborted.')
                throw new Error('Punctuation restoration aborted.')
              }
              const cues = sentencesInSubtitles(processed, lang)
              store.setSubtitle({
                lang,
                text: resp,
                cues: [
                  ...(store.subtitle?.cues.slice(0, lastCuesLength) || []),
                  // Update only newly processed cues
                  ...cues.slice(lastCuesLength),
                ],
              })
              // console.log(
              //   '[BilingualTube] Auto-generated subtitles updated chunk.',
              //   store.currentTime,
              //   cues[lastCuesLength].start,
              //   cues[cues.length - 1].end,
              // )
              if (
                cues.length > lastCuesLength &&
                store.currentTime >= cues[lastCuesLength].start &&
                store.currentTime <= cues[cues.length - 1].end
              ) {
                triggerTranslation(store.currentTime)
              }
              lastCuesLength = cues.length
            }
            console.log('[BilingualTube] Auto-generated subtitles processed.')
          } catch (error) {
            console.error(
              '[BilingualTube] Punctuation restoration failed:',
              error,
            )
            // Use original data on failure
            data = sentencesInSubtitles(data, lang)
            store.setSubtitle({
              lang,
              text: resp,
              cues: data,
            })
          }
        } else {
          console.log(
            '[BilingualTube] Better auto-generated subtitles detected.',
          )
          data = sentencesInSubtitles(data, lang)
          store.setSubtitle({
            lang,
            text: resp,
            cues: data,
          })
        }
      } else {
        store.setSubtitle({
          lang,
          text: resp,
          cues: data,
        })
        // Try to load official translation subtitles
        await loadOfficialTranslationIfAvailable(c.req.url)
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
  if (!isLive()) {
    subtitleOverlay.update('BilingualTube Subtitle Loaded')
  }
  let currentCue: TranslationToken | null = null
  let currentTranslationCue: TranslationToken | null = null
  const clean = store.subscribe(async (currentTime) => {
    const cue = findMatchingSubtitle(store.subtitle?.cues || [], currentTime)

    // Find official translation subtitles (if available)
    let translationText: string | undefined
    if (store.subtitle?.officialTranslation) {
      const translationCue = findMatchingSubtitle(
        store.subtitle.officialTranslation.cues,
        currentTime,
      )
      translationText = translationCue?.text
      currentTranslationCue = translationCue
    } else {
      // Use API translation
      translationText = cue?.translated
      currentTranslationCue = null
    }

    // console.log('Current Time:', currentTime, 'Matched Cue:', cue, 'Translation:', translationText)

    // Check if there are changes
    if (
      cue?.text === currentCue?.text &&
      translationText ===
        (currentTranslationCue?.text || currentCue?.translated)
    ) {
      return
    }

    if (cue) {
      // Check if it's a simplified/traditional Chinese conversion
      const isChineseConversion = await isChineseVariantConversion()
      if (isChineseConversion && translationText) {
        // Simplified/Traditional Chinese conversion: only show translated text, not bilingual
        subtitleOverlay.update(translationText)
      } else {
        // Normal case: show original and translation (if available)
        subtitleOverlay.update(cue.text, translationText)
      }
    } else {
      subtitleOverlay.update('')
    }
    currentCue = JSON.parse(JSON.stringify(cue))
  })
  return () => {
    document.head.removeChild(style)
    subtitleOverlay.destroy()
    clean()
  }
}

function createSubtitleOverlay() {
  const moviePlayer = document.querySelector('#movie_player')
  if (!moviePlayer) {
    throw new Error('Movie player not found')
  }
  let container = document.querySelector('#bilingual-tube-subtitle-overlay')
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

// YouTube caption track related
interface CaptionTrack {
  baseUrl: string
  name: {
    simpleText: string
  }
  vssId: string
  languageCode: string
  kind?: string
  isTranslatable: boolean
  trackName: string
}

/**
 * Get all available caption tracks for a YouTube video
 */
function getAvailableCaptionTracks(): CaptionTrack[] {
  try {
    // Try to get from ytInitialPlayerResponse
    const ytInitialPlayerResponse = (globalThis as any).ytInitialPlayerResponse
    const captionTracks =
      ytInitialPlayerResponse?.captions?.playerCaptionsTracklistRenderer
        ?.captionTracks || []
    return captionTracks as CaptionTrack[]
  } catch (error) {
    console.error('[BilingualTube] Failed to get caption tracks:', error)
    return []
  }
}

function isLive() {
  return document.querySelector('#movie_player .ytp-live') !== null
}

/**
 * Find the official subtitle track for the target language
 * Prioritize non-auto-generated subtitles (kind !== 'asr')
 */
function findOfficialTranslationTrack(
  tracks: CaptionTrack[],
  targetLang: string,
  sourceLang: string,
): CaptionTrack | null {
  // Filter out source language subtitles
  const translationTracks = tracks.filter(
    (track) =>
      normalizeLanguageCode(track.languageCode) ===
        normalizeLanguageCode(targetLang) &&
      normalizeLanguageCode(track.languageCode) !==
        normalizeLanguageCode(sourceLang),
  )

  if (translationTracks.length === 0) {
    return null
  }

  // Prioritize non-auto-generated subtitles
  const manualTrack = translationTracks.find((track) => track.kind !== 'asr')
  return manualTrack || translationTracks[0]
}

/**
 * Request translated subtitles by modifying the lang parameter of the original request URL
 */
async function fetchSubtitleByReplay(
  targetLang: string,
  lastSubtitleRequestUrl: string,
): Promise<GetTimedtextResp | null> {
  if (!lastSubtitleRequestUrl) {
    console.error('[BilingualTube] No subtitle request URL saved')
    return null
  }

  try {
    // Modify the lang parameter of the URL
    const url = new URL(lastSubtitleRequestUrl)
    url.searchParams.set('lang', targetLang)

    const response = await fetch(url.toString(), {
      headers: {
        [INTERNAL_REQUEST_HEADER]: 'true',
      },
    })
    if (!response.ok) {
      console.error(
        '[BilingualTube] Failed to fetch subtitle:',
        response.status,
      )
      return null
    }
    const data = (await response.json()) as GetTimedtextResp
    return data
  } catch (error) {
    console.error('[BilingualTube] Error fetching subtitle:', error)
    return null
  }
}

/**
 * Try to load official translation subtitles (if available)
 */
async function loadOfficialTranslationIfAvailable(
  lastSubtitleRequestUrl: string,
) {
  if (!store.subtitle) {
    return
  }

  const settings = await eventMessager.sendMessage('getSettings')
  const targetLang = settings.to ?? 'en'
  const sourceLang = store.subtitle.lang

  // If source and target languages are the same, no need to load translation
  if (normalizeLanguageCode(sourceLang) === normalizeLanguageCode(targetLang)) {
    console.log('[BilingualTube] Source and target languages are the same')
    return
  }

  // Get all available caption tracks
  const captionTracks = getAvailableCaptionTracks()
  if (captionTracks.length === 0) {
    console.log('[BilingualTube] No caption tracks found')
    return
  }

  console.log(
    `[BilingualTube] Available caption tracks:`,
    captionTracks.map((t) => `${t.languageCode} (${t.name.simpleText})`),
  )

  // Find official subtitles for the target language
  const translationTrack = findOfficialTranslationTrack(
    captionTracks,
    targetLang,
    sourceLang,
  )

  if (!translationTrack) {
    console.log(
      `[BilingualTube] No official translation track found for ${targetLang}`,
    )
    return
  }

  console.log(
    `[BilingualTube] Found official translation track: ${translationTrack.name.simpleText} (${translationTrack.languageCode})`,
  )

  // Load translation subtitle data by replaying the request
  const translationData = await fetchSubtitleByReplay(
    translationTrack.languageCode,
    lastSubtitleRequestUrl,
  )
  if (!translationData || !translationData.events) {
    console.error('[BilingualTube] Failed to load translation subtitle data')
    return
  }

  // Official multilingual subtitles don't need sentence splitting, only standard preprocessing
  const translationCues = convertYoutubeToStandardFormat(translationData)
  store.setOfficialTranslation(
    translationTrack.languageCode,
    translationData,
    translationCues,
  )

  console.log(
    `[BilingualTube] Loaded official translation: ${translationCues.length} cues`,
  )
}

// Translation related
let isTranslating = false

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

async function triggerTranslation(currentTime: number) {
  if (isTranslating) return

  // If official translation subtitles are available, skip API translation
  if (store.subtitle?.officialTranslation) {
    // console.log(
    //   '[BilingualTube] Official translation available, skipping API translation',
    // )
    return
  }

  const cues = store.subtitle?.cues ?? []
  if (!shouldTriggerTranslation(cues, currentTime)) {
    return
  }

  // Check if source and target languages are the same
  if (await isSameLanguage()) {
    console.log(
      '[BilingualTube] Source and target languages are the same, skipping translation',
    )
    return
  }

  const cuesToTranslate = getCuesToTranslate(cues, currentTime)
  if (cuesToTranslate.length === 0) return

  isTranslating = true
  try {
    console.log(`[BilingualTube] Translating ${cuesToTranslate.length} cues`)
    const texts = cuesToTranslate.map((cue) => cue.text)
    const signal = store.getSignal()
    const translations = await eventMessager.sendMessage('translate', texts)
    if (signal.aborted) {
      console.log('[BilingualTube] Translation aborted.')
      throw new Error('Translation aborted.')
    }

    // Update translations of cues
    cuesToTranslate.forEach((cue, index) => {
      cue.translated = translations[index]
    })
    // Trigger subtitle display update
    store.setCurrentTime(store.currentTime)

    console.log(`[BilingualTube] Translated ${cuesToTranslate.length} cues`)
  } catch (error) {
    console.error('[BilingualTube] Translation failed:', error)
    throw new Error(
      `Translation failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    )
  } finally {
    isTranslating = false
  }
}

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
    store.reset()
    console.log('[BilingualTube] Page data updated, subtitle store reset.')
  }
  document.addEventListener('yt-page-data-updated', onPageDataUpdated)
  return () => {
    document.removeEventListener('yt-page-data-updated', onPageDataUpdated)
  }
}
