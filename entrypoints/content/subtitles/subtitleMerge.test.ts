import { assert, describe, expect, it } from 'vitest'
import { mergeTimedtextEvents, SubtitleCue } from './subtitleMerge'
import { TimedtextEvent } from './types'

describe('subtitle merge', () => {
  it('Should compile subtitle merge correctly', async () => {
    const data = (await import('./assets/timedtext.json')).default
    const r = mergeTimedtextEvents(data.events as TimedtextEvent[], 'en')
    expect(r.length).toBeGreaterThan(0)
  })
  // Correctly handle merging without breaking sentences in the middle
  it('Should merge subtitle without breaking sentences', () => {
    const events: TimedtextEvent[] = [
      {
        tStartMs: 37120,
        dDurationMs: 4560,
        wWinId: 1,
        segs: [
          {
            utf8: 'So,',
            acAsrConf: 0,
          },
          {
            utf8: ' you',
            tOffsetMs: 320,
            acAsrConf: 0,
          },
          {
            utf8: ' see,',
            tOffsetMs: 560,
            acAsrConf: 0,
          },
          {
            utf8: ' friendship',
            tOffsetMs: 1040,
            acAsrConf: 0,
          },
          {
            utf8: " isn't",
            tOffsetMs: 1520,
            acAsrConf: 0,
          },
          {
            utf8: ' always',
            tOffsetMs: 1920,
            acAsrConf: 0,
          },
        ],
      },
      {
        tStartMs: 39430,
        dDurationMs: 2250,
        wWinId: 1,
        aAppend: 1,
        segs: [
          {
            utf8: '\n',
          },
        ],
      },
      {
        tStartMs: 39440,
        dDurationMs: 4240,
        wWinId: 1,
        segs: [
          {
            utf8: 'easy,',
            acAsrConf: 0,
          },
          {
            utf8: ' but',
            tOffsetMs: 400,
            acAsrConf: 0,
          },
          {
            utf8: " there's",
            tOffsetMs: 720,
            acAsrConf: 0,
          },
          {
            utf8: ' no',
            tOffsetMs: 1040,
            acAsrConf: 0,
          },
          {
            utf8: ' doubt',
            tOffsetMs: 1279,
            acAsrConf: 0,
          },
          {
            utf8: " it's",
            tOffsetMs: 1600,
            acAsrConf: 0,
          },
          {
            utf8: ' worth',
            tOffsetMs: 1920,
            acAsrConf: 0,
          },
        ],
      },
      {
        tStartMs: 41670,
        dDurationMs: 2010,
        wWinId: 1,
        aAppend: 1,
        segs: [
          {
            utf8: '\n',
          },
        ],
      },
      {
        tStartMs: 41680,
        dDurationMs: 3515,
        wWinId: 1,
        segs: [
          {
            utf8: 'fighting',
            acAsrConf: 0,
          },
          {
            utf8: ' [music]',
            tOffsetMs: 240,
          },
          {
            utf8: ' for.',
            tOffsetMs: 399,
            acAsrConf: 0,
          },
        ],
      },
      {
        tStartMs: 43670,
        dDurationMs: 1525,
        wWinId: 1,
        aAppend: 1,
        segs: [
          {
            utf8: '\n',
          },
        ],
      },
      {
        tStartMs: 43680,
        dDurationMs: 2800,
        wWinId: 1,
        segs: [
          {
            utf8: '>> A',
            acAsrConf: 0,
          },
        ],
      },
      {
        tStartMs: 45185,
        dDurationMs: 1295,
        wWinId: 1,
        aAppend: 1,
        segs: [
          {
            utf8: '\n',
          },
        ],
      },
      {
        tStartMs: 45195,
        dDurationMs: 5565,
        wWinId: 1,
        segs: [
          {
            utf8: '[laughter]',
          },
        ],
      },
      {
        tStartMs: 46470,
        dDurationMs: 4290,
        wWinId: 1,
        aAppend: 1,
        segs: [
          {
            utf8: '\n',
          },
        ],
      },
      {
        tStartMs: 46480,
        dDurationMs: 4280,
        wWinId: 1,
        segs: [
          {
            utf8: 'h',
            acAsrConf: 0,
          },
          {
            utf8: ' that',
            tOffsetMs: 720,
            acAsrConf: 0,
          },
          {
            utf8: ' sounds',
            tOffsetMs: 960,
            acAsrConf: 0,
          },
          {
            utf8: ' familiar.',
            tOffsetMs: 1280,
            acAsrConf: 0,
          },
        ],
      },
    ]
    const merged = mergeTimedtextEvents(events, 'en')
    expect(merged.length).toBe(2)
    expect(merged[0].content).toBe(
      "So, you see, friendship isn't always easy, but there's no doubt it's worth fighting [music] for.",
    )
    expect(merged[1].content).toBe('>> A [laughter] h that sounds familiar.')
  })
})

