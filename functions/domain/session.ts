import type { TokenUsage } from './llm.ts'
import type { SessionStore, StoredEvent, StoredSession } from './session-store.ts'
import { EVENT_VERSION, StoreError } from './session-store.ts'
import type { Stage } from './stage.ts'
import { isStage, nextStage } from './stage.ts'

export type SessionId = string

export type TurnId = number

export type UserMessageSource = 'user' | 'system'

export type TurnEndReason = 'done' | 'max_steps' | 'interrupted' | 'error'

export interface SessionMetaEvent {
  type: 'session_meta'
  sessionId: SessionId
  stage: Stage
}

export interface TurnStartedEvent {
  type: 'turn_started'
  turnId: TurnId
}

export interface UserMessageEvent {
  type: 'user_message'
  turnId: TurnId
  content: string
  source: UserMessageSource
}

export interface AssistantMessageEvent {
  type: 'assistant_message'
  turnId: TurnId
  content: string
  usage?: TokenUsage
}

export interface TurnEndedEvent {
  type: 'turn_ended'
  turnId: TurnId
  reason: TurnEndReason
  steps: number
  error?: string
}

export interface StageCompletedEvent {
  type: 'stage_completed'
  turnId: TurnId
  stage: Stage
}

export type SessionEventKind =
  | SessionMetaEvent
  | TurnStartedEvent
  | UserMessageEvent
  | AssistantMessageEvent
  | TurnEndedEvent
  | StageCompletedEvent

export type SessionEvent = { v: number; seq: number; at: string } & SessionEventKind

export interface Session {
  id: SessionId
  stage: Stage
  events: SessionEvent[]
  createdAt: string
  updatedAt: string
  lastSeq: number
  lastTurnId: TurnId
}

export interface SessionSummary {
  id: SessionId
  stage: Stage
  createdAt: string
  updatedAt: string
  lastSeq: number
  lastTurnId: TurnId
}

export interface StageCompletion {
  turnId: TurnId
  /** 推进后的阶段。 */
  stage: Stage
}

export type SessionErrorCode =
  | 'not_found'
  | 'no_next_stage'
  | 'conflict'
  | 'corrupt'
  | 'invalid_event'
  | 'backend'

export class SessionError extends Error {
  readonly code: SessionErrorCode

  constructor(code: SessionErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'SessionError'
    this.code = code
  }

  static notFound(): SessionError {
    return new SessionError('not_found', 'session not found')
  }

  static noNextStage(): SessionError {
    return new SessionError('no_next_stage', 'current stage has no next stage')
  }

  static corrupt(message: string): SessionError {
    return new SessionError('corrupt', `corrupt session: ${message}`)
  }

  static invalidEvent(message: string): SessionError {
    return new SessionError('invalid_event', `invalid event batch: ${message}`)
  }

  static backend(message: string, cause?: unknown): SessionError {
    return new SessionError('backend', `store backend error: ${message}`, { cause })
  }
}

export function eventTurnId(event: SessionEventKind): TurnId | undefined {
  switch (event.type) {
    case 'session_meta':
      return undefined
    case 'turn_started':
    case 'user_message':
    case 'assistant_message':
    case 'turn_ended':
    case 'stage_completed':
      return event.turnId
  }
}

/** 最后一个回合只有 `turn_started`、没有 `turn_ended` 时返回它的编号。 */
export function danglingTurn(session: Session): TurnId | undefined {
  if (session.lastTurnId === 0) {
    return undefined
  }

  let started = false
  let ended = false
  for (const event of session.events) {
    if (eventTurnId(event) !== session.lastTurnId) {
      continue
    }
    if (event.type === 'turn_started') {
      started = true
    } else if (event.type === 'turn_ended') {
      ended = true
    }
  }

  return started && !ended ? session.lastTurnId : undefined
}

/** 把已落库的事件折叠进内存视图。 */
function absorb(session: Session, events: SessionEvent[]): void {
  for (const event of events) {
    if (event.type === 'stage_completed') {
      const next = nextStage(event.stage)
      if (next) {
        session.stage = next
      }
    }
    const turnId = eventTurnId(event)
    if (turnId !== undefined) {
      session.lastTurnId = Math.max(session.lastTurnId, turnId)
    }
    session.lastSeq = Math.max(session.lastSeq, event.seq)
    session.events.push(event)
  }
}

const TURN_END_REASONS: readonly TurnEndReason[] = [
  'done',
  'max_steps',
  'interrupted',
  'error',
]

