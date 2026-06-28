import { describe, expect, it } from 'vitest'
import { openai } from './openai'
import evalData from './eval-data.json'

const META_COMMENTARY_PATTERN =
  /[（(]注[：:]|原文第?\d+行|原文[本的]?(缺失|不完整|未提供)|此处(待补|保留原编号|为格式化|原文)|(需|请)提供(对应|完整)原文|按(规则|要求)(保留|补齐|输出)|根据(上下文|原文)(推测|补全|补充)|\[此处待补|(或[可意]译为|也可以翻译为|直译为)|(结合语境|结合上下文).{0,10}(更可能|似可|应)|保留(字面意?译|原文或意译)|此行为空白|无文本|该行为空/

function hasMetaCommentary(text: string): boolean {
  return META_COMMENTARY_PATTERN.test(text)
}

const providers = [
  {
    name: 'openai',
    envKey: 'VITE_OPENAI_API_KEY',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4.1-mini',
  },
  {
    name: 'deepseek',
    envKey: 'VITE_DEEPSEEK_API_KEY',
    baseUrl: 'https://api.deepseek.com',
    model: 'deepseek-chat',
  },
]

for (const provider of providers) {
  const apiKey = import.meta.env[provider.envKey]

  describe.skipIf(!apiKey)(`translate/${provider.name} eval`, () => {
    const translator = openai({
      apiKey,
      baseUrl: provider.baseUrl,
      model: provider.model,
    })

    it('should not produce meta-commentary for previously bad inputs', async () => {
      const failures: { source: string; output: string }[] = []

      for (const source of evalData.bad_sources) {
        const [result] = await translator.translate([source], 'zh-Hans')
        if (hasMetaCommentary(result)) {
          failures.push({ source: source.slice(0, 80), output: result })
        }
      }

      for (const f of failures) {
        console.log('[FAIL]', f.source, '=>', f.output)
      }
      expect(
        failures.length,
        `${failures.length}/${evalData.bad_sources.length} inputs still produce meta-commentary`,
      ).toBe(0)
    }, 120_000)

    it('should still produce valid translations for known good inputs', async () => {
      const failures: { source: string; output: string }[] = []

      for (const source of evalData.good_sources.slice(0, 20)) {
        const [result] = await translator.translate([source], 'zh-Hans')
        if (!result || result.trim().length === 0) {
          failures.push({ source: source.slice(0, 80), output: result })
        }
        if (hasMetaCommentary(result)) {
          failures.push({
            source: source.slice(0, 80),
            output: `[META] ${result}`,
          })
        }
      }

      for (const f of failures) {
        console.log('[FAIL]', f.source, '=>', f.output)
      }
      expect(
        failures.length,
        `${failures.length}/20 good inputs regressed`,
      ).toBe(0)
    }, 120_000)
  })
}
