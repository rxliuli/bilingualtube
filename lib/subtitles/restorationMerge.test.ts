import { describe, expect, it } from 'vitest'
import { TranslationToken } from '../store'
import { TimedToken } from './PunctuationRestorationModel'
import { mergeRestorationUpdate } from './restorationMerge'
import { convertYoutubeToStandardFormat } from './subtitle-utils'
import type { GetTimedtextResp } from './youtube-types'

// Real partially punctuated en ASR track (interview-style): 7,884 tokens,
// 12% punctuated with 8 runs of 50+ unpunctuated words. This is the track
// class that routes through sherpa-en and gets streamed window by window.
async function loadTrack(): Promise<TimedToken[]> {
  return convertYoutubeToStandardFormat(
    (await import('./assets/timedtext-JMNIQDLrVp0.json'))
      .default as GetTimedtextResp,
  )
}

/**
 * Simulate the model's restored output for a prefix of the track: terminal
 * punctuation appended every ~12 tokens. Exact punctuation placement doesn't
 * matter for these tests — only that the prefix text differs from the raw
 * text the way real restoration output does.
 */
function fakeRestoredPrefix(data: TimedToken[], length: number): TimedToken[] {
  return data.slice(0, length).map((t, i) => {
    if (/[.,!?]$/.test(t.text)) return t
    return (i + 1) % 12 === 0 ? { ...t, text: t.text + '.' } : t
  })
}

describe('mergeRestorationUpdate', () => {
  // Regression: stream updates yield only a prefix of the track. Grouping
  // just the prefix blanked every cue past the restoration frontier — the
  // subtitle at the playhead disappeared when starting playback mid-video
  // (e.g. at 875s) until restoration caught up.
  it('covers the full timeline when only a prefix is restored', async () => {
    const data = await loadTrack()
    const trackEnd = data[data.length - 1].end

    const prefix = fakeRestoredPrefix(data, 500)
    const cues = mergeRestorationUpdate(prefix, data, [], 'en')

    const lastCueEnd = cues[cues.length - 1].end
    expect(lastCueEnd).toBe(trackEnd)

    // A cue must exist at 875s (the mid-video playhead from the bug report),
    // far beyond the 500-token restoration frontier.
    const playheadCue = cues.find((c) => c.start <= 875 && c.end >= 875)
    expect(playheadCue).toBeDefined()
  })

  // Regression: translations were preserved by array index. Restoration
  // changes the number of cues the prefix groups into, shifting every tail
  // cue's index — all their translations were dropped and re-fetched on
  // every stream update.
  it('preserves tail translations across a prefix update', async () => {
    const data = await loadTrack()

    // Initial display: raw track, no restoration yet.
    const initial = mergeRestorationUpdate([], data, [], 'en')
    // Simulate the whole visible region having been translated.
    const translated: TranslationToken[] = initial.map((c) => ({
      ...c,
      translated: `translated:${c.start}`,
    }))

    // First stream update arrives: 500 tokens restored.
    const prefix = fakeRestoredPrefix(data, 500)
    const updated = mergeRestorationUpdate(prefix, data, translated, 'en')

    const frontierTime = data[500].start
    // Tail cues far behind the frontier come from the same raw tokens, so
    // text and start are unchanged — their translations must survive. (The
    // few cues at the frontier seam legitimately regroup and re-translate.)
    const farTail = updated.filter((c) => c.start > frontierTime + 60)
    expect(farTail.length).toBeGreaterThan(50)
    const preserved = farTail.filter((c) => c.translated)
    expect(preserved.length / farTail.length).toBeGreaterThan(0.95)
  })

  // The final stream update covers the whole track; no raw tail remains.
  it('uses the restored text once the whole track is processed', async () => {
    const data = await loadTrack()
    const full = fakeRestoredPrefix(data, data.length)
    const cues = mergeRestorationUpdate(full, data, [], 'en')
    expect(cues[cues.length - 1].end).toBe(data[data.length - 1].end)
    // Restored punctuation must actually show up in the output.
    expect(cues.some((c) => c.text.includes('.'))).toBe(true)
  })
})
