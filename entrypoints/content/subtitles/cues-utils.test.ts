import { expect, it } from 'vitest'
import { findMatchingSubtitle, getCuesToTranslate } from './cues-utils'
import { subtitleStore } from './store'

// Correctly handle
it('getCuesToTranslate filters cues correctly', () => {
  const r = getCuesToTranslate(
    [
      {
        start: 2.11,
        end: 13.36,
        content:
          "[Music] What's wrong, Twilight? It doesn't seem that my new role as a princess equates",
      },
      {
        start: 8.16,
        end: 19.039,
        content:
          'to all that much. I am Lord Derek, and I will take what should have been mine',
      },
    ],
    5.913815,
  )
  expect(r).length(2)
})

// Correctly handle findMatchingSubtitle
it('findMatchingSubtitle finds the correct cue', () => {
  const cues = [
    {
      start: 2.11,
      end: 13.36,
      content:
        "[Music] What's wrong, Twilight? It doesn't seem that my new role as a princess equates",
    },
    {
      start: 8.16,
      end: 19.039,
      content:
        'to all that much. I am Lord Derek, and I will take what should have been mine',
    },
  ]
  const r = findMatchingSubtitle(cues, 10)
  expect(r).toEqual(cues[1])
})
