import * as ort from 'onnxruntime-web/wasm'
import { BPETokenizer } from './bpeTokenizer'

export interface TimedToken {
  start: number
  end: number
  text: string
}

export interface AnnotatedToken extends TimedToken {
  casedText: string
  punctuation: string
  caseType: 'LOWER' | 'UPPER' | 'CAP' | 'MIX'
  punctType: 'NONE' | 'COMMA' | 'PERIOD' | 'QUESTION'
}

// Punctuation and case mapping, indexed by the model's class id.
// Tuples (not Records) so a lookup by a known class id is total.
const PUNCT_MAP = [
  '', // NO_PUNCT
  ',', // COMMA
  '.', // PERIOD
  '?', // QUESTION
] as const

const CASE_TYPE_MAP = ['LOWER', 'UPPER', 'CAP', 'MIX'] as const
const PUNCT_TYPE_MAP = ['NONE', 'COMMA', 'PERIOD', 'QUESTION'] as const

const CASE_MAP = [
  (w: string) => w.toLowerCase(), // LOWER
  (w: string) => w.toUpperCase(), // UPPER
  (w: string) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase(), // CAP
  (w: string) => w, // MIX_CASE
] as const

/** Class id the model predicts; missing / unknown ids fall back to class 0. */
function classId(predicted: number | undefined): 0 | 1 | 2 | 3 {
  return predicted === 1 || predicted === 2 || predicted === 3 ? predicted : 0
}

export class PunctuationRestorationModel {
  private session: ort.InferenceSession | null = null
  private maxSeqLength = 200
  private maxTokensPerWindow = 180 // Leave room for <s> </s> tokens
  private overlap = 30 // Token-level overlap

  private tokenizer: BPETokenizer
  constructor(tokenizer: BPETokenizer) {
    this.tokenizer = tokenizer
  }

  async load(modelPath: string, wasmUrl?: string) {
    ort.env.wasm.wasmPaths = {
      wasm: wasmUrl,
    }
    // Content scripts are never crossOriginIsolated, and the page CSP (e.g.
    // YouTube's) can block the blob: workers the threaded runtime tries to
    // spawn before falling back. Pin to 1 thread to skip that slow path.
    ort.env.wasm.numThreads = 1
    ort.env.logLevel = 'error'
    this.session = await ort.InferenceSession.create(modelPath)
  }

  /**
   * Set window config (based on token count, not word count)
   */
  setWindowConfig(maxTokensPerWindow: number, overlap: number) {
    if (maxTokensPerWindow > this.maxSeqLength - 20) {
      console.warn(
        `Window size ${maxTokensPerWindow} is too large, using ${
          this.maxSeqLength - 20
        }`,
      )
      this.maxTokensPerWindow = this.maxSeqLength - 20
    } else {
      this.maxTokensPerWindow = maxTokensPerWindow
    }
    this.overlap = Math.min(overlap, maxTokensPerWindow / 3)
  }

  /**
   * Map model predictions back to input tokens while accounting for tokens that
   * expand into multiple whitespace-separated words during BPE encoding (e.g.
   * `>> Morning`, `going to`). Each token consumes exactly `subwordCounts[i]`
   * prediction slots, so subsequent tokens never drift out of alignment.
   */
  private mapPredictionsToTokens(
    tokens: TimedToken[],
    subwordCounts: number[],
    casePred: number[],
    punctPred: number[],
  ): AnnotatedToken[] {
    let predIdx = 0
    return tokens.map((token, i) => {
      const count = subwordCounts[i] ?? 0
      if (count <= 0) {
        return {
          ...token,
          casedText: token.text,
          punctuation: '',
          caseType: 'MIX',
          punctType: 'NONE',
        }
      }
      // First subword supplies leading capitalization; last subword supplies
      // trailing punctuation.
      const caseType = classId(casePred[predIdx])
      const punctType = classId(punctPred[predIdx + count - 1])
      predIdx += count

      return {
        ...token,
        casedText: CASE_MAP[caseType](token.text),
        punctuation: PUNCT_MAP[punctType],
        caseType: CASE_TYPE_MAP[caseType],
        punctType: PUNCT_TYPE_MAP[punctType],
      }
    })
  }

  /**
   * Count BPE tokens contributed by each input `TimedToken` (excluding `<s>`
   * and `</s>`).
   */
  private measureTokenBpeLengths(tokens: TimedToken[]): number[] {
    return tokens.map((token) => {
      const words = token.text
        .trim()
        .split(/\s+/)
        .filter((w) => w.length > 0)
      let len = 0
      for (const word of words) {
        len += this.tokenizer.encodeWord(word).length
      }
      return len
    })
  }

