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

// Punctuation and case mapping
const PUNCT_MAP: Record<number, string> = {
  0: '', // NO_PUNCT
  1: ',', // COMMA
  2: '.', // PERIOD
  3: '?', // QUESTION
}

const CASE_TYPE_MAP = ['LOWER', 'UPPER', 'CAP', 'MIX'] as const
const PUNCT_TYPE_MAP = ['NONE', 'COMMA', 'PERIOD', 'QUESTION'] as const

const CASE_MAP: Record<number, (word: string) => string> = {
  0: (w) => w.toLowerCase(), // LOWER
  1: (w) => w.toUpperCase(), // UPPER
  2: (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase(), // CAP
  3: (w) => w, // MIX_CASE
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
      const currentWord = words[wordIdx].toLowerCase()

      // Accumulate BPE tokens until matching current word
      let accumulatedText = ''

      while (bpeIdx < bpeTokenIds.length) {
        const bpeToken = this.tokenizer.decode([bpeTokenIds[bpeIdx]])
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
      const caseType = casePred[wordIdx] !== undefined ? casePred[wordIdx] : 0
      const punctType =
        punctPred[wordIdx] !== undefined ? punctPred[wordIdx] : 0

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
        if (i < windowResults.length) {
          results.push(windowResults[i])
        }
      }

      // Move window
      wordStart = wordEnd - overlapWords * 2
      if (wordStart <= wordEnd - windowTokens.length) {
        wordStart = wordEnd
      }

      yield [...results]

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

    // Run model
    const feeds: Record<string, ort.Tensor> = {}
    feeds[this.session.inputNames[0]] = inputTokenIds
    feeds[this.session.inputNames[1]] = inputValidIds
    feeds[this.session.inputNames[2]] = labelLens

    const results = await this.session.run(feeds)

    // Parse output
    const outputNames = this.session.outputNames
    const caseLogits = results[outputNames[0]].data as Float32Array
    const punctLogits = results[outputNames[1]].data as Float32Array

    const caseClasses = 4
    const punctClasses = 4
    const numPredictions = caseLogits.length / caseClasses

    // Get prediction results (argmax)
    const casePred: number[] = []
    const punctPred: number[] = []

    for (let i = 0; i < numPredictions; i++) {
      let maxCaseIdx = 0
      let maxCaseVal = caseLogits[i * caseClasses]
      for (let j = 1; j < caseClasses; j++) {
        if (caseLogits[i * caseClasses + j] > maxCaseVal) {
          maxCaseVal = caseLogits[i * caseClasses + j]
          maxCaseIdx = j
        }
      }
      casePred.push(maxCaseIdx)

      let maxPunctIdx = 0
      let maxPunctVal = punctLogits[i * punctClasses]
      for (let j = 1; j < punctClasses; j++) {
        if (punctLogits[i * punctClasses + j] > maxPunctVal) {
          maxPunctVal = punctLogits[i * punctClasses + j]
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