describe('real world subtitle merge', () => {
  // Correctly handle Discover the Apple Design Resources subtitle merge
  // https://www.youtube.com/watch?v=CVMO61kLAM8
  it('Discover the Apple Design Resources', async () => {
    const data = (
      await import(
        './assets/timedtext-discover-the-apple-design-resources.json'
      )
    ).default
    const r = mergeTimedtextEvents(data.events as TimedtextEvent[], 'en')
    expect(r[0]).toEqual({
      content:
        'The Apple Design Resources are really a collection of different materials',
      end: 8.238,
      start: 4.234,
    })
  })
  // Correctly handle sentence splitting, should break on commas or periods (and if too long?)
  it('Should split sentences on punctuation', async () => {
    const data = (
      await import(
        './assets/timedtext-discover-the-apple-design-resources.json'
      )
    ).default
    const r = mergeTimedtextEvents(data.events as TimedtextEvent[], 'en')
    const cue = r.find((it) =>
      it.content.includes(
        'So as designers who are making design tools for other designers,',
      ),
    )
    assert(cue)
    expect(cue.content).toEqual(
      'So as designers who are making design tools for other designers,',
    )
  })
  // Should break sentences when encountering overly long subtitle segments
  it('Should split long subtitle segments', async () => {
    const data = (
      await import(
        './assets/timedtext-discover-the-apple-design-resources.json'
      )
    ).default
    const r = mergeTimedtextEvents(data.events as TimedtextEvent[], 'en')
    const contents = r.map((it) => it.content)
    expect(contents)
      .contains(
        'We created the Apple Design Resources in the hopes that someone',
      )
      .contain(
        'who has an idea about how their app is supposed to work is able',
      )
      .contain(
        'to quickly express that idea in a way that has a high degree of accuracy',
      )
  })
  // When encountering terminal punctuation like . ! ?, should force sentence break, unlike commas which continue merging
  it('Should split on terminal punctuation', async () => {
    const data = (await import('./assets/timedtext-mlp-s4-e26.json')).default
    const r = mergeTimedtextEvents(data.events as TimedtextEvent[], 'en')
    const contents = r.map((it) => it.content)
    // [Music] is now split into its own subtitle
    expect(contents[0]).eq('[Music]')
    expect(contents[1]).eq("What's wrong, Twilight?")
    expect(contents[2]).eq(
      "It doesn't seem that my new role as a princess equates to all that much.",
    )
    expect(contents[3]).eq(
      'I am Lord Derek, and I will take what should have been mine long ago.',
    )
  })
  // Correctly calculate timing
  it('Should calculate start and end time correctly', async () => {
    const data = (await import('./assets/timedtext-mlp-s4-e26.json')).default
    const r = mergeTimedtextEvents(data.events as TimedtextEvent[], 'en')
    // [Music] is now its own subtitle
    expect(r[0]).toEqual({
      start: 2.11, // From "[Music]" tStartMs: 2110
      end: 4.319, // Trimmed to avoid overlap with next subtitle
      content: '[Music]',
    } satisfies SubtitleCue)
    expect(r[1]).toEqual({
      start: 4.319,
      end: (4319 + 1601) / 1000,
      content: "What's wrong, Twilight?",
    })
    expect(r[2]).toEqual({
      start: (4319 + 1601) / 1000,
      end: (8160 + 1280) / 1000,
      content:
        "It doesn't seem that my new role as a princess equates to all that much.",
    })
    expect(r[3]).toEqual({
      start: (8160 + 1280) / 1000,
      end: (15679 + 1600) / 1000,
      content:
        'I am Lord Derek, and I will take what should have been mine long ago.',
    })
  })
  // Correctly handle real world subtitle merge
  it('Should handle real world subtitle merge correctly', async () => {
    const data = (await import('./assets/timedtext-mlp-s8-e8.json')).default
    const r = mergeTimedtextEvents(data.events as TimedtextEvent[], 'en')

    const targetIndex = r.findIndex((sub) =>
      sub.content.includes('share Starlight'),
    )

    expect(r[targetIndex]).toEqual({
      start: 157.239, // Start time of "share Starlight" segment
      end: 164.72, // End time trimmed to avoid overlap with next subtitle
      content:
        "share Starlight you mean we've both been called this is great yeah",
    } satisfies SubtitleCue)
    const cue2Index = r.findIndex((cue) =>
      cue.content.includes(
        'nope the great thing about home is it always stays just how you let oh',
      ),
    )
    expect(r[cue2Index]?.content).eq(
      'nope the great thing about home is it always stays just how you let oh',
    )
    expect(r[cue2Index + 1]?.content).eq('[Music]')
  })
})
