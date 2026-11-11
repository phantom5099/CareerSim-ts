/** 上下文投影使用的消息；不落盘，也不是会话的第二份快照。 */
export type Message =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string }

export function systemMessage(content: string): Message {
  return { role: 'system', content }
}

export function userMessage(content: string): Message {
  return { role: 'user', content }
}

export function assistantMessage(content: string): Message {
  return { role: 'assistant', content }
}
