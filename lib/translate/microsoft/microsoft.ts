// copy from https://www.npmjs.com/package/@lmk123/free-microsoft-translator
/**
 * Authentication headers configuration
 * Used for private subscription keys or custom tokens
 */
export interface AuthenticationHeaders {
  /** Azure subscription key */
  'Ocp-Apim-Subscription-Key'?: string
  /** JWT token */
  Authorization?: string
}

/**
 * Detected language information
 */
export interface DetectedLanguage {
  /** Language code */
  language: string
  /** Confidence score (0-1) */
  score: number
}

/**
 * Microsoft Translator API optional parameters
 * Reference: https://learn.microsoft.com/en-us/azure/ai-services/translator/text-translation/reference/v3/translate#optional-parameters
 */
export interface MicrosoftTranslateOptions {
  /** Text type: 'plain' (plain text) or 'html' (HTML text), default 'plain' */
  textType?: 'plain' | 'html'
  /** Category (domain), default 'general' */
  category?: string
  /** Profanity handling method */
  profanityAction?: 'NoAction' | 'Marked' | 'Deleted'
  /** Profanity marker */
  profanityMarker?: 'Asterisk' | 'Tag'
  /** Include alignment information */
  includeAlignment?: boolean
  /** Include sentence length */
  includeSentenceLength?: boolean
  /** Suggested source language (to improve auto-detection accuracy) */
  suggestedFrom?: string
  /** Source script */
  fromScript?: string
  /** Target script */
  toScript?: string
  /** Allow fallback */
  allowFallback?: boolean
}

/**
 * Single translation result
 */
export interface Translation {
  /** Translated text */
  text: string
  /** Target language code */
  to: string
}

/**
 * Single text translation result
 */
export interface TextTranslationResult {
  /** Detected source language (only present for auto-detection) */
  detectedLanguage?: DetectedLanguage
  /** Translation results list (can translate to multiple target languages) */
  translations: Translation[]
}

/**
 * Translation result (array form)
 */
export type TranslationResult = TextTranslationResult[]

/**
 * Translation options interface
 */
export interface TranslateOptions {
  /** Custom User-Agent */
  userAgent?: string
  /** Source language code (undefined or 'auto-detect' means auto-detect) */
  from?: string | null
  /** Custom authentication headers (for paid service) */
  authenticationHeaders?: AuthenticationHeaders
  /** Microsoft Translator API optional parameters */
  translateOptions?: MicrosoftTranslateOptions
}

const AUTH_URL = 'https://edge.microsoft.com/translate/auth'
const TRANSLATE_API_URL = 'https://api.cognitive.microsofttranslator.com/translate'
const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/113.0.0.0 Safari/537.36 Edg/113.0.1774.35'

interface TokenInfo {
  token: string
  tokenExpiresAt: number
}

let cachedToken: TokenInfo | undefined
let tokenPromise: Promise<TokenInfo> | undefined

/**
 * Get authentication token
 * @param userAgent - Custom User-Agent
 * @returns Token information
 */
async function getAuthToken(userAgent?: string): Promise<TokenInfo> {
  try {
    const response = await fetch(AUTH_URL, {
      headers: {
        'User-Agent': userAgent || DEFAULT_USER_AGENT,
      },
    })

    if (!response.ok) {
      throw new Error(`Failed to fetch auth token: ${response.status} ${response.statusText}`)
    }

    const tokenString = await response.text()

    // Parse JWT token payload
    const payload = JSON.parse(atob(tokenString.split('.')[1]))

    cachedToken = {
      token: tokenString,
      // Token valid for 10 minutes
      tokenExpiresAt: payload.exp * 1000,
    }

    return cachedToken
  } catch (error) {
    console.error('Failed to get authentication token')
    throw error
  }
}

/**
 * Check if token is expired or about to expire (within 1 minute)
 * @returns Whether token needs to be refreshed
 */
function isTokenExpired(): boolean {
  return !cachedToken || (cachedToken.tokenExpiresAt || 0) - Date.now() < 60000
}

interface TranslateRequestBody {
  Text: string
}

/**
 * Translate text
 * @param text - Text to translate (string or string array)
 * @param to - Target language code (string or string array), default 'en'
 * @param options - Translation options
 * @returns Translation result
 */
export async function translate(
  text: string | string[],
  to: string | string[],
  options?: TranslateOptions,
): Promise<TranslationResult> {
  const { from, authenticationHeaders, userAgent, translateOptions } = options || {}

  const targetLanguages = Array.isArray(to) ? to : [to]
  const sourceTexts = Array.isArray(text) ? text : [text]

  // Get token if no custom authentication headers provided
  if (!authenticationHeaders) {
    if (!tokenPromise) {
      tokenPromise = getAuthToken(userAgent)
    }
    await tokenPromise

    if (isTokenExpired()) {
      tokenPromise = getAuthToken(userAgent)
      await tokenPromise
    }
  }

  // Build request body
  const requestBody: TranslateRequestBody[] = sourceTexts.map((t) => ({ Text: t }))

  // Build query parameters
  const searchParams = new URLSearchParams([
    ...targetLanguages.map((lang) => ['to', lang] as [string, string]),
    ['api-version', '3.0'],
  ])

  if (from) {
    searchParams.append('from', from)
  }

  // Add optional translation parameters
  if (translateOptions) {
    Object.entries(translateOptions).forEach(([key, value]) => {
      if (value != null && value !== '') {
        searchParams.append(key, String(value))
      }
    })
  }

  // Build request headers
  const headers: Record<string, string> = {
    'User-Agent': userAgent || DEFAULT_USER_AGENT,
    'Content-Type': 'application/json',
  }

  if (authenticationHeaders) {
    Object.assign(headers, authenticationHeaders)
  } else if (cachedToken) {
    headers.Authorization = 'Bearer ' + cachedToken.token
  }

  try {
    const response = await fetch(`${TRANSLATE_API_URL}?${searchParams}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(requestBody),
    })

    if (!response.ok) {
      let errorMessage = ` Status: ${response.status} (${response.statusText})`
      try {
        const errorResponse = await response.json()
        errorMessage += `\nResponse: ${JSON.stringify(errorResponse, null, 2)}`
      } catch {
        // Ignore JSON parsing error
      }
      throw new Error(`Translation failed${errorMessage}`)
    }

    return await response.json()
  } catch (error: any) {
    if (error.message?.startsWith('Translation failed')) {
      throw error
    }
    throw new Error(`Translation failed: ${error.message}`)
  }
}
