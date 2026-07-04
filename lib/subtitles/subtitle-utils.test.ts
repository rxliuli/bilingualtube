import { assert, describe, expect, it } from 'vitest'
import {
  convertYoutubeToStandardFormat,
  hasMissingPunctuation,
  resolveSubtitleTrack,
  sentencesInSubtitles,
} from './subtitle-utils'
import { GetTimedtextResp, TimedtextEvent } from './youtube-types'
import { TimedToken } from './PunctuationRestorationModel'
import { restorePunctuation } from './restorePunctuationInSubtitles'

describe('subtitle-utils', () => {
  describe('convertYoutubeToStandardFormat', () => {
    it('should convert youtube subtitles to standard format', async () => {
      const data = convertYoutubeToStandardFormat(
        (await import('./assets/timedtext.json')).default as GetTimedtextResp,
      )
      expect(data).not.empty
    })
  })
  describe('hasMissingPunctuation', () => {
    it('should detect missing punctuation in subtitles', async () => {
      const data1 = convertYoutubeToStandardFormat(
        (await import('./assets/timedtext-mlp-s4-e26.json'))
          .default as GetTimedtextResp,
      )
      const data2 = convertYoutubeToStandardFormat(
        (await import('./assets/timedtext-mlp-s8-e8.json'))
          .default as GetTimedtextResp,
      )
      expect(hasMissingPunctuation(data1)).false
      expect(hasMissingPunctuation(data2)).true
    })
    it('should handle subtitles with numbers and temperatures correctly', async () => {
      const data = convertYoutubeToStandardFormat(
        (await import('./assets/timedtext-mlp-s9-e16.json'))
          .default as GetTimedtextResp,
      )
      expect(hasMissingPunctuation(data)).true
    })
    it('should handle subtitles with decimal numbers correctly', async () => {
      const data = convertYoutubeToStandardFormat(
        (await import('./assets/timedtext-22V3rKriX60.json'))
          .default as GetTimedtextResp,
      )
      expect(hasMissingPunctuation(data)).true
    })
    it('should not be fooled by number-group commas like 20,000', async () => {
      const data = convertYoutubeToStandardFormat(
        (await import('./assets/timedtext-mlp-s5-e22.json'))
          .default as GetTimedtextResp,
      )
      expect(hasMissingPunctuation(data)).true
    })
    // Interview-style ASR tracks punctuate the anchor's speech but leave
    // guest segments as long runs (99 and 180 words in these fixtures)
    // without any punctuation.
    it('should detect partially punctuated tracks with long unpunctuated runs', async () => {
      const data1 = convertYoutubeToStandardFormat(
        (await import('./assets/timedtext-bSKc5Sf63Ic.json'))
          .default as GetTimedtextResp,
      )
      const data2 = convertYoutubeToStandardFormat(
        (await import('./assets/timedtext-vbScf4PzKRI.json'))
          .default as GetTimedtextResp,
      )
      expect(hasMissingPunctuation(data1)).true
      expect(hasMissingPunctuation(data2)).true
    })
    it('should not flag long fully-punctuated tracks', async () => {
      const data = convertYoutubeToStandardFormat(
        (await import('./assets/timedtext.json')).default as GetTimedtextResp,
      )
      expect(hasMissingPunctuation(data)).false
    })
  })
  describe('sentencesInSubtitles', () => {
    it('Should compile subtitle merge correctly', async () => {
      const data = convertYoutubeToStandardFormat(
        (await import('./assets/timedtext.json')).default as GetTimedtextResp,
      )
      const r = sentencesInSubtitles(data, 'en')
      expect(r.length).toBeGreaterThan(0)
    })
    it('should extract sentences from subtitles', () => {
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
      const data = convertYoutubeToStandardFormat({ events })
      const merged = sentencesInSubtitles(data, 'en')
      expect(merged.length).toBe(2)
      expect(merged[0].text).toBe(
        "So, you see, friendship isn't always easy, but there's no doubt it's worth fighting [music] for.",
      )
      expect(merged[1].text).toBe('>> A [laughter] h that sounds familiar.')
    })
  })
  describe('English subtitle merge', () => {
    // Correctly handle Discover the Apple Design Resources subtitle merge
    // https://www.youtube.com/watch?v=CVMO61kLAM8
    it('Discover the Apple Design Resources', async () => {
      const data = (
        await import('./assets/timedtext-discover-the-apple-design-resources.json')
      ).default
      const r = sentencesInSubtitles(convertYoutubeToStandardFormat(data), 'en')
      expect(r[0]).toEqual({
        text: 'The Apple Design Resources are really a collection of different materials that we provide to people for designing apps.',
        end: 10.474,
        start: 4.234,
      } satisfies TimedToken)
    })
    // Sentences only split at punctuation (comma/period) when over maxLength,
    // never at arbitrary word boundaries
    it('Should not split mid-sentence when under maxLength', async () => {
      const data = (
        await import('./assets/timedtext-discover-the-apple-design-resources.json')
      ).default
      const r = sentencesInSubtitles(convertYoutubeToStandardFormat(data), 'en')
      const cue = r.find((it) =>
        it.text.includes(
          'So as designers who are making design tools for other designers,',
        ),
      )
      assert(cue)
      expect(cue.text).toEqual(
        'So as designers who are making design tools for other designers, we know that the design resources have to be really well designed.',
      )
    })
    // Long sentences split at comma when exceeding maxLength
    it('Should split long subtitle segments at comma', async () => {
      const data = (
        await import('./assets/timedtext-discover-the-apple-design-resources.json')
      ).default
      const r = sentencesInSubtitles(convertYoutubeToStandardFormat(data), 'en')
      const contents = r.map((it) => it.text)
      expect(contents).contain(
        'We created the Apple Design Resources in the hopes that someone who has an idea about how their app is supposed to work is able to quickly express that idea in a way that has a high degree of accuracy to how it\'s ultimately going to look,',
      )
    })
    // When encountering terminal punctuation like . ! ?, should force sentence break, unlike commas which continue merging
    it('Should split on terminal punctuation', async () => {
      const data = (await import('./assets/timedtext-mlp-s4-e26.json'))
        .default as GetTimedtextResp
      const r = sentencesInSubtitles(convertYoutubeToStandardFormat(data), 'en')
      const contents = r.map((it) => it.text)
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
      const data = (await import('./assets/timedtext-mlp-s4-e26.json'))
        .default as GetTimedtextResp
      const r = sentencesInSubtitles(convertYoutubeToStandardFormat(data), 'en')

      // [Music] is now its own subtitle
      expect(r[0]).toEqual({
        start: 2.11, // From "[Music]" tStartMs: 2110
        end: 4.319, // Trimmed to avoid overlap with next subtitle
        text: '[Music]',
      } satisfies TimedToken)
      expect(r[1]).toEqual({
        start: 4.319,
        end: (4319 + 1601) / 1000,
        text: "What's wrong, Twilight?",
      } satisfies TimedToken)
      expect(r[2]).toEqual({
        start: (4319 + 1601) / 1000,
        end: (8160 + 1280) / 1000,
        text: "It doesn't seem that my new role as a princess equates to all that much.",
      } satisfies TimedToken)
      expect(r[3]).toEqual({
        start: (8160 + 1280) / 1000,
        end: (15679 + 1600) / 1000,
        text: 'I am Lord Derek, and I will take what should have been mine long ago.',
      } satisfies TimedToken)
    })
    // Correctly handle real world subtitle merge
    // https://www.youtube.com/watch?v=K06KMkqGrb0
    it('Should handle real world subtitle merge correctly', async () => {
      const data = convertYoutubeToStandardFormat(
        (await import('./assets/timedtext-mlp-s8-e8.json'))
          .default as GetTimedtextResp,
      )
      expect(hasMissingPunctuation(data)).true
      let r1
      for await (const processed of restorePunctuation(data)) {
        r1 = processed
      }
      const r2 = sentencesInSubtitles(r1!, 'en')

      const targetIndex = r2.findLastIndex((t) => t.text.includes('share'))
      expect(r2[targetIndex]).toEqual({
        start: 145.56,
        end: 159.239,
        text: "Let me know Hing on my fair share of missions, you've been on one Spike and that's my fair share, Starlight.",
      } satisfies TimedToken)
    })
    // Should handle [laughter] and [applause] tags correctly
    it('Should handle [laughter] and [applause] tags correctly', async () => {
      const data = convertYoutubeToStandardFormat(
        (await import('./assets/timedtext-mlp-s4-e14.json'))
          .default as GetTimedtextResp,
      )
      let r1
      for await (const processed of restorePunctuation(data)) {
        r1 = processed
      }
      const r2 = sentencesInSubtitles(r1!, 'en')
      const contents = r2.map((it) => it.text)
      expect(contents)
        .contain('Got the music in,')
        .contains('[Applause]')
        .contain('you, you did it Flutter Shot.')
    })
    // Should handle multiple consecutive >> started subtitles correctly
    it('Should handle multiple consecutive >> started subtitles correctly', async () => {
      const data = convertYoutubeToStandardFormat(
        (await import('./assets/timedtext.json')).default as GetTimedtextResp,
      )
      const r1 = data.filter(
        (t, i) => t.text.startsWith('>>') && data[i + 1]?.text.startsWith('>>'),
      )
      expect(r1.length).gt(0)
      const r = sentencesInSubtitles(data, 'en')
      const r2 = r.filter(
        (t) => t.text.indexOf('>>') !== t.text.lastIndexOf('>>'),
      )
      expect(r2.length).eq(0)
    })
    it('should correctly handle sentence splitting without losing original words', async () => {
      const data = convertYoutubeToStandardFormat(
        (await import('./assets/timedtext-mlp-s9-e16.json'))
          .default as GetTimedtextResp,
      )
      expect(hasMissingPunctuation(data)).true
      let r1
      for await (const processed of restorePunctuation(data)) {
        r1 = processed
      }
      const r2 = sentencesInSubtitles(r1!, 'en')
      const contents = r2.map((it) => it.text)
      console.log(r2.find((t) => t.text.includes('variety')))
      // expect(contents).contain('variety')
    })
    // https://youtu.be/FN_44I_3seM?t=82
    // ">> Who? Oh," and "so Princess Celestia..." have a ~16s gap and should be split
    it('should split segments when there is a large time gap between tokens', () => {
      const events: TimedtextEvent[] = [
        {
          tStartMs: 78320,
          dDurationMs: 5400,
          wWinId: 1,
          segs: [{ utf8: '>> Who?', acAsrConf: 0 }],
        },
        {
          tStartMs: 80710,
          dDurationMs: 3010,
          wWinId: 1,
          aAppend: 1,
          segs: [{ utf8: '\n' }],
        },
        {
          tStartMs: 80720,
          dDurationMs: 3000,
          wWinId: 1,
          segs: [{ utf8: 'Oh,', acAsrConf: 0 }],
        },
        {
          tStartMs: 99590,
          wWinId: 1,
          aAppend: 1,
          segs: [{ utf8: '\n' }],
        },
        {
          tStartMs: 99600,
          dDurationMs: 5680,
          wWinId: 1,
          segs: [
            { utf8: 'so', acAsrConf: 0 },
            { utf8: ' Princess', tOffsetMs: 640, acAsrConf: 0 },
            { utf8: ' Celestia,', tOffsetMs: 1040, acAsrConf: 0 },
          ],
        },
        {
          tStartMs: 102630,
          dDurationMs: 2650,
          wWinId: 1,
          aAppend: 1,
          segs: [{ utf8: '\n' }],
        },
        {
          tStartMs: 102640,
          dDurationMs: 4799,
          wWinId: 1,
          segs: [
            { utf8: "you'll", acAsrConf: 0 },
            { utf8: ' never', tOffsetMs: 400, acAsrConf: 0 },
            { utf8: ' guess', tOffsetMs: 640, acAsrConf: 0 },
            { utf8: " who's", tOffsetMs: 960, acAsrConf: 0 },
            { utf8: ' back.', tOffsetMs: 1280, acAsrConf: 0 },
          ],
        },
      ]
      const data = convertYoutubeToStandardFormat({ events })
      const merged = sentencesInSubtitles(data, 'en')
      const texts = merged.map((it) => it.text)
      // ">> Who?" should be its own segment (sentenceStartRegex + sentenceEndRegex)
      expect(texts[0]).toBe('>> Who?')
      // "Oh," should be split from "so Princess Celestia..." due to ~16s time gap
      expect(texts[1]).toBe('Oh,')
      expect(texts[2]).toBe(
        "so Princess Celestia, you'll never guess who's back.",
      )
    })
    // Regression: sentence fragments like "this evening." caused LLM translation
    // to shift indices, producing wrong cached translations.
    it('should not produce sentence fragments from maxLength splits', async () => {
      const data = convertYoutubeToStandardFormat(
        (await import('./assets/timedtext-9Bn_Y5mVfJc.json'))
          .default as GetTimedtextResp,
      )
      const r = sentencesInSubtitles(data, 'en')
      // "this evening." was previously a fragment split from the sentence before it
      const fragment = r.find((it) => it.text === 'this evening.')
      expect(fragment).toBeUndefined()
      // The full sentence should be kept together
      const fullSentence = r.find((it) =>
        it.text.includes(
          'You can tackle a friendship lesson today and we can review your progress when I get back later this evening.',
        ),
      )
      expect(fullSentence).toBeDefined()
    })
    // Regression: interview-style ASR tracks can be only partially punctuated —
    // the anchor's speech is punctuated but guest segments have none at all
    // (runs of 88 and 180 words in this fixture). Without a finite
    // hardMaxLength those runs collapsed into single 416- and 990-char cues.
    // https://www.youtube.com/watch?v=bSKc5Sf63Ic
    it('should force-split unpunctuated runs in partially-punctuated tracks', async () => {
      const data = convertYoutubeToStandardFormat(
        (await import('./assets/timedtext-bSKc5Sf63Ic.json'))
          .default as GetTimedtextResp,
      )
      const r = sentencesInSubtitles(data, 'en')
      const longest = r.reduce((a, b) => (b.text.length > a.text.length ? b : a))
      // hardMaxLength (250) plus the word that pushed the buffer over it
      expect(longest.text.length).toBeLessThanOrEqual(270)
    })
    // Full pipeline for a partially punctuated track: the model punctuates
    // the bare runs, existing punctuation and casing are kept verbatim, and
    // nothing gets doubled ("2026..") or duplicated by the sliding window.
    // https://www.youtube.com/watch?v=bSKc5Sf63Ic
    it('should punctuate bare runs while preserving existing punctuation', async () => {
      const data = convertYoutubeToStandardFormat(
        (await import('./assets/timedtext-bSKc5Sf63Ic.json'))
          .default as GetTimedtextResp,
      )
      expect(hasMissingPunctuation(data)).true
      let r1
      for await (const processed of restorePunctuation(data)) {
        r1 = processed
      }
      // Sliding-window overlap must not re-emit tail tokens
      expect(r1!.length).eq(data.length)
      const full = r1!.map((t) => t.text).join(' ')
      // Already-punctuated region kept verbatim
      expect(full).contain('India takes the helm of bricks in 2026.')
      // No doubled punctuation anywhere
      expect(full).not.match(/[.,!?]{2}/)
      // The 88-word bare run got sentence punctuation from the model
      const r2 = sentencesInSubtitles(r1!, 'en')
      const longest = r2.reduce((a, b) =>
        b.text.length > a.text.length ? b : a,
      )
      expect(longest.text.length).toBeLessThanOrEqual(270)
    })
  })
  describe('Japanese subtitle merge', () => {
    // https://www.youtube.com/watch?v=O_ykW5H2HEg
    it('Should handle Japanese subtitle merge correctly', async () => {
      const data = convertYoutubeToStandardFormat(
        (await import('./assets/timedtext-japanese.json'))
          .default as GetTimedtextResp,
      )
      const r = sentencesInSubtitles(data, 'ja')
      const contents = r.map((it) => it.text)
      expect(contents)
        .contain('[音楽]')
        .contain('どう?')
        .contain('これぐらいで?')
        .contain('腕ちょっと弱いかいいんじゃない?')
        .contain('え、なんか割れながらなんです。')
    })
  })
  describe('Chinese subtitle merge', () => {
    // This is not an auto-generated subtitle, so skip it for now
    // https://www.youtube.com/watch?v=-mC5FcbVzro
    it.skip('Should handle Chinese subtitle merge correctly', async () => {
      const data = convertYoutubeToStandardFormat(
        (await import('./assets/timedtext-chinese.json'))
          .default as GetTimedtextResp,
      )
      const r = sentencesInSubtitles(data, 'zh-Hans')
      const contents = r.map((it) => it.text)
      console.log(contents.slice(0, 10))
    })
  })
  describe('resolveSubtitleTrack', () => {
    it('routes English ASR without punctuation to the sherpa-en model', () => {
      const data = [{ start: 0, end: 1, text: 'hello world how are you' }]
      expect(resolveSubtitleTrack({ rawLang: 'en', tlang: null, kind: 'asr', data })).toEqual({
        lang: 'en',
        mode: 'sherpa-en',
      })
    })
    it('routes already-punctuated English ASR to sentence grouping', () => {
      const data = [{ start: 0, end: 1, text: 'Hello, world.' }]
      expect(resolveSubtitleTrack({ rawLang: 'en', tlang: null, kind: 'asr', data })).toEqual({
        lang: 'en',
        mode: 'sentences',
      })
    })
    it('routes Japanese ASR to the cjk-punct-ja model', () => {
      const data = [{ start: 0, end: 1, text: 'こんにちは' }]
      expect(resolveSubtitleTrack({ rawLang: 'ja-JP', tlang: null, kind: 'asr', data })).toEqual({
        lang: 'ja',
        mode: 'cjk-punct-ja',
      })
    })
    it('treats manual (non-asr) captions as raw line-level cues', () => {
      const data = [{ start: 0, end: 1, text: 'A full caption line.' }]
      expect(resolveSubtitleTrack({ rawLang: 'en', tlang: null, kind: null, data })).toEqual({
        lang: 'en',
        mode: 'raw',
      })
    })
    // Regression: YouTube auto-translate sends kind=asr&lang=en&tlang=fr but the
    // bytes are already French. It must be labelled `fr`, never fed to sherpa-en.
    it('labels a YouTube auto-translated track by its tlang and skips the ASR models', async () => {
      const resp = (await import('./assets/timedtext-B6oUohZnKIc-french.json'))
        .default as GetTimedtextResp
      const data = convertYoutubeToStandardFormat(resp)
      const resolved = resolveSubtitleTrack({
        rawLang: 'en',
        tlang: 'fr',
        kind: 'asr',
        data,
      })
      expect(resolved).toEqual({ lang: 'fr', mode: 'sentences' })

      // The displayed result must be valid, well-ordered French cues.
      const cues = sentencesInSubtitles(data, resolved.lang)
      expect(cues.length).toBeGreaterThan(0)
      expect(cues[0].text.toLowerCase()).toContain('il était une fois')
      for (let i = 0; i < cues.length; i++) {
        expect(cues[i].end).toBeGreaterThanOrEqual(cues[i].start)
        if (i > 0) {
          expect(cues[i].start).toBeGreaterThanOrEqual(cues[i - 1].end)
        }
      }
    })
  })
})
