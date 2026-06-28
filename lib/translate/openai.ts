import { langs, ToLang } from './lang'
import { Translator } from './types'

const newModels = [
  'gpt-5-nano',
  'gpt-5',
  'gpt-5-mini-2025-08-07',
  'gpt-5-mini',
  'gpt-5-nano-2025-08-07',
  'o1-2024-12-17',
  'o1',
  'o3-mini',
  'o3-mini-2025-01-31',
  'o1-pro-2025-03-19',
  'o1-pro',
  'o3-2025-04-16',
  'o4-mini-2025-04-16',
  'o3',
  'o4-mini',
  'gpt-4.1-2025-04-14',
  'gpt-4.1',
  'gpt-4.1-mini-2025-04-14',
  'gpt-4.1-mini',
  'gpt-4.1-nano-2025-04-14',
  'gpt-4.1-nano',
  'o3-pro',
  'gpt-4o-realtime-preview-2025-06-03',
  'gpt-4o-audio-preview-2025-06-03',
  'o3-pro-2025-06-10',
  'o4-mini-deep-research',
  'o3-deep-research',
  'o3-deep-research-2025-06-26',
  'o4-mini-deep-research-2025-06-26',
  'gpt-5-chat-latest',
  'gpt-5-2025-08-07',
]

export const DefaultLLMSystemPrompt = `
You are a subtitle translator. You receive numbered lines and return their translations in {{Target Language}}, nothing else.

Rules:
- Output ONLY translated lines in the format [N] translated text.
- Every line MUST contain a translation in {{Target Language}}. If unsure, provide your best guess. Never output meta-text about the source or the translation process.
- If a line is a sentence fragment, translate it as-is. Do NOT complete, merge, or rearrange lines.
- If the text contains HTML tags, place them appropriately in the translation.
- Keep proper nouns, code, and untranslatable content in their original form.
- Input has {{Segment Count}} lines from [1] to [{{Segment Count}}]. Output MUST have exactly {{Segment Count}} lines with matching numbers.
`.trim()

export const DefaultLLMUserPrompt = `
Translate to {{Target Language}}:

{{Text to Translate}}
`.trim()

export const DefaultLLMPrompt = `
${DefaultLLMSystemPrompt}

${DefaultLLMUserPrompt}
`.trim()

export interface OpenAIConfig {
  apiKey?: string
  baseUrl?: string
  model?: string
  prompt?: string
}

export async function testOpenAIConnection(options: OpenAIConfig): Promise<void> {
  if (!options.apiKey) {
    throw new Error('API Key is not set')
  }
  if (!options.baseUrl) {
    throw new Error('Base URL is not set')
  }
  await sendOfCompletion(
    'You are a translator.',
    'Translate to English: hello',
    options,
  )
}

export function openai(options: OpenAIConfig): Translator {
  return {
    name: 'openai',
    translate: async (text, to) => {
      if (text.length === 0) {
        return []
      }
      if (!options.apiKey) {
        throw new Error('OpenAI API key is not set')
      }
      // Format input with line numbers: [1] text1\n[2] text2\n...
      const numberedInput = text
        .map((t, i) => `[${i + 1}] ${t}`)
        .join('\n')
      const langName = langs[to] ?? to
      const replacePlaceholders = (tmpl: string) =>
        tmpl
          .replaceAll('{{Target Language}}', langName)
          .replaceAll('{{Segment Count}}', String(text.length))
          .replaceAll('{{Text to Translate}}', numberedInput)

      const customPrompt = options.prompt
      const systemPrompt = replacePlaceholders(
        customPrompt ?? DefaultLLMSystemPrompt,
      )
      const userPrompt = replacePlaceholders(
        customPrompt ? numberedInput : DefaultLLMUserPrompt,
      )

      const maxRetries = 3
      let lastError: Error | null = null

      for (let attempt = 0; attempt < maxRetries; attempt++) {
        let r: string
        if (
          options.baseUrl === 'https://api.openai.com/v1' &&
          newModels.includes(options.model ?? 'gpt-4.1-mini')
        ) {
          r = await sendOfResponse(systemPrompt, userPrompt, options)
        } else {
          r = await sendOfCompletion(systemPrompt, userPrompt, options)
        }
        // Parse numbered output: [1] translation1\n[2] translation2\n...
        try {
          const results = parseNumberedOutput(r, text.length)
          return results
        } catch (e) {
          lastError = e as Error
        }
      }

      throw lastError
    },
  }
}

function parseNumberedOutput(output: string, expectedCount: number): string[] {
  const results: string[] = new Array(expectedCount).fill('')
  const lines = output.split('\n')

  for (const line of lines) {
    const match = line.match(/^\[(\d+)\]\s*(.*)$/)
    if (match) {
      const index = parseInt(match[1], 10) - 1
      if (index >= 0 && index < expectedCount) {
        results[index] = match[2].trim()
      }
    }
  }

  // Check if all slots are filled
  const missingIndices = results
    .map((r, i) => (r === '' ? i + 1 : null))
    .filter((i) => i !== null)

  if (missingIndices.length > 0) {
    throw new Error(
      `Translation result count does not match input text count. Missing: [${missingIndices.join(', ')}]`,
    )
  }

  return results
}

async function sendOfResponse(
  systemPrompt: string,
  userPrompt: string,
  options: OpenAIConfig,
) {
  const r = await fetch(`${options.baseUrl}/responses`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${options.apiKey}`,
    },
    body: JSON.stringify({
      model: options.model,
      instructions: systemPrompt,
      input: userPrompt,
    }),
  })
  if (!r.ok) {
    const body = await r.text()
    throw new Error(`${r.status} ${body}`.trim())
  }
  const data = await r.json()
  return data.output[0].content[0].text as string
}

async function sendOfCompletion(
  systemPrompt: string,
  userPrompt: string,
  options: OpenAIConfig,
) {
  const r = await fetch(`${options.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${options.apiKey}`,
    },
    body: JSON.stringify({
      model: options.model,
      messages: [
        {
          role: 'system',
          content: systemPrompt,
        },
        {
          role: 'user',
          content: userPrompt,
        },
      ],
    }),
  })
  if (!r.ok) {
    const body = await r.text()
    throw new Error(`${r.status} ${body}`.trim())
  }
  const data = await r.json()
  return data.choices[0].message.content as string
}
