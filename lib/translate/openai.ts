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

export const DefaultLLMPrompt = `
You are a professional native translator specializing in {{Target Language}}. Your task is to translate the provided text fluently into {{Target Language}}.

## Translation Rules

1. Output ONLY the translated text. Do not include any explanations or additional content (such as "Here is the translation:", "Translation:", etc.)

2. The translated output must maintain the exact same number of paragraphs and formatting as the original text

3. If the text contains HTML tags, consider where the tags should be placed in the translation while maintaining fluency

4. For content that should not be translated (such as proper nouns, code, etc.), keep the original text

## Context Awareness

Document Metadata:

Title: {{Document Title}}

## Input/Output Format Example

### Input Example:

Paragraph A

%%

Paragraph B

%%

Paragraph C

%%

Paragraph D

### Output Example:

Translation A

%%

Translation B

%%

Translation C

%%

Translation D

## CRITICAL REQUIREMENT
- Input contains EXACTLY 18 segments separated by %%
- Output MUST contain EXACTLY 18 segments separated by %%
- Count verification: Before outputting, verify that you have 18 segments

## Step-by-step process:
1. Count the input segments (should be 18)
2. Translate each segment one by one
3. Verify output has 18 segments before returning
4. If count doesn't match, review and fix

Translate to {{Target Language}}:

{{Text to Translate}}
`.trim()

interface OpenAIConfig {
  apiKey?: string
  baseUrl?: string
  model?: string
  prompt?: string
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
      const Splitor = '\n\n%%\n\n'
      const prompt = (options.prompt ?? DefaultLLMPrompt)
        .replaceAll('{{Target Language}}', langs[to] ?? to)
        .replaceAll('{{Text to Translate}}', text.join(Splitor))
      let r: string
      if (
        options.baseUrl === 'https://api.openai.com/v1' &&
        newModels.includes(options.model ?? 'gpt-4o-mini')
      ) {
        r = await sendOfResponse(prompt, options)
      } else {
        r = await sendOfCompletion(prompt, options)
      }
      const results = r.split(Splitor).filter((it) => it.trim() !== '')
      if (results.length !== text.length) {
        throw new Error(
          'Translation result count does not match input text count',
        )
      }
      return results
    },
  }
}

async function sendOfResponse(text: string, options: OpenAIConfig) {
  const r = await fetch(`${options.baseUrl}/responses`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${options.apiKey}`,
    },
    body: JSON.stringify({
      model: options.model,
      input: text,
    }),
  })
  if (!r.ok) {
    throw new Error(await r.text())
  }
  const data = await r.json()
  return data.output[0].content[0].text as string
}

async function sendOfCompletion(text: string, options: OpenAIConfig) {
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
          role: 'user',
          content: text,
        },
      ],
    }),
  })
  if (!r.ok) {
    throw new Error(await r.text())
  }
  const data = await r.json()
  return data.choices[0].message.content as string
}
