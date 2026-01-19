// Simplified BPE tokenizer implementation
export class BPETokenizer {
  private vocab: Map<string, number> = new Map()
  private reverseVocab: Map<number, string> = new Map()

  async load(vocabPath: string) {
    const response = await fetch(vocabPath)
    const text = await response.text()
    
    const lines = text.trim().split('\n')
    lines.forEach((line, index) => {
      const parts = line.split('\t')
      const piece = parts[0]
      this.vocab.set(piece, index)
      this.reverseVocab.set(index, piece)
    })
  }

  encode(text: string): { tokenIds: number[], wordBoundaries: number[] } {
    // Return token IDs and word boundary positions
    const tokenIds: number[] = []
    const wordBoundaries: number[] = [] // Track which positions are word starts

    tokenIds.push(this.vocab.get('<s>')!) // Start token
    wordBoundaries.push(0) // <s> is a valid position

    const words = text.toLowerCase().split(/\s+/).filter(w => w.length > 0)

    for (const word of words) {
      const wordStart = tokenIds.length
      const wordWithPrefix = '▁' + word

      // Try to find the complete word directly
      if (this.vocab.has(wordWithPrefix)) {
        tokenIds.push(this.vocab.get(wordWithPrefix)!)
        wordBoundaries.push(wordStart) // Mark word start position
      } else {
        // Otherwise encode character by character
        let isFirstChar = true
        for (const char of word) {
          const charWithPrefix = isFirstChar ? '▁' + char : char
          let id = this.vocab.get(charWithPrefix)

          if (id === undefined) {
            id = this.vocab.get(char) || this.vocab.get('<unk>')!
          }

          tokenIds.push(id)

          // Only mark first character position as word boundary
          if (isFirstChar) {
            wordBoundaries.push(tokenIds.length - 1)
            isFirstChar = false
          }
        }
      }
    }

    tokenIds.push(this.vocab.get('</s>')!) // End token
    wordBoundaries.push(tokenIds.length - 1) // </s> is a valid position

    return { tokenIds, wordBoundaries }
  }

  decode(ids: number[]): string {
    return ids
      .map(id => this.reverseVocab.get(id) || '<unk>')
      .join('')
      .replace(/▁/g, ' ')
      .trim()
  }

  pieceToId(piece: string): number {
    return this.vocab.get(piece) || 0
  }
}
