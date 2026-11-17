import * as ort from 'onnxruntime-web/wasm'
import type { TimedToken } from './PunctuationRestorationModel'

/**
 * Char-level CJK punctuation restoration model. Trained from scratch on
 * Japanese YouTube manual subtitles (TUBELEX + JTubeSpeech). For each input
 * codepoint, predicts the punctuation that should follow it: NONE / 。 / 、 /
 * ？ / ！. Emits TimedToken[] where each token's text has the predicted
 * punctuation appended.
 *
 * See ../../../ml/cjk-punct for training code.
 */

const PAD_ID = 0
const UNK_ID = 1
const NUM_CLASSES = 5

// Order must match scripts/clean_vtt.py PUNCT_TO_LABEL.
const ID_TO_PUNCT = ['', '。', '、', '？', '！'] as const

export interface CjkPunctOptions {
  /** Minimum softmax probability for a comma to be emitted. */
  threshold?: number
  /**
   * Minimum probability for terminal punctuation (。？！). Lower than the
   * comma threshold because a missed sentence boundary produces an over-long
   * cue (the original bug), which is worse than an extra split.
   */
  terminalThreshold?: number
  /** Char window size for inference; should match training seq_len (256). */
  windowSize?: number
  /** Overlap (in chars) between adjacent windows so cross-window context is shared. */
  windowStride?: number
}

// Class ids 1/3/4 are 。？！; 2 is 、.
const TERMINAL_CLASSES = new Set([1, 3, 4])

export class CjkPunctModel {
  private session: ort.InferenceSession | null = null
  private vocab: Map<string, number> = new Map()
  private threshold: number
  private terminalThreshold: number
  private windowSize: number
  private windowStride: number

  constructor(options: CjkPunctOptions = {}) {
    this.threshold = options.threshold ?? 0.5
    this.terminalThreshold = options.terminalThreshold ?? 0.4
    this.windowSize = options.windowSize ?? 256
    this.windowStride = options.windowStride ?? 224
  }

  async load(modelPath: string, vocabPath: string, wasmUrl?: string) {
    if (wasmUrl) {
      ort.env.wasm.wasmPaths = { wasm: wasmUrl }
    }
    // Content scripts are never crossOriginIsolated, and the page CSP (e.g.
    // YouTube's) can block the blob: workers the threaded runtime tries to
    // spawn before falling back. Pin to 1 thread to skip that slow path.
    ort.env.wasm.numThreads = 1
    ort.env.logLevel = 'error'

    const [session, vocabJson] = await Promise.all([
      ort.InferenceSession.create(modelPath),
      fetch(vocabPath).then((r) => r.json()),
    ])
    this.session = session
    this.vocab = new Map(Object.entries(vocabJson as Record<string, number>))
  }

  /**
   * Predict the per-character punctuation class for `text`.
   * Returns an array of length [...text].length: each entry is the class id
   * (0..4) of the punctuation that should follow that codepoint.
   */
  async predict(text: string): Promise<Uint8Array> {
    if (!this.session) throw new Error('CjkPunctModel: not loaded')
    const chars = [...text]
    const n = chars.length
    if (n === 0) return new Uint8Array(0)

    const ids = new Array<number>(n)
    for (const [i, ch] of chars.entries()) {
      ids[i] = this.vocab.get(ch) ?? UNK_ID
    }

    // Sliding windows, take prediction from the most-centered window for each char.
    const out = new Uint8Array(n)
    const used = new Float32Array(n) // best confidence margin per position

    for (let start = 0; start < n; start += this.windowStride) {
      const end = Math.min(start + this.windowSize, n)
      // Slice first so the window length and the ids read below come from the
      // same array — no index arithmetic to prove in range.
      const windowIds = ids.slice(start, end)
      const winLen = windowIds.length

      const inputIds = new BigInt64Array(winLen)
      for (const [i, id] of windowIds.entries()) {
        inputIds[i] = BigInt(id)
      }
      const attnMask = new BigInt64Array(winLen).fill(1n)
      const feeds = {
        input_ids: new ort.Tensor('int64', inputIds, [1, winLen]),
        attention_mask: new ort.Tensor('int64', attnMask, [1, winLen]),
      }
      const result = await this.session.run(feeds)
      const logitsTensor = result.logits
      if (!logitsTensor) {
        throw new Error('CjkPunctModel: model output "logits" is missing')
      }
      // (1, winLen, NUM_CLASSES)
      const logits = logitsTensor.data as Float32Array

      for (let i = 0; i < winLen; i++) {
        // softmax over 5 classes
        const row = logits.subarray(i * NUM_CLASSES, (i + 1) * NUM_CLASSES)
        let max = -Infinity
        for (const v of row) {
          if (v > max) max = v
        }
        let sum = 0
        const probs = new Float32Array(NUM_CLASSES)
        for (const [c, v] of row.entries()) {
          const p = Math.exp(v - max)
          probs[c] = p
          sum += p
        }
        let bestC = 0
        let bestP = 0
        for (const [c, p] of probs.entries()) {
          const prob = p / sum
          probs[c] = prob
          if (prob > bestP) {
            bestP = prob
            bestC = c
          }
        }
        // Apply per-class threshold for non-NONE classes
        let cls = 0
        if (bestC !== 0) {
          const th = TERMINAL_CLASSES.has(bestC)
            ? this.terminalThreshold
            : this.threshold
          if (bestP >= th) cls = bestC
        }

        // Prefer prediction from the window where this position is more central
        const centerDist = Math.abs(i - winLen / 2)
        const score = bestP - 0.001 * centerDist
        const pos = start + i
        const scored = used[pos] ?? 0 // 0 marks "no window claimed this yet"
        if (score > scored || scored === 0) {
          used[pos] = score
          out[pos] = cls
        }
      }

      if (end >= n) break
    }
    return out
  }

