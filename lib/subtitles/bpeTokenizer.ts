// 简化的 BPE tokenizer 实现
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
    // 返回 token IDs 和词边界位置
    const tokenIds: number[] = []
    const wordBoundaries: number[] = [] // 记录哪些位置是词的开始
    
    tokenIds.push(this.vocab.get('<s>')!) // 开始标记
    wordBoundaries.push(0) // <s> 是有效位置
    
    const words = text.toLowerCase().split(/\s+/).filter(w => w.length > 0)
    
    for (const word of words) {
      const wordStart = tokenIds.length
      const wordWithPrefix = '▁' + word
      
      // 尝试直接查找完整单词
      if (this.vocab.has(wordWithPrefix)) {
        tokenIds.push(this.vocab.get(wordWithPrefix)!)
        wordBoundaries.push(wordStart) // 标记词的开始位置
      } else {
        // 否则按字符编码
        let isFirstChar = true
        for (const char of word) {
          const charWithPrefix = isFirstChar ? '▁' + char : char
          let id = this.vocab.get(charWithPrefix)
          
          if (id === undefined) {
            id = this.vocab.get(char) || this.vocab.get('<unk>')!
          }
          
          tokenIds.push(id)
          
          // 只标记第一个字符的位置为词边界
          if (isFirstChar) {
            wordBoundaries.push(tokenIds.length - 1)
            isFirstChar = false
          }
        }
      }
    }
    
    tokenIds.push(this.vocab.get('</s>')!) // 结束标记
    wordBoundaries.push(tokenIds.length - 1) // </s> 是有效位置
    
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