  /**
   * Streaming processing: use AsyncGenerator for window-by-window output.
   *
   * Invariant: every input token `0..tokens.length - 1` is emitted exactly once
   * in exact order (`results.length === tokens.length` on completion), even
   * when long/OOV words shrink a window to fewer than `overlap` tokens.
   */
  async *annotate(
    tokens: TimedToken[],
  ): AsyncGenerator<AnnotatedToken[], AnnotatedToken[]> {
    if (!this.session || !this.tokenizer) {
      throw new Error('Model not loaded. Call load() first.')
    }
    if (tokens.length === 0) {
      yield []
      return []
    }

    const tokenBpeLens = this.measureTokenBpeLengths(tokens)
    const totalBpeTokens =
      2 + tokenBpeLens.reduce((sum, len) => sum + len, 0)

    // If BPE token count is within limit, process directly
    if (totalBpeTokens <= this.maxTokensPerWindow) {
      const results = await this.processWindow(tokens)
      yield results
      return results
    }

    const findWindowEnd = (startIdx: number): number => {
      let endIdx = startIdx
      let bpeCount = 2 // <s> + </s>
      while (endIdx < tokens.length) {
        const nextLen = tokenBpeLens[endIdx] ?? 0
        if (bpeCount + nextLen > this.maxTokensPerWindow) {
          break
        }
        bpeCount += nextLen
        endIdx++
      }
      return endIdx
    }

    // Sliding window processing anchored on `nextEmitIdx` so no token can ever
    // be dropped or duplicated regardless of window size.
    const results: AnnotatedToken[] = []
    const overlapWords = Math.floor(this.overlap / 2)
    let nextEmitIdx = 0

    while (nextEmitIdx < tokens.length) {
      let wordStart = Math.max(0, nextEmitIdx - overlapWords)
      let wordEnd = findWindowEnd(wordStart)

      // If left context filled the window before reaching `nextEmitIdx`, shrink
      // left context until `tokens[nextEmitIdx]` fits.
      while (wordEnd <= nextEmitIdx && wordStart < nextEmitIdx) {
        wordStart = Math.min(
          nextEmitIdx,
          wordStart + Math.max(1, Math.ceil((nextEmitIdx - wordStart) / 2)),
        )
        wordEnd = findWindowEnd(wordStart)
      }
      // Single token longer than maxTokensPerWindow: process it alone (truncated
      // to maxSeqLength inside processWindow).
      if (wordEnd <= nextEmitIdx) {
        wordStart = nextEmitIdx
        wordEnd = nextEmitIdx + 1
      }

      const windowTokens = tokens.slice(wordStart, wordEnd)
      const windowResults = await this.processWindow(windowTokens)

      const keepStart = nextEmitIdx - wordStart
      const available = windowResults.length - keepStart
      let keepEnd: number
      if (wordEnd >= tokens.length) {
        keepEnd = windowResults.length
      } else {
        // Keep full right-context overlap when possible; otherwise shrink right
        // overlap so every window emits at least 1 new token.
        const rightOverlap =
          available > overlapWords
            ? overlapWords
            : Math.floor((available - 1) / 2)
        keepEnd = windowResults.length - rightOverlap
      }

      for (let i = keepStart; i < keepEnd; i++) {
        const windowResult = windowResults[i]
        if (windowResult) {
          results.push(windowResult)
        }
      }
      nextEmitIdx += keepEnd - keepStart

      yield [...results]

      if (nextEmitIdx < tokens.length) {
        await new Promise((resolve) => setTimeout(resolve, 0))
      }
    }

    return results
  }