  /**
   * Annotate timed tokens with predicted punctuation. Each output token's text
   * is the original token text plus any predicted punctuation appended.
   *
   * Streams in chunks so the UI can update progressively, mirroring the API
   * exposed by PunctuationRestorationModel.annotate.
   */
  async *annotate(
    tokens: TimedToken[],
  ): AsyncGenerator<TimedToken[], TimedToken[]> {
    if (!this.session) throw new Error('CjkPunctModel: not loaded')
    if (tokens.length === 0) return []

    // Build the concatenated text (no separator — CJK subtitle convention) and
    // remember which token each char belongs to.
    const allChars: string[] = []
    const charToToken: number[] = []
    for (const [ti, token] of tokens.entries()) {
      for (const ch of token.text) {
        allChars.push(ch)
        charToToken.push(ti)
      }
    }
    const text = allChars.join('')
    const labels = await this.predict(text)

    // For each original token, walk its chars: whenever the model predicts a
    // non-NONE class, split the token at that position (interpolating time by
    // char ratio) so downstream sentencesInSubtitles can break cues on the
    // inserted punctuation. Without this, internal predictions inside a single
    // YouTube cue would be discarded.
    const annotated: TimedToken[] = []
    let charCursor = 0
    for (const [ti, original] of tokens.entries()) {
      // Collect chars+labels for this token
      const tokenChars: string[] = []
      const tokenLabels: number[] = []
      while (
        charCursor < charToToken.length &&
        charToToken[charCursor] === ti
      ) {
        const ch = allChars[charCursor]
        if (ch === undefined) break
        tokenChars.push(ch)
        // `labels` has one entry per char; 0 (NONE) when the model gave none.
        tokenLabels.push(labels[charCursor] ?? 0)
        charCursor++
      }
      const n = tokenChars.length
      if (n === 0) {
        annotated.push(original)
        continue
      }
      const duration = original.end - original.start
      let segStart = 0
      let segText = ''
      const PUNCT_FOLD_RE = /[。、？！,.?!]/
      const TERMINAL_FOLD_RE = /[。！？.!?]/
      const pushSeg = (start: number, end: number, text: string) => {
        // If the new segment is pure punctuation, fold it into the previous
        // segment. Prev wins: only append punct from `text` if prev doesn't
        // already end with punct. If prev ends with a comma and text has a
        // terminal, upgrade comma → terminal.
        const stripped = text.replace(/[。、？！,.?!]/g, '').trim()
        const prev = annotated.at(-1)
        if (stripped.length === 0 && prev) {
          let merged = prev.text
          const lastChar = merged[merged.length - 1] ?? ''
          if (!PUNCT_FOLD_RE.test(lastChar)) {
            // Prev has no terminal punct — pick the strongest punct from text.
            const strongest =
              text.match(TERMINAL_FOLD_RE)?.[0] ?? text.match(/[、,]/)?.[0]
            if (strongest) merged += strongest
          } else if (/[、,]/.test(lastChar)) {
            // Upgrade trailing comma to terminal if available.
            const upgrade = text.match(TERMINAL_FOLD_RE)?.[0]
            if (upgrade) merged = merged.slice(0, -1) + upgrade
          }
          annotated[annotated.length - 1] = {
            start: prev.start,
            end,
            text: merged,
          }
          return
        }
        annotated.push({ start, end, text })
      }
      const PUNCT_RE = /[。、？！,.?!]/
      for (let i = 0; i < n; i++) {
        const ch = tokenChars[i]
        const cls = tokenLabels[i]
        if (ch === undefined || cls === undefined) continue
        segText += ch
        if (cls !== 0) {
          // YouTube ASR for ja already inserts ~50% of terminal punct. If the
          // very next char in the original text is ANY punctuation, defer to
          // it: append the original punct and split AFTER it, so the segment
          // ends with the authoritative punctuation.
          const nextCh = tokenChars[i + 1]
          if (nextCh !== undefined && PUNCT_RE.test(nextCh)) {
            segText += nextCh
            pushSeg(
              original.start + (duration * segStart) / n,
              original.start + (duration * (i + 2)) / n,
              segText,
            )
            segStart = i + 2
            segText = ''
            i++ // consume the original-punct char
            continue
          }
          segText += ID_TO_PUNCT[cls] ?? ''
          pushSeg(
            original.start + (duration * segStart) / n,
            original.start + (duration * (i + 1)) / n,
            segText,
          )
          segStart = i + 1
          segText = ''
        }
      }
      if (segText.length > 0) {
        pushSeg(
          original.start + (duration * segStart) / n,
          original.end,
          segText,
        )
      }
    }

    yield annotated
    return annotated
  }
}
