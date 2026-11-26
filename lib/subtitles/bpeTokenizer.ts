// SentencePiece Unigram BPE tokenizer for sherpa-onnx English punctuation model
const SPECIAL_TOKENS = new Set(['<unk>', '<s>', '</s>'])
const UNK_PENALTY = -100

export class BPETokenizer {
  private vocab: Map<string, number> = new Map()
  private scores: Map<string, number> = new Map()
  private reverseVocab: Map<number, string> = new Map()
  private maxPieceLength = 1
  private unkId = 0

  async load(vocabPath: string) {
    const response = await fetch(vocabPath)
    const text = await response.text()

    this.vocab.clear()
    this.scores.clear()
    this.reverseVocab.clear()
    this.maxPieceLength = 1

    const lines = text.trim().split('\n')
    lines.forEach((line, index) => {
      const [piece, rawScore] = line.split('\t')
      if (piece === undefined) return
      this.vocab.set(piece, index)
      this.reverseVocab.set(index, piece)
      if (!SPECIAL_TOKENS.has(piece)) {
        const parsedScore = rawScore !== undefined ? Number(rawScore) : Number.NaN
        this.scores.set(piece, Number.isFinite(parsedScore) ? parsedScore : -10)
        if (piece.length > this.maxPieceLength) {
          this.maxPieceLength = piece.length
        }
      }
    })
    this.unkId = this.vocab.get('<unk>') ?? 0
  }

  /**
   * Encode a single whitespace-delimited word into SentencePiece Unigram token
   * IDs via Viterbi DP over the vocab log-probabilities.
   */
  encodeWord(word: string): number[] {
    const lower = word.toLowerCase()
    if (!lower) return []

    const prefixed = '▁' + lower
    const exactId = this.vocab.get(prefixed)
    if (exactId !== undefined && !SPECIAL_TOKENS.has(prefixed)) {
      return [exactId]
    }

    const n = prefixed.length
    const bestScore = new Float64Array(n + 1).fill(-Infinity)
    const bestPrev = new Int32Array(n + 1).fill(-1)
    const bestId = new Int32Array(n + 1).fill(this.unkId)
    bestScore[0] = 0

    for (let i = 0; i < n; i++) {
      const base = bestScore[i]!
      if (base === -Infinity) continue

      let matchedSingleChar = false
      const maxLen = Math.min(this.maxPieceLength, n - i)
      for (let len = 1; len <= maxLen; len++) {
        const piece = prefixed.slice(i, i + len)
        const score = this.scores.get(piece)
        if (score === undefined) continue
        if (len === 1) matchedSingleChar = true
        const cand = base + score
        if (cand > bestScore[i + len]!) {
          bestScore[i + len] = cand
          bestPrev[i + len] = i
          bestId[i + len] = this.vocab.get(piece)!
        }
      }

      if (!matchedSingleChar) {
        const cand = base + UNK_PENALTY
        if (cand > bestScore[i + 1]!) {
          bestScore[i + 1] = cand
          bestPrev[i + 1] = i
          bestId[i + 1] = this.unkId
        }
      }
    }

    const ids: number[] = []
    for (let pos = n; pos > 0; pos = bestPrev[pos]!) {
      ids.push(bestId[pos]!)
    }
    ids.reverse()
    return ids
  }

  encode(text: string): { tokenIds: number[]; wordBoundaries: number[] } {
    // Return token IDs and word boundary positions
    const tokenIds: number[] = []
    const wordBoundaries: number[] = [] // Track which positions are word starts

    tokenIds.push(this.vocab.get('<s>')!) // Start token
    wordBoundaries.push(0) // <s> is a valid position

    const words = text
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 0)

    for (const word of words) {
      const wordStart = tokenIds.length
      const ids = this.encodeWord(word)
      if (ids.length === 0) continue
      wordBoundaries.push(wordStart)
      for (const id of ids) {
        tokenIds.push(id)
      }
    }

    tokenIds.push(this.vocab.get('</s>')!) // End token
    wordBoundaries.push(tokenIds.length - 1) // </s> is a valid position

    return { tokenIds, wordBoundaries }
  }

  decode(ids: number[]): string {
    return ids
      .map((id) => this.reverseVocab.get(id) || '<unk>')
      .join('')
      .replace(/▁/g, ' ')
      .trim()
  }

  pieceToId(piece: string): number {
    return this.vocab.get(piece) || 0
  }
}
