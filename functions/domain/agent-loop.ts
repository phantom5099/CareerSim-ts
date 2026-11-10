import type { ContextBuilder } from './context.ts'
import { buildContext } from './context.ts'
import { errorChain } from './errors.ts'
import type { ChatResponse, LlmClient } from './llm.ts'
import { LlmError } from './llm.ts'
import type {
  Session,
  SessionId,
  SessionService,
  StageCompletion,
  TurnEndReason,
  TurnId,
} from './session.ts'
import { stageRole } from './stage.ts'

/** 循环参数；模型连接与采样参数由 `LlmClient` 在构造时固定。 */
export interface LoopConfig {
  maxSteps: number
}

export interface TurnResult {
  turnId: TurnId
  reason: TurnEndReason
  steps: number
  output: string
  error?: string
}

export class LoopError extends Error {
  readonly code: 'session_busy'

  constructor(code: 'session_busy', message: string) {
    super(message)
    this.name = 'LoopError'
    this.code = code
  }
}

export interface AgentLoopOptions {
  llm: LlmClient
  sessions: SessionService
  config: LoopConfig
  context?: ContextBuilder
}

export class AgentLoop {
  private readonly llm: LlmClient
  private readonly sessions: SessionService
  private readonly config: LoopConfig
  private readonly context: ContextBuilder
  /** 进程内的回合互斥；单活部署假设下足够，多实例前必须重新设计。 */
  private readonly active = new Set<SessionId>()

  constructor(options: AgentLoopOptions) {
    this.llm = options.llm
    this.sessions = options.sessions
    this.config = options.config
    this.context = options.context ?? ((session) => buildContext(session))
  }

  async runTurn(id: SessionId, input: string, signal?: AbortSignal): Promise<TurnResult> {
    this.acquire(id)

    try {
      const session = await this.sessions.load(id)
      const turnId = await this.sessions.startTurn(session)
      console.info(
        `turn started session_id=${id} turn_id=${turnId} stage=${session.stage} role=${stageRole(session.stage)}`,
      )

      if (signal?.aborted) {
        return await this.finishTurn(session, turnId, 'interrupted', 0, '')
      }

      await this.sessions.recordUserMessage(session, turnId, input)

      let steps = 0
      let output = ''

      for (let step = 0; step < this.config.maxSteps; step += 1) {
        if (signal?.aborted) {
          return await this.finishTurn(session, turnId, 'interrupted', steps, output)
        }

        console.debug(
          `requesting model session_id=${id} turn_id=${turnId} step=${steps + 1} role=${stageRole(session.stage)}`,
        )

        let request
        try {
          request = await this.context(session)
        } catch (error) {
          return await this.finishTurn(
            session,
            turnId,
            'error',
            steps,
            output,
            errorChain(error),
          )
        }

        let response: ChatResponse
        try {
          response = await this.llm.complete(request, signal)
        } catch (error) {
          if (error instanceof LlmError && error.kind === 'cancelled') {
            return await this.finishTurn(session, turnId, 'interrupted', steps, output)
          }
          if (signal?.aborted) {
            return await this.finishTurn(session, turnId, 'interrupted', steps, output)
          }
          return await this.finishTurn(
            session,
            turnId,
            'error',
            steps,
            output,
            errorChain(error),
          )
        }

        steps += 1
        output = response.content

        await this.sessions.recordAssistantMessage(session, turnId, response.content, response.usage)

        if (response.content.trim().length === 0) {
          return await this.finishTurn(
            session,
            turnId,
            'error',
            steps,
            output,
            'empty response',
          )
        }

        return await this.finishTurn(session, turnId, 'done', steps, output)
      }

      return await this.finishTurn(session, turnId, 'max_steps', steps, output)
    } finally {
      this.active.delete(id)
    }
  }

  /** 结束当前阶段并推进到下一阶段；`review` 没有下一阶段，返回 `NoNextStage`。 */
  async finishStage(id: SessionId): Promise<StageCompletion> {
    this.acquire(id)

    try {
      const session = await this.sessions.load(id)
      const from = session.stage
      const completion = await this.sessions.finishStage(session)

      console.info(
        `stage completed session_id=${id} turn_id=${completion.turnId} from=${from} to=${completion.stage}`,
      )

      return completion
    } finally {
      this.active.delete(id)
    }
  }

  private acquire(id: SessionId): void {
    if (this.active.has(id)) {
      throw new LoopError('session_busy', 'session is busy')
    }
    this.active.add(id)
  }

  private async finishTurn(
    session: Session,
    turnId: TurnId,
    reason: TurnEndReason,
    steps: number,
    output: string,
    error?: string,
  ): Promise<TurnResult> {
    await this.sessions.endTurn(session, turnId, reason, steps, error)

    console.info(
      `turn ended session_id=${session.id} turn_id=${turnId} step=${steps} role=${stageRole(session.stage)} reason=${reason}`,
    )

    return { turnId, reason, steps, output, error }
  }
}
