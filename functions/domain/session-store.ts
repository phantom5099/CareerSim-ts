/** 事件日志格式版本。 */
export const EVENT_VERSION = 1

/** 会话行及其缓存字段；`stage` 对 store 是不透明字符串。 */
export interface StoredSession {
  id: string
  stage: string
  createdAt: string
  updatedAt: string
  lastSeq: number
  lastTurnId: number
}

/** 已落库的事件；`kind` 对 store 是不透明的 JSON。 */
export interface StoredEvent {
  v: number
  seq: number
  at: string
  kind: unknown
}

/** 追加前期望达到的会话状态，用于比较并交换。 */
export interface ExpectedState {
  stage: string
  lastSeq: number
}

/** 一次追加请求；`v`、`seq`、`at` 由 store 分配。 */
export interface AppendBatch {
  expected: ExpectedState
  events: unknown[]
  lastTurnId: number
  nextStage?: string
}

export type StoreErrorCode = 'not_found' | 'conflict' | 'corrupt' | 'backend'

export class StoreError extends Error {
  readonly code: StoreErrorCode

  constructor(code: StoreErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'StoreError'
    this.code = code
  }

  static notFound(): StoreError {
    return new StoreError('not_found', 'session not found')
  }

  static conflict(): StoreError {
    return new StoreError('conflict', 'session state changed concurrently')
  }

  static corrupt(message: string): StoreError {
    return new StoreError('corrupt', `corrupt session: ${message}`)
  }

  static backend(message: string, cause?: unknown): StoreError {
    return new StoreError('backend', `store backend error: ${message}`, { cause })
  }
}

export interface SessionStore {
  /** 创建会话行并写入 seq = 0 的元事件。 */
  create(
    id: string,
    stage: string,
    meta: unknown,
  ): Promise<{ session: StoredSession; event: StoredEvent }>

  load(id: string): Promise<{ session: StoredSession; events: StoredEvent[] }>

  list(limit: number): Promise<StoredSession[]>

  delete(id: string): Promise<void>

  /** 以期望状态做 CAS 后追加一批事件；状态已被改写时返回 `Conflict`。 */
  append(id: string, batch: AppendBatch): Promise<StoredEvent[]>
}

interface Stored {
  session: StoredSession
  events: StoredEvent[]
}

/** 内存存储实现，语义与托管数据库实现保持一致。 */
export class MemorySessionStore implements SessionStore {
  private readonly sessions = new Map<string, Stored>()

  async create(
    id: string,
    stage: string,
    meta: unknown,
  ): Promise<{ session: StoredSession; event: StoredEvent }> {
    const now = new Date().toISOString()
    const event: StoredEvent = { v: EVENT_VERSION, seq: 0, at: now, kind: cloneJson(meta) }
    const session: StoredSession = {
      id,
      stage,
      createdAt: now,
      updatedAt: now,
      lastSeq: 0,
      lastTurnId: 0,
    }

    if (this.sessions.has(id)) {
      throw StoreError.conflict()
    }
    this.sessions.set(id, { session: { ...session }, events: [{ ...event }] })
    return { session, event }
  }

  async load(id: string): Promise<{ session: StoredSession; events: StoredEvent[] }> {
    const stored = this.sessions.get(id)
    if (!stored) {
      throw StoreError.notFound()
    }
    return {
      session: { ...stored.session },
      events: stored.events.map((event) => ({ ...event })),
    }
  }

  async list(limit: number): Promise<StoredSession[]> {
    return [...this.sessions.values()]
      .map((stored) => ({ ...stored.session }))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.id.localeCompare(a.id))
      .slice(0, limit)
  }

  async delete(id: string): Promise<void> {
    if (!this.sessions.delete(id)) {
      throw StoreError.notFound()
    }
  }

  async append(id: string, batch: AppendBatch): Promise<StoredEvent[]> {
    if (batch.events.length === 0) {
      return []
    }

    const stored = this.sessions.get(id)
    if (!stored) {
      throw StoreError.notFound()
    }
    if (
      stored.session.stage !== batch.expected.stage ||
      stored.session.lastSeq !== batch.expected.lastSeq
    ) {
      throw StoreError.conflict()
    }

    const now = new Date().toISOString()
    const firstSeq = stored.session.lastSeq + 1
    const events: StoredEvent[] = batch.events.map((kind, index) => ({
      v: EVENT_VERSION,
      seq: firstSeq + index,
      at: now,
      kind: cloneJson(kind),
    }))

    stored.session.lastSeq = firstSeq + events.length - 1
    stored.session.lastTurnId = Math.max(stored.session.lastTurnId, batch.lastTurnId)
    if (batch.nextStage !== undefined) {
      stored.session.stage = batch.nextStage
    }
    stored.session.updatedAt = now
    stored.events.push(...events.map((event) => ({ ...event })))
    return events
  }
}

function cloneJson<T>(value: T): T {
  return structuredClone(value)
}
