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
  /** Minimum softmax probability for a non-NONE class to be emitted. */
  threshold?: number
  /** Char window size for inference; should match training seq_len (256). */
  windowSize?: number
  /** Overlap (in chars) between adjacent windows so cross-window context is shared. */
  windowStride?: number
}

export class CjkPunctModel {
  private session: ort.InferenceSession | null = null
  private vocab: Map<string, number> = new Map()
  private threshold: number
  private windowSize: number
  private windowStride: number

  constructor(options: CjkPunctOptions = {}) {
    this.threshold = options.threshold ?? 0.5
    this.windowSize = options.windowSize ?? 256
    this.windowStride = options.windowStride ?? 224
  }

  async load(modelPath: string, vocabPath: string, wasmUrl?: string) {
    if (wasmUrl) {
      ort.env.wasm.wasmPaths = { wasm: wasmUrl }
    }
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
    for (let i = 0; i < n; i++) {
      ids[i] = this.vocab.get(chars[i]) ?? UNK_ID
    }

    // Sliding windows, take prediction from the most-centered window for each char.
    const out = new Uint8Array(n)
    const used = new Float32Array(n) // best confidence margin per position

    for (let start = 0; start < n; start += this.windowStride) {
      const end = Math.min(start + this.windowSize, n)
      const winLen = end - start

      const inputIds = new BigInt64Array(winLen)
      const attnMask = new BigInt64Array(winLen)
      for (let i = 0; i < winLen; i++) {
        inputIds[i] = BigInt(ids[start + i])
        attnMask[i] = 1n
      }
      const feeds = {
        input_ids: new ort.Tensor('int64', inputIds, [1, winLen]),
        attention_mask: new ort.Tensor('int64', attnMask, [1, winLen]),
      }
      const result = await this.session.run(feeds)
      const logits = result.logits.data as Float32Array // (1, winLen, NUM_CLASSES)

      for (let i = 0; i < winLen; i++) {
        // softmax over 5 classes
        const base = i * NUM_CLASSES
        let max = -Infinity
        for (let c = 0; c < NUM_CLASSES; c++) {
          const v = logits[base + c]
          if (v > max) max = v
        }
        let sum = 0
        const probs = new Float32Array(NUM_CLASSES)
        for (let c = 0; c < NUM_CLASSES; c++) {
          probs[c] = Math.exp(logits[base + c] - max)
          sum += probs[c]
        }
        let bestC = 0
        let bestP = 0
        for (let c = 0; c < NUM_CLASSES; c++) {
          probs[c] /= sum
          if (probs[c] > bestP) {
            bestP = probs[c]
            bestC = c
          }
        }
        // Apply threshold for non-NONE classes
        let cls = 0
        if (bestC !== 0 && bestP >= this.threshold) cls = bestC

        // Prefer prediction from the window where this position is more central
        const centerDist = Math.abs(i - winLen / 2)
        const score = bestP - 0.001 * centerDist
        const pos = start + i
        if (score > used[pos] || used[pos] === 0) {
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
    for (let ti = 0; ti < tokens.length; ti++) {
      for (const ch of tokens[ti].text) {
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
    for (let ti = 0; ti < tokens.length; ti++) {
      const original = tokens[ti]
      // Collect chars+labels for this token
      const tokenChars: string[] = []
      const tokenLabels: number[] = []
      while (
        charCursor < charToToken.length &&
        charToToken[charCursor] === ti
      ) {
        tokenChars.push(allChars[charCursor])
        tokenLabels.push(labels[charCursor])
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
        if (stripped.length === 0 && annotated.length > 0) {
          const prev = annotated[annotated.length - 1]
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
        segText += tokenChars[i]
        const cls = tokenLabels[i]
        if (cls !== 0) {
          // YouTube ASR for ja already inserts ~50% of terminal punct. If the
          // very next char in the original text is ANY punctuation, defer to
          // it: append the original punct and split AFTER it, so the segment
          // ends with the authoritative punctuation.
          if (i + 1 < n && PUNCT_RE.test(tokenChars[i + 1])) {
            segText += tokenChars[i + 1]
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
          segText += ID_TO_PUNCT[cls]
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
