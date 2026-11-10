import type { Message } from './message.ts'

/** 供应商无关的模型请求；模型名与采样参数由客户端构造时固定。 */
export interface ChatRequest {
  messages: Message[]
}

export interface TokenUsage {
  inputTokens: number
  outputTokens: number
}

export interface ChatResponse {
  content: string
  usage?: TokenUsage
}

export type LlmErrorKind = 'cancelled' | 'api'

export class LlmError extends Error {
  readonly kind: LlmErrorKind

  constructor(kind: LlmErrorKind, message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'LlmError'
    this.kind = kind
  }

  static cancelled(): LlmError {
    return new LlmError('cancelled', 'request cancelled')
  }

  static api(message: string, cause?: unknown): LlmError {
    return new LlmError('api', `model request failed: ${message}`, { cause })
  }
}

export interface LlmClient {
  complete(request: ChatRequest, signal?: AbortSignal): Promise<ChatResponse>
}
