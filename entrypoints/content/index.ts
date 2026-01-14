import { interceptFetch, interceptXHR, Vista } from '@rxliuli/vista'
import globalStyle from './global.css?inline'
import { subtitleStore, TranslationToken } from '../../lib/store'
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
} from '@/lib/subtitles/cues-utils'
import { restorePunctuationInSubtitles } from '@/lib/subtitles/restorePunctuationInSubtitles'

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
      if (subtitleStore.subtitle) {
        subtitleStore.clearSubtitle()
        subtitleStore.setCurrentTime(subtitleStore.currentTime) // Trigger UI clearing
        console.log('[BilingualTube] Subtitle request intercepted: ', c.req.url)
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
      if (kind === 'asr') {
        if (lang === 'en' && hasMissingPunctuation(data)) {
          try {
            console.log('[BilingualTube] Auto-generated subtitles detected.')
            const options = await eventMessager.sendMessage(
              'getPunctuationOptions',
            )
            data = await restorePunctuationInSubtitles(data, options)
            console.log('[BilingualTube] Punctuation restoration completed.')
          } catch (error) {
            console.error(
              '[BilingualTube] Punctuation restoration failed:',
              error,
            )
          }
        }
        data = sentencesInSubtitles(data, lang)
      }
      subtitleStore.setSubtitle({
        lang,
        text: resp,
        cues: data,
      })
      const t = new URL(location.href).searchParams.get('t')
      let seconds = 0
      if (t && t.match(/^\d+s$/)) {
        seconds = Number.parseInt(t.slice(0, -1), 10)
      }
      // Try to load official translation subtitles
      await loadOfficialTranslationIfAvailable(c.req.url)
      await triggerTranslation(seconds)
      console.log('[BilingualTube] response: ', subtitleStore.subtitle)
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
  subtitleOverlay.update('BilingualTube Subtitle Loaded')
  let currentCue: TranslationToken | null = null
  let currentTranslationCue: TranslationToken | null = null
  const clean = subtitleStore.subscribe(async (currentTime) => {
    const cue = findMatchingSubtitle(
      subtitleStore.subtitle?.cues || [],
      currentTime,
    )

    // Find official translation subtitles (if available)
    let translationText: string | undefined
    if (subtitleStore.subtitle?.officialTranslation) {
      const translationCue = findMatchingSubtitle(
        subtitleStore.subtitle.officialTranslation.cues,
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
  return (
    (
      (globalThis as any).ytInitialPlayerResponse.responseContext
        .serviceTrackingParams as {
        service: string
        params: { key: string; value: string }[]
      }[]
    )
      .find((it) => it.service === 'GFEEDBACK')
      ?.params.find((it) => it.key === 'is_viewed_live')?.value === 'True'
  )
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
  if (!subtitleStore.subtitle) {
    return
  }

  const settings = await eventMessager.sendMessage('getSettings')
  const targetLang = settings.to ?? 'en'
  const sourceLang = subtitleStore.subtitle.lang

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

  // Merge translation subtitles and store them in the store
  const translationCues = sentencesInSubtitles(
    convertYoutubeToStandardFormat(translationData),
    translationTrack.languageCode,
  )
  subtitleStore.setOfficialTranslation(
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
  const sourceLang = subtitleStore.subtitle?.lang
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
  const sourceLang = subtitleStore.subtitle?.lang
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

function shouldTriggerTranslation(currentTime: number): boolean {
  const cues = subtitleStore.subtitle?.cues || []

  // Check if there are any untranslated cues in [currentTime, currentTime + 30s]
  return cues.some(
    (cue) =>
      cue.start >= currentTime &&
      cue.start <= currentTime + 30 &&
      !cue.translated,
  )
}

async function triggerTranslation(currentTime: number) {
  if (isTranslating) return

  // If official translation subtitles are available, skip API translation
  if (subtitleStore.subtitle?.officialTranslation) {
    console.log(
      '[BilingualTube] Official translation available, skipping API translation',
    )
    return
  }

  if (!shouldTriggerTranslation(currentTime)) {
    return
  }

  // Check if source and target languages are the same
  if (await isSameLanguage()) {
    console.log(
      '[BilingualTube] Source and target languages are the same, skipping translation',
    )
    return
  }

  const cues = subtitleStore.subtitle?.cues || []
  const cuesToTranslate = getCuesToTranslate(cues, currentTime)
  if (cuesToTranslate.length === 0) return

  isTranslating = true
  try {
    console.log(`[BilingualTube] Translating ${cuesToTranslate.length} cues`)
    const texts = cuesToTranslate.map((cue) => cue.text)
    const translations = await eventMessager.sendMessage('translate', texts)

    // Update translations of cues
    cuesToTranslate.forEach((cue, index) => {
      cue.translated = translations[index]
    })
    // Trigger subtitle display update
    subtitleStore.setCurrentTime(subtitleStore.currentTime)

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
    subtitleStore.setCurrentTime(currentTime)
    // Trigger translation
    triggerTranslation(currentTime)
  })
}