const MESSAGE_SOURCES: readonly UserMessageSource[] = ['user', 'system']

/** 校验一个追加批次；返回 `stage_completed` 推进后的阶段。 */
function validateBatch(current: Stage, events: SessionEventKind[]): Stage | undefined {
  let next: Stage | undefined
  events.forEach((event, index) => {
    if (event.type === 'session_meta') {
      throw SessionError.invalidEvent('session_meta is only written by create')
    }
    if (event.type !== 'stage_completed') {
      return
    }
    if (index + 1 !== events.length) {
      throw SessionError.invalidEvent('stage_completed must be the last event')
    }
    if (event.stage !== current) {
      throw SessionError.invalidEvent(
        `stage_completed for ${event.stage} but current stage is ${current}`,
      )
    }
    const following = nextStage(event.stage)
    if (!following) {
      throw SessionError.invalidEvent(`stage ${event.stage} has no next stage`)
    }
    next = following
  })
  return next
}

function maxTurnId(events: SessionEventKind[]): TurnId | undefined {
  let max: TurnId | undefined
  for (const event of events) {
    const turnId = eventTurnId(event)
    if (turnId !== undefined && (max === undefined || turnId > max)) {
      max = turnId
    }
  }
  return max
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readString(value: Record<string, unknown>, field: string, seq: number): string {
  const fieldValue = value[field]
  if (typeof fieldValue !== 'string') {
    throw SessionError.corrupt(`invalid event payload at seq ${seq}: ${field} must be a string`)
  }
  return fieldValue
}

function readNumber(value: Record<string, unknown>, field: string, seq: number): number {
  const fieldValue = value[field]
  if (typeof fieldValue !== 'number' || !Number.isFinite(fieldValue)) {
    throw SessionError.corrupt(`invalid event payload at seq ${seq}: ${field} must be a number`)
  }
  return fieldValue
}

function readStage(value: Record<string, unknown>, seq: number): Stage {
  const stage = value.stage
  if (!isStage(stage)) {
    throw SessionError.corrupt(`invalid event payload at seq ${seq}: unknown stage`)
  }
  return stage
}

function readUsage(value: unknown, seq: number): TokenUsage | undefined {
  if (value === undefined) {
    return undefined
  }
  if (!isRecord(value)) {
    throw SessionError.corrupt(`invalid event payload at seq ${seq}: usage must be an object`)
  }
  return {
    inputTokens: readNumber(value, 'inputTokens', seq),
    outputTokens: readNumber(value, 'outputTokens', seq),
  }
}

function parseEventKind(value: unknown, seq: number): SessionEventKind {
  if (!isRecord(value)) {
    throw SessionError.corrupt(`invalid event payload at seq ${seq}`)
  }

  switch (value.type) {
    case 'session_meta':
      return {
        type: 'session_meta',
        sessionId: readString(value, 'sessionId', seq),
        stage: readStage(value, seq),
      }
    case 'turn_started':
      return { type: 'turn_started', turnId: readNumber(value, 'turnId', seq) }
    case 'user_message': {
      const source = value.source
      if (!MESSAGE_SOURCES.includes(source as UserMessageSource)) {
        throw SessionError.corrupt(
          `invalid event payload at seq ${seq}: unknown user message source`,
        )
      }
      return {
        type: 'user_message',
        turnId: readNumber(value, 'turnId', seq),
        content: readString(value, 'content', seq),
        source: source as UserMessageSource,
      }
    }
    case 'assistant_message': {
      const usage = readUsage(value.usage, seq)
      const event: AssistantMessageEvent = {
        type: 'assistant_message',
        turnId: readNumber(value, 'turnId', seq),
        content: readString(value, 'content', seq),
      }
      if (usage) {
        event.usage = usage
      }
      return event
    }
    case 'turn_ended': {
      const reason = value.reason
      if (!TURN_END_REASONS.includes(reason as TurnEndReason)) {
        throw SessionError.corrupt(`invalid event payload at seq ${seq}: unknown turn end reason`)
      }
      const event: TurnEndedEvent = {
        type: 'turn_ended',
        turnId: readNumber(value, 'turnId', seq),
        reason: reason as TurnEndReason,
        steps: readNumber(value, 'steps', seq),
      }
      if (value.error !== undefined) {
        event.error = readString(value, 'error', seq)
      }
      return event
    }
    case 'stage_completed':
      return {
        type: 'stage_completed',
        turnId: readNumber(value, 'turnId', seq),
        stage: readStage(value, seq),
      }
    default:
      throw SessionError.corrupt(`invalid event payload at seq ${seq}: unknown event type`)
  }
}

function decodeEvent(stored: StoredEvent): SessionEvent {
  if (stored.v !== EVENT_VERSION) {
    throw SessionError.corrupt(
      `unsupported event version ${stored.v} at seq ${stored.seq}`,
    )
  }
  return {
    ...parseEventKind(stored.kind, stored.seq),
    v: stored.v,
    seq: stored.seq,
    at: stored.at,
  }
}

function summaryFromRow(row: StoredSession): SessionSummary {
  const stage = isStage(row.stage) ? row.stage : undefined
  if (!stage) {
    throw SessionError.corrupt(`unknown stage: ${row.stage}`)
  }
  return {
    id: row.id,
    stage,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    lastSeq: row.lastSeq,
    lastTurnId: row.lastTurnId,
  }
}

/** 折叠落库行与事件，并校验缓存字段和事件日志一致。 */
function foldSession(row: StoredSession, storedEvents: StoredEvent[]): Session {
  const events = storedEvents.map(decodeEvent)
  const first = events[0]
  if (!first) {
    throw SessionError.corrupt('event log is empty')
  }
  if (first.type !== 'session_meta' || first.seq !== 0) {
    throw SessionError.corrupt('first event is not session_meta at seq 0')
  }
  if (first.sessionId !== row.id) {
    throw SessionError.corrupt('session_meta has a different session id')
  }

  let stage = first.stage
  let maxTurn = 0
  let previousSeq: number | undefined
  for (const event of events) {
    if (previousSeq !== undefined && event.seq !== previousSeq + 1) {
      throw SessionError.corrupt(`event seq is not contiguous at ${event.seq}`)
    }
    previousSeq = event.seq

    if (event.type === 'stage_completed') {
      if (event.stage !== stage) {
        throw SessionError.corrupt(
          `stage_completed for ${event.stage} while the log is at ${stage}`,
        )
      }
      const next = nextStage(event.stage)
      if (!next) {
        throw SessionError.corrupt(`stage_completed after final stage ${event.stage}`)
      }
      stage = next
    }

    const turnId = eventTurnId(event)
    if (turnId !== undefined) {
      maxTurn = Math.max(maxTurn, turnId)
    }
  }

  const actualLastSeq = previousSeq ?? 0
  if (row.lastSeq !== actualLastSeq) {
    throw SessionError.corrupt(
      `last_seq is ${row.lastSeq} but the event log ends at ${actualLastSeq}`,
    )
  }
  if (row.lastTurnId !== maxTurn) {
    throw SessionError.corrupt(
      `last_turn_id is ${row.lastTurnId} but the event log ends at ${maxTurn}`,
    )
  }
  if (row.stage !== stage) {
    throw SessionError.corrupt(`row stage is ${row.stage} but the event log folds to ${stage}`)
  }

  return {
    id: row.id,
    stage,
    events,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    lastSeq: row.lastSeq,
    lastTurnId: row.lastTurnId,
  }
}

function fromStoreError(error: unknown): SessionError {
  if (!(error instanceof StoreError)) {
    return SessionError.backend('store operation failed', error)
  }
  switch (error.code) {
    case 'not_found':
      return SessionError.notFound()
    case 'conflict':
      return new SessionError('conflict', 'session state changed concurrently', {
        cause: error,
      })
    case 'corrupt':
      return SessionError.corrupt(error.message.replace(/^corrupt session: /, ''))
    case 'backend':
      return SessionError.backend(error.message, error)
  }
}

/**
 * 会话事件的持久化入口。
 *
 * 回合事件如何追加、半截回合如何修复、阶段完成如何与回合事件同批写入，
 * 都由实现决定；`AgentLoop` 只依赖本接口。
 */
export interface SessionService {
  create(stage: Stage): Promise<Session>

  load(id: SessionId): Promise<Session>

  /** 列出最近的会话摘要。 */
  list(limit: number): Promise<SessionSummary[]>

  /** 删除会话及其事件日志。 */
  delete(id: SessionId): Promise<void>

  /** 追加一批事件并把落库结果折叠进内存视图。 */
  append(session: Session, events: SessionEventKind[]): Promise<void>

  /** 修复上一进程遗留的半截回合，然后写入新回合的 `turn_started`。 */
  startTurn(session: Session): Promise<TurnId>

  recordUserMessage(session: Session, turnId: TurnId, content: string): Promise<void>

  recordAssistantMessage(
    session: Session,
    turnId: TurnId,
    content: string,
    usage?: TokenUsage,
  ): Promise<void>

  endTurn(
    session: Session,
    turnId: TurnId,
    reason: TurnEndReason,
    steps: number,
    error?: string,
  ): Promise<void>

  /** 结束当前阶段并推进到下一阶段；`review` 没有下一阶段，返回 `NoNextStage` 且不写事件。 */
  finishStage(session: Session): Promise<StageCompletion>
}

const SESSION_ID_RETRIES = 3

/** 基于 `SessionStore` 的会话服务实现。 */
export class StoreSessionService implements SessionService {
  private readonly store: SessionStore

  constructor(store: SessionStore) {
    this.store = store
  }

  async create(stage: Stage): Promise<Session> {
    for (let attempt = 0; attempt < SESSION_ID_RETRIES; attempt += 1) {
      const id = crypto.randomUUID()
      const meta: SessionEventKind = { type: 'session_meta', sessionId: id, stage }
      try {
        const { session, event } = await this.store.create(id, stage, meta)
        return foldSession(session, [event])
      } catch (error) {
        if (error instanceof StoreError && error.code === 'conflict') {
          continue
        }
        throw fromStoreError(error)
      }
    }

    throw SessionError.backend('could not allocate a unique session id')
  }

  async load(id: SessionId): Promise<Session> {
    const { session, events } = await this.withStore(() => this.store.load(id))
    return foldSession(session, events)
  }

  async list(limit: number): Promise<SessionSummary[]> {
    const rows = await this.withStore(() => this.store.list(limit))
    return rows.map(summaryFromRow)
  }

  async delete(id: SessionId): Promise<void> {
    await this.withStore(() => this.store.delete(id))
  }

  async append(session: Session, events: SessionEventKind[]): Promise<void> {
    if (events.length === 0) {
      return
    }

    const nextStageValue = validateBatch(session.stage, events)
    const lastTurnId = maxTurnId(events) ?? 0
    const stored = await this.withStore(() =>
      this.store.append(session.id, {
        expected: { stage: session.stage, lastSeq: session.lastSeq },
        events,
        lastTurnId,
        nextStage: nextStageValue,
      }),
    )

    absorb(session, stored.map(decodeEvent))
  }

  async startTurn(session: Session): Promise<TurnId> {
    await this.repairDangling(session)

    const turnId = session.lastTurnId + 1
    await this.append(session, [{ type: 'turn_started', turnId }])
    return turnId
  }

  async recordUserMessage(
    session: Session,
    turnId: TurnId,
    content: string,
  ): Promise<void> {
    await this.append(session, [
      { type: 'user_message', turnId, content, source: 'user' },
    ])
  }

  async recordAssistantMessage(
    session: Session,
    turnId: TurnId,
    content: string,
    usage?: TokenUsage,
  ): Promise<void> {
    const event: AssistantMessageEvent = { type: 'assistant_message', turnId, content }
    if (usage) {
      event.usage = usage
    }
    await this.append(session, [event])
  }

  async endTurn(
    session: Session,
    turnId: TurnId,
    reason: TurnEndReason,
    steps: number,
    error?: string,
  ): Promise<void> {
    const event: TurnEndedEvent = { type: 'turn_ended', turnId, reason, steps }
    if (error !== undefined) {
      event.error = error
    }
    await this.append(session, [event])
  }

  async finishStage(session: Session): Promise<StageCompletion> {
    await this.repairDangling(session)

    const from = session.stage
    const next = nextStage(from)
    if (!next) {
      throw SessionError.noNextStage()
    }
    const turnId = session.lastTurnId + 1

    await this.append(session, [
      { type: 'turn_started', turnId },
      { type: 'turn_ended', turnId, reason: 'done', steps: 0 },
      { type: 'stage_completed', turnId, stage: from },
    ])

    return { turnId, stage: next }
  }

  /** 最后一个回合缺少 `turn_ended` 时补写 `interrupted` 终态。 */
  private async repairDangling(session: Session): Promise<void> {
    const turnId = danglingTurn(session)
    if (turnId === undefined) {
      return
    }

    await this.append(session, [
      { type: 'turn_ended', turnId, reason: 'interrupted', steps: 0 },
    ])
    console.info(`repaired dangling turn session_id=${session.id} turn_id=${turnId}`)
  }

  private async withStore<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation()
    } catch (error) {
      throw fromStoreError(error)
    }
  }
}
