import type { LlmConfig } from '../config.ts'
import type { ChatRequest, ChatResponse, LlmClient, TokenUsage } from './llm.ts'
import { LlmError } from './llm.ts'
import type { Message } from './message.ts'

type FetchLike = typeof fetch

interface ChatCompletionPayload {
  choices?: Array<{
    message?: {
      content?: string | null
    }
  }>
  usage?: {
    prompt_tokens?: number
    completion_tokens?: number
  }
}

/** 基于 fetch 的 Chat Completions 适配层。 */
export class OpenAiCompatibleClient implements LlmClient {
  private readonly config: LlmConfig
  private readonly fetchImpl: FetchLike

  constructor(config: LlmConfig, fetchImpl: FetchLike = fetch) {
    this.config = config
    this.fetchImpl = fetchImpl
  }

  async complete(request: ChatRequest, signal?: AbortSignal): Promise<ChatResponse> {
    let response: Response
    try {
      response = await this.fetchImpl(`${this.config.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify({
          model: this.config.model,
          messages: request.messages.map(toWireMessage),
          temperature: this.config.temperature,
          max_tokens: this.config.maxTokens,
        }),
        signal,
      })
    } catch (error) {
      if (signal?.aborted || isAbortError(error)) {
        throw LlmError.cancelled()
      }
      throw LlmError.api('send request', error)
    }

    if (!response.ok) {
      const detail = await readErrorDetail(response)
      throw LlmError.api(detail ? `status ${response.status}: ${detail}` : `status ${response.status}`)
    }

    const payload = (await response.json().catch((error: unknown) => {
      throw LlmError.api('decode response', error)
    })) as ChatCompletionPayload

    const choice = payload.choices?.[0]
    if (!choice) {
      throw LlmError.api('response contains no choices')
    }

    return {
      content: choice.message?.content ?? '',
      usage: toUsage(payload.usage),
    }
  }
}

function toWireMessage(message: Message): Record<string, string> {
  return { role: message.role, content: message.content }
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}

async function readErrorDetail(response: Response): Promise<string> {
  const text = await response.text().catch(() => '')
  return text.trim().slice(0, 300)
}

function toUsage(usage: ChatCompletionPayload['usage']): TokenUsage | undefined {
  if (!usage) {
    return undefined
  }
  return {
    inputTokens: usage.prompt_tokens ?? 0,
    outputTokens: usage.completion_tokens ?? 0,
  }
}
