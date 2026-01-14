import * as ort from 'onnxruntime-web/wasm'
import { BPETokenizer } from './bpeTokenizer'

export interface TimedToken {
  start: number // 开始时间（秒）
  end: number // 结束时间（秒）
  text: string // 原始文本（小写，无标点）
}

export interface AnnotatedToken extends TimedToken {
  casedText: string // 转换大小写后的文本
  punctuation: string // 要添加的标点符号
  caseType: 'LOWER' | 'UPPER' | 'CAP' | 'MIX'
  punctType: 'NONE' | 'COMMA' | 'PERIOD' | 'QUESTION'
}

// 标点和大小写映射
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
  private maxTokensPerWindow = 180 // 为 <s> </s> 等留出空间
  private overlap = 30 // token 级别的重叠

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
   * 设置窗口参数（基于 token 数量，而非词数）
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
   * 使用双指针匹配将 BPE tokens 映射回原始单词
   */
  private matchBPEToWords(
    words: string[],
    bpeTokenIds: number[],
    validIds: number[],
  ): Map<number, number[]> {
    // 返回：wordIndex -> [bpeTokenIndices]
    const wordToBPE = new Map<number, number[]>()

    if (!this.tokenizer) throw new Error('Tokenizer not loaded')

    let wordIdx = 0
    let bpeIdx = 0

    // 跳过开始标记 <s>
    if (bpeTokenIds[0] === this.tokenizer.pieceToId('<s>')) {
      bpeIdx = 1
    }

    while (wordIdx < words.length && bpeIdx < bpeTokenIds.length) {
      // 跳过结束标记
      if (bpeTokenIds[bpeIdx] === this.tokenizer.pieceToId('</s>')) {
        break
      }

      const bpeIndices: number[] = []
      const currentWord = words[wordIdx].toLowerCase()

      // 累积 BPE tokens 直到匹配当前单词
      let accumulatedText = ''

      while (bpeIdx < bpeTokenIds.length) {
        const bpeToken = this.tokenizer.decode([bpeTokenIds[bpeIdx]])
        accumulatedText += bpeToken

        // 只记录 valid 的 token 索引
        if (validIds[bpeIdx] === 1) {
          bpeIndices.push(bpeIdx)
        }

        bpeIdx++

        // 检查是否匹配当前单词（移除空格和 ▁ 符号）
        const normalized = accumulatedText.replace(/[▁\s]/g, '').toLowerCase()
        if (normalized === currentWord) {
          break
        }

        // 防止无限循环
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
   * 将预测结果映射回原始 tokens（简化版：直接索引映射）
   */
  private mapPredictionsToTokens(
    tokens: TimedToken[],
    _wordToBPE: Map<number, number[]>,
    casePred: number[],
    punctPred: number[],
  ): AnnotatedToken[] {
    return tokens.map((token, wordIdx) => {
      // 直接使用词索引获取预测（模型输出已经去掉了 <s> 和 </s>）
      // 预测结果的索引直接对应词的索引
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
   * 主函数：为带时间戳的 tokens 添加标点和大小写（支持自动分段）
   */
  async annotatePunctuation(tokens: TimedToken[]): Promise<AnnotatedToken[]> {
    if (!this.session || !this.tokenizer) {
      throw new Error('Model not loaded. Call load() first.')
    }

    // 先整体 tokenize 一次，判断是否需要分段
    const fullText = tokens.map((t) => t.text).join(' ')
    const { tokenIds } = this.tokenizer.encode(fullText)

    // console.log(
    //   `📊 Total tokens: ${tokens.length} words → ${tokenIds.length} BPE tokens`,
    // )

    // 如果 BPE tokens 数量在限制内，直接处理
    if (tokenIds.length <= this.maxTokensPerWindow) {
      return this.annotatePunctuationSingleWindow(tokens)
    }

    // 否则使用基于 token 长度的滑动窗口
    return this.annotatePunctuationWithTokenBasedWindow(tokens)
  }

  /**
   * 基于 BPE token 长度的智能分窗口
   */
  private async annotatePunctuationWithTokenBasedWindow(
    tokens: TimedToken[],
  ): Promise<AnnotatedToken[]> {
    if (!this.tokenizer) throw new Error('Tokenizer not loaded')

    // console.log(
    //   `🪟 Using token-based sliding window (max=${this.maxTokensPerWindow} tokens, overlap=${this.overlap})`,
    // )

    const results: AnnotatedToken[] = []
    let wordStart = 0
    let windowCount = 0

    while (wordStart < tokens.length) {
      windowCount++

      // 从当前位置开始，累积词直到达到 token 限制
      let wordEnd = wordStart
      let currentTokenCount = 0

      while (
        wordEnd < tokens.length &&
        currentTokenCount < this.maxTokensPerWindow
      ) {
        // 试探性 tokenize
        const testText = tokens
          .slice(wordStart, wordEnd + 1)
          .map((t) => t.text)
          .join(' ')
        const { tokenIds } = this.tokenizer.encode(testText)

        if (tokenIds.length > this.maxTokensPerWindow) {
          // 超过限制，回退一个词
          break
        }

        currentTokenCount = tokenIds.length
        wordEnd++
      }

      // 确保至少处理一些词
      if (wordEnd === wordStart) {
        wordEnd = wordStart + 1
      }

      const windowTokens = tokens.slice(wordStart, wordEnd)

      // console.log(
      //   `🪟 Window ${windowCount}: words ${wordStart}-${wordEnd} (${windowTokens.length} words, ~${currentTokenCount} tokens)`,
      // )

      // 处理当前窗口
      const windowResults = await this.annotatePunctuationSingleWindow(
        windowTokens,
      )

      // 处理重叠：只保留非重叠部分
      const overlapWords = Math.floor(this.overlap / 2) // 估算词级别的重叠
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

      // 移动窗口（考虑重叠）
      wordStart = wordEnd - overlapWords * 2

      // 防止无限循环
      if (wordStart <= wordEnd - windowTokens.length) {
        wordStart = wordEnd
      }

      await new Promise((resolve) => setTimeout(resolve, 0)) // 让出事件循环
    }

    // console.log(
    //   `✅ Processed ${results.length} tokens in ${windowCount} windows`,
    // )

    return results
  }

  /**
   * 处理单个窗口（原有逻辑）
   */
  private async annotatePunctuationSingleWindow(
    tokens: TimedToken[],
  ): Promise<AnnotatedToken[]> {
    if (!this.session || !this.tokenizer) {
      throw new Error('Model not loaded. Call load() first.')
    }

    // 1. 提取文本并 tokenize
    const text = tokens.map((t) => t.text).join(' ')
    const words = tokens.map((t) => t.text)

    const { tokenIds, wordBoundaries } = this.tokenizer.encode(text)

    // 2. 创建 valid_ids (只标记词边界位置)
    const validIds = new Array(this.maxSeqLength).fill(0)

    // 标记词边界位置为 valid
    for (const boundary of wordBoundaries) {
      if (boundary < this.maxSeqLength) {
        validIds[boundary] = 1
      }
    }

    // const validCount = wordBoundaries.length

    // console.log('Tokenization info:', {
    //   text,
    //   words,
    //   tokenIds: tokenIds.slice(0, 20),
    //   tokenIdsLength: tokenIds.length,
    //   wordBoundaries,
    //   validIds: validIds.slice(0, 20),
    //   validCount,
    // })

    // 3. 截断到最大序列长度（重要！）
    const truncatedTokenIds = tokenIds.slice(0, this.maxSeqLength)
    const truncatedValidIds = validIds.slice(0, this.maxSeqLength)

    // 重新计算 validCount
    const actualValidCount = truncatedValidIds.filter((v) => v === 1).length

    // 4. Padding
    const paddedTokenIds = [...truncatedTokenIds]
    while (paddedTokenIds.length < this.maxSeqLength) {
      paddedTokenIds.push(0)
    }

    const paddedValidIds = [...truncatedValidIds]
    while (paddedValidIds.length < this.maxSeqLength) {
      paddedValidIds.push(0)
    }

    // 5. 准备模型输入
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

    // 6. 运行模型
    const feeds: Record<string, ort.Tensor> = {}
    feeds[this.session.inputNames[0]] = inputTokenIds
    feeds[this.session.inputNames[1]] = inputValidIds
    feeds[this.session.inputNames[2]] = labelLens

    const results = await this.session.run(feeds)

    // 7. 解析输出
    const outputNames = this.session.outputNames
    const caseLogits = results[outputNames[0]].data as Float32Array
    const punctLogits = results[outputNames[1]].data as Float32Array

    const caseClasses = 4
    const punctClasses = 4
    const numPredictions = caseLogits.length / caseClasses

    // 8. 获取预测结果（argmax）
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

    // 9. 双指针匹配：BPE tokens -> 原始单词
    const wordToBPE = this.matchBPEToWords(words, paddedTokenIds, validIds)

    // console.log('Model predictions:', {
    //   numPredictions,
    //   wordCount: words.length,
    //   validCount: actualValidCount,
    //   tokenIdsLength: tokenIds.length,
    //   truncated: tokenIds.length > this.maxSeqLength,
    //   casePred: casePred.slice(0, 15),
    //   punctPred: punctPred.slice(0, 15),
    //   caseMapping: words.slice(0, 10).map((w, i) => ({
    //     word: w,
    //     caseType: CASE_TYPE_MAP[casePred[i]] || 'UNDEFINED',
    //     punctType: PUNCT_TYPE_MAP[punctPred[i]] || 'UNDEFINED',
    //   })),
    //   caseLogitsSize: caseLogits.length,
    //   punctLogitsSize: punctLogits.length,
    // })

    if (tokenIds.length > this.maxSeqLength) {
      console.warn(
        `⚠️ Input text is too long! Truncated from ${tokenIds.length} to ${this.maxSeqLength} tokens. Some words may not be processed.`,
      )
    }

    // 10. 映射预测结果到原始 tokens（简化：直接用索引）
    return this.mapPredictionsToTokens(tokens, wordToBPE, casePred, punctPred)
  }

  /**
   * 辅助函数：将标注结果渲染为带标点的文本
   */
  renderAnnotatedTokens(tokens: AnnotatedToken[]): string {
    return tokens.map((t) => t.casedText + t.punctuation).join(' ')
  }
}