  /**
   * Process a single window
   */
  private async processWindow(tokens: TimedToken[]): Promise<AnnotatedToken[]> {
    if (!this.session || !this.tokenizer) {
      throw new Error('Model not loaded. Call load() first.')
    }

    const tokenIds: number[] = [this.tokenizer.pieceToId('<s>')]
    const wordBoundaries: number[] = [0]
    const subwordCounts: number[] = []

    for (const token of tokens) {
      const words = token.text
        .trim()
        .split(/\s+/)
        .filter((w) => w.length > 0)
      let encodedWords = 0
      for (const word of words) {
        const ids = this.tokenizer.encodeWord(word)
        if (ids.length === 0) continue
        wordBoundaries.push(tokenIds.length)
        for (const id of ids) {
          tokenIds.push(id)
        }
        encodedWords++
      }
      subwordCounts.push(encodedWords)
    }

    wordBoundaries.push(tokenIds.length)
    tokenIds.push(this.tokenizer.pieceToId('</s>'))

    // Create valid_ids (only mark word boundary positions)
    const validIds = new Array(this.maxSeqLength).fill(0)
    for (const boundary of wordBoundaries) {
      if (boundary < this.maxSeqLength) {
        validIds[boundary] = 1
      }
    }

    // Truncate to max sequence length
    const truncatedTokenIds = tokenIds.slice(0, this.maxSeqLength)
    const truncatedValidIds = validIds.slice(0, this.maxSeqLength)
    const actualValidCount = truncatedValidIds.filter((v) => v === 1).length

    // Padding
    const paddedTokenIds = [...truncatedTokenIds]
    while (paddedTokenIds.length < this.maxSeqLength) {
      paddedTokenIds.push(0)
    }

    const paddedValidIds = [...truncatedValidIds]
    while (paddedValidIds.length < this.maxSeqLength) {
      paddedValidIds.push(0)
    }

    // Prepare model input
    const inputTokenIds = new ort.Tensor(
      'int32',
      new Int32Array(paddedTokenIds),
      [1, this.maxSeqLength],
    )
    const inputValidIds = new ort.Tensor(
      'int32',
      new Int32Array(paddedValidIds),
      [1, this.maxSeqLength],
    )
    const labelLens = new ort.Tensor(
      'int32',
      new Int32Array([actualValidCount]),
      [1],
    )

    // Run model — the sherpa punctuation model takes exactly these 3 inputs
    // and returns case + punct logits, in that order.
    const [tokenIdsName, validIdsName, labelLensName, ...extraInputs] =
      this.session.inputNames
    if (
      !tokenIdsName ||
      !validIdsName ||
      !labelLensName ||
      extraInputs.length > 0
    ) {
      throw new Error(
        `Expected 3 model inputs, got ${this.session.inputNames.length}`,
      )
    }
    const feeds: Record<string, ort.Tensor> = {}
    feeds[tokenIdsName] = inputTokenIds
    feeds[validIdsName] = inputValidIds
    feeds[labelLensName] = labelLens

    const results = await this.session.run(feeds)

    // Parse output
    const [caseLogitsName, punctLogitsName] = this.session.outputNames
    if (!caseLogitsName || !punctLogitsName) {
      throw new Error(
        `Expected 2 model outputs, got ${this.session.outputNames.length}`,
      )
    }
    const caseLogitsTensor = results[caseLogitsName]
    const punctLogitsTensor = results[punctLogitsName]
    if (!caseLogitsTensor || !punctLogitsTensor) {
      throw new Error(
        `Model returned no "${caseLogitsName}"/"${punctLogitsName}" output`,
      )
    }
    const caseLogits = caseLogitsTensor.data as Float32Array
    const punctLogits = punctLogitsTensor.data as Float32Array

    const caseClasses = 4
    const punctClasses = 4
    const numPredictions = caseLogits.length / caseClasses

    // Get prediction results (argmax)
    const casePred: number[] = []
    const punctPred: number[] = []

    for (let i = 0; i < numPredictions; i++) {
      const caseRow = caseLogits.subarray(
        i * caseClasses,
        (i + 1) * caseClasses,
      )
      let maxCaseIdx = 0
      let maxCaseVal = -Infinity
      for (const [j, v] of caseRow.entries()) {
        if (v > maxCaseVal) {
          maxCaseVal = v
          maxCaseIdx = j
        }
      }
      casePred.push(maxCaseIdx)

      const punctRow = punctLogits.subarray(
        i * punctClasses,
        (i + 1) * punctClasses,
      )
      let maxPunctIdx = 0
      let maxPunctVal = -Infinity
      for (const [j, v] of punctRow.entries()) {
        if (v > maxPunctVal) {
          maxPunctVal = v
          maxPunctIdx = j
        }
      }
      punctPred.push(maxPunctIdx)
    }

    if (tokenIds.length > this.maxSeqLength) {
      console.warn(
        `⚠️ Input text is too long! Truncated from ${tokenIds.length} to ${this.maxSeqLength} tokens.`,
      )
    }

    return this.mapPredictionsToTokens(tokens, subwordCounts, casePred, punctPred)
  }

  /**
   * Helper function: render annotated tokens as punctuated text
   */
  renderAnnotatedTokens(tokens: AnnotatedToken[]): string {
    return tokens.map((t) => t.casedText + t.punctuation).join(' ')
  }
}
