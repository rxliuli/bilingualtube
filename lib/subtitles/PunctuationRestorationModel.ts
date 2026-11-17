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
   * Map BPE tokens back to original words using two-pointer matching
   */
  private matchBPEToWords(
    words: string[],
    bpeTokenIds: number[],
    validIds: number[],
  ): Map<number, number[]> {
    // Returns: wordIndex -> [bpeTokenIndices]
    const wordToBPE = new Map<number, number[]>()

    if (!this.tokenizer) throw new Error('Tokenizer not loaded')

    let wordIdx = 0
    let bpeIdx = 0

    // Skip start token <s>
    if (bpeTokenIds[0] === this.tokenizer.pieceToId('<s>')) {
      bpeIdx = 1
    }

    while (wordIdx < words.length && bpeIdx < bpeTokenIds.length) {
      // Skip end token
      if (bpeTokenIds[bpeIdx] === this.tokenizer.pieceToId('</s>')) {
        break
      }

      const bpeIndices: number[] = []
      const word = words[wordIdx]
      if (word === undefined) break
      const currentWord = word.toLowerCase()

      // Accumulate BPE tokens until matching current word
      let accumulatedText = ''

      while (bpeIdx < bpeTokenIds.length) {
        const bpeTokenId = bpeTokenIds[bpeIdx]
        if (bpeTokenId === undefined) break
        const bpeToken = this.tokenizer.decode([bpeTokenId])
        accumulatedText += bpeToken

        // Only record valid token indices
        if (validIds[bpeIdx] === 1) {
          bpeIndices.push(bpeIdx)
        }

        bpeIdx++

        // Check if it matches current word (remove spaces and ▁ symbol)
        const normalized = accumulatedText.replace(/[▁\s]/g, '').toLowerCase()
        if (normalized === currentWord) {
          break
        }

        // Prevent infinite loop
        if (bpeIdx >= bpeTokenIds.length) break
      }

      if (bpeIndices.length > 0) {
        wordToBPE.set(wordIdx, bpeIndices)
      }

      wordIdx++
    }

    return wordToBPE
  }

  /**
   * Map predictions back to original tokens (simplified: direct index mapping)
   */
  private mapPredictionsToTokens(
    tokens: TimedToken[],
    _wordToBPE: Map<number, number[]>,
    casePred: number[],
    punctPred: number[],
  ): AnnotatedToken[] {
    return tokens.map((token, wordIdx) => {
      // Use word index directly to get predictions (model output already excludes <s> and </s>)
      // Prediction indices directly correspond to word indices
      const caseType = classId(casePred[wordIdx])
      const punctType = classId(punctPred[wordIdx])

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
   * Streaming processing: use AsyncGenerator for window-by-window output
   */
  async *annotate(
    tokens: TimedToken[],
  ): AsyncGenerator<AnnotatedToken[], AnnotatedToken[]> {
    if (!this.session || !this.tokenizer) {
      throw new Error('Model not loaded. Call load() first.')
    }

    // First tokenize the entire text to determine if segmentation is needed
    const fullText = tokens.map((t) => t.text).join(' ')
    const { tokenIds } = this.tokenizer.encode(fullText)

    // If BPE token count is within limit, process directly
    if (tokenIds.length <= this.maxTokensPerWindow) {
      const results = await this.processWindow(tokens)
      yield results
      return results
    }

    // Sliding window processing
    const results: AnnotatedToken[] = []
    let wordStart = 0

    while (wordStart < tokens.length) {
      // Calculate window boundaries
      let wordEnd = wordStart
      let currentTokenCount = 0

      while (
        wordEnd < tokens.length &&
        currentTokenCount < this.maxTokensPerWindow
      ) {
        const testText = tokens
          .slice(wordStart, wordEnd + 1)
          .map((t) => t.text)
          .join(' ')
        const { tokenIds } = this.tokenizer.encode(testText)

        if (tokenIds.length > this.maxTokensPerWindow) {
          break
        }

        currentTokenCount = tokenIds.length
        wordEnd++
      }

      if (wordEnd === wordStart) {
        wordEnd = wordStart + 1
      }

      const windowTokens = tokens.slice(wordStart, wordEnd)
      const windowResults = await this.processWindow(windowTokens)

      // Handle overlap: only keep non-overlapping parts
      const overlapWords = Math.floor(this.overlap / 2)
      const keepStart = wordStart === 0 ? 0 : overlapWords
      const keepEnd =
        wordEnd >= tokens.length
          ? windowResults.length
          : windowResults.length - overlapWords

      for (let i = keepStart; i < keepEnd; i++) {
        const windowResult = windowResults[i]
        if (windowResult) {
          results.push(windowResult)
        }
      }

      yield [...results]

      // The final window reached the end of the input; stop before the
      // overlap rewind below re-processes and re-emits the tail tokens.
      if (wordEnd >= tokens.length) {
        break
      }

      // Move window
      wordStart = wordEnd - overlapWords * 2
      if (wordStart <= wordEnd - windowTokens.length) {
        wordStart = wordEnd
      }

      await new Promise((resolve) => setTimeout(resolve, 0))
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

    const text = tokens.map((t) => t.text).join(' ')
    const words = tokens.map((t) => t.text)

    const { tokenIds, wordBoundaries } = this.tokenizer.encode(text)

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

    // Two-pointer matching: BPE tokens -> original words
    const wordToBPE = this.matchBPEToWords(words, paddedTokenIds, validIds)

    if (tokenIds.length > this.maxSeqLength) {
      console.warn(
        `⚠️ Input text is too long! Truncated from ${tokenIds.length} to ${this.maxSeqLength} tokens.`,
      )
    }

    return this.mapPredictionsToTokens(tokens, wordToBPE, casePred, punctPred)
  }

  /**
   * Helper function: render annotated tokens as punctuated text
   */
  renderAnnotatedTokens(tokens: AnnotatedToken[]): string {
    return tokens.map((t) => t.casedText + t.punctuation).join(' ')
  }
}
