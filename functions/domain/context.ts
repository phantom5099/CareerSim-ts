import type { ChatRequest } from './llm.ts'
import { assistantMessage, systemMessage, userMessage } from './message.ts'
import type { Message } from './message.ts'
import type { Session } from './session.ts'
import { stageRole } from './stage.ts'
import { systemPrompt } from './role.ts'

export interface BuildOptions {
  /** 首版不支持 token 预算；传值时直接报错，不做静默截断。 */
  maxPromptTokens?: number
}

export class ContextError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ContextError'
  }
}

export type ContextBuilder = (session: Session) => Promise<ChatRequest> | ChatRequest

/** 从事件日志投影模型上下文。首版注入完整历史。 */
export function buildContext(session: Session, options: BuildOptions = {}): ChatRequest {
  if (options.maxPromptTokens !== undefined) {
    throw new ContextError('max_prompt_tokens is not supported')
  }

  const messages: Message[] = [systemMessage(systemPrompt(stageRole(session.stage)))]
  for (const event of session.events) {
    switch (event.type) {
      case 'user_message':
        messages.push(userMessage(event.content))
        break
      case 'assistant_message':
        messages.push(assistantMessage(event.content))
        break
      case 'session_meta':
      case 'turn_started':
      case 'turn_ended':
      case 'stage_completed':
        break
    }
  }

  return { messages }
}
