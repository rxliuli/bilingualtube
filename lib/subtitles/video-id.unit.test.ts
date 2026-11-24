import { describe, expect, it, vi } from 'vitest'
import {
  getActiveVideoId,
  getVideoIdFromUrl,
  isTimedtextForActiveVideo,
  shouldResetSubtitleForVideo,
} from './video-id'
import { store } from '../store'

describe('getVideoIdFromUrl', () => {
  it('extracts video id from standard watch URLs', () => {
    expect(
      getVideoIdFromUrl('https://www.youtube.com/watch?v=vZQ37A6Mc6o&t=15s'),
    ).toBe('vZQ37A6Mc6o')
  })

  it('extracts video id from live, embed, and shorts URLs', () => {
    expect(getVideoIdFromUrl('https://www.youtube.com/live/abc123XYZ')).toBe(
      'abc123XYZ',
    )
    expect(
      getVideoIdFromUrl('https://www.youtube.com/embed/abc123XYZ?autoplay=1'),
    ).toBe('abc123XYZ')
    expect(getVideoIdFromUrl('https://www.youtube.com/shorts/abc123XYZ')).toBe(
      'abc123XYZ',
    )
  })

  it('returns null for non-video YouTube pages', () => {
    expect(getVideoIdFromUrl('https://www.youtube.com/')).toBeNull()
    expect(
      getVideoIdFromUrl('https://www.youtube.com/results?search_query=gta'),
    ).toBeNull()
    expect(getVideoIdFromUrl('https://www.youtube.com/@Fear')).toBeNull()
  })
})

describe('isTimedtextForActiveVideo', () => {
  it('accepts timedtext matching the active watch page video', () => {
    expect(
      isTimedtextForActiveVideo('vZQ37A6Mc6o', {
        urlVideoId: 'vZQ37A6Mc6o',
        playerVideoId: 'vZQ37A6Mc6o',
      }),
    ).toBe(true)
  })

  it('ignores sidebar inline-preview-player timedtext for another video', () => {
    expect(
      isTimedtextForActiveVideo('8fiykrIqkVc', {
        urlVideoId: 'vZQ37A6Mc6o',
        playerVideoId: 'vZQ37A6Mc6o',
      }),
    ).toBe(false)
  })

  it('ignores home feed hover-preview timedtext when no main video is active', () => {
    expect(
      isTimedtextForActiveVideo('8fiykrIqkVc', {
        urlVideoId: null,
        playerVideoId: null,
      }),
    ).toBe(false)
  })

  it('prefers URL video id over stale player video id during SPA navigation', () => {
    expect(
      isTimedtextForActiveVideo('newVideoId', {
        urlVideoId: 'newVideoId',
        playerVideoId: 'oldVideoId',
      }),
    ).toBe(true)
    expect(
      isTimedtextForActiveVideo('oldVideoId', {
        urlVideoId: 'newVideoId',
        playerVideoId: 'oldVideoId',
      }),
    ).toBe(false)
  })

  it('allows Miniplayer timedtext on non-watch pages while filtering hover previews', () => {
    expect(
      isTimedtextForActiveVideo('miniVideoId', {
        urlVideoId: null,
        playerVideoId: 'miniVideoId',
      }),
    ).toBe(true)
    expect(
      isTimedtextForActiveVideo('hoveredPreviewId', {
        urlVideoId: null,
        playerVideoId: 'miniVideoId',
      }),
    ).toBe(false)
  })

  it('returns false when request video id is missing', () => {
    expect(
      isTimedtextForActiveVideo(null, {
        urlVideoId: 'vZQ37A6Mc6o',
        playerVideoId: 'vZQ37A6Mc6o',
      }),
    ).toBe(false)
  })
})

describe('shouldResetSubtitleForVideo', () => {
  it('does not reset when subtitle already matches the active video', () => {
    expect(
      shouldResetSubtitleForVideo(
        'vZQ37A6Mc6o',
        getActiveVideoId({
          urlVideoId: 'vZQ37A6Mc6o',
          playerVideoId: 'vZQ37A6Mc6o',
        }),
      ),
    ).toBe(false)
  })

  it('resets when SPA navigated to a different video without new subtitles', () => {
    expect(shouldResetSubtitleForVideo('oldVideoId', 'newVideoId')).toBe(true)
  })

  it('resets when navigated away to home page without Miniplayer', () => {
    expect(shouldResetSubtitleForVideo('oldVideoId', null)).toBe(true)
  })

  it('does nothing when no subtitle is loaded', () => {
    expect(shouldResetSubtitleForVideo(undefined, 'newVideoId')).toBe(false)
  })
})

describe('SubtitleStore.reset', () => {
  it('aborts the current signal, clears subtitle, and notifies listeners', () => {
    store.reset()
    const listener = vi.fn()
    const unsubscribe = store.subscribe(listener)
    const signal = store.getSignal()

    store.setSubtitle({
      videoId: 'vZQ37A6Mc6o',
      lang: 'en',
      text: { events: [] },
      cues: [{ start: 0, end: 5, text: 'Hello' }],
    })
    store.setCurrentTime(2)
    listener.mockClear()

    store.reset()

    expect(signal.aborted).toBe(true)
    expect(store.getSignal().aborted).toBe(false)
    expect(store.subtitle).toBeNull()
    expect(store.currentTime).toBe(0)
    expect(listener).toHaveBeenCalledTimes(1)
    expect(listener).toHaveBeenCalledWith(0)

    unsubscribe()
  })
})
