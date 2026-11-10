import { isModelProvider, providerDefaults } from './domain/provider.ts'
import type { ModelProvider } from './domain/provider.ts'

export type EnvReader = (name: string) => string | undefined

/** 模型连接与采样参数；错误信息只包含变量名或非法值，不包含 API Key。 */
export interface LlmConfig {
  provider: ModelProvider
  model: string
  baseUrl: string
  apiKey: string
  temperature: number
  maxTokens: number
}

export interface AppConfig {
  llm: LlmConfig
  maxSteps: number
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ConfigError'
  }
}

export function loadConfig(env: EnvReader): AppConfig {
  const providerName = required(env, 'MODEL_PROVIDER')
  if (!isModelProvider(providerName)) {
    throw new ConfigError(`invalid value for \`MODEL_PROVIDER\`: ${providerName}`)
  }

  const defaults = providerDefaults(providerName)
  const model = required(env, 'MODEL')
  const baseUrl = optional(env, 'MODEL_BASE_URL') ?? defaults.baseUrl
  const apiKey = required(env, defaults.apiKeyEnv)

  const temperature = optionalNumber(env, 'MODEL_TEMPERATURE', 0.7)
  if (!Number.isFinite(temperature) || temperature < 0 || temperature > 2) {
    throw new ConfigError(`invalid value for \`MODEL_TEMPERATURE\`: ${temperature}`)
  }

  const maxTokens = optionalNumber(env, 'MODEL_MAX_TOKENS', 2048)
  if (!Number.isInteger(maxTokens) || maxTokens <= 0) {
    throw new ConfigError(`invalid value for \`MODEL_MAX_TOKENS\`: ${maxTokens}`)
  }

  const maxSteps = optionalNumber(env, 'MAX_STEPS', 8)
  if (!Number.isInteger(maxSteps) || maxSteps <= 0) {
    throw new ConfigError(`invalid value for \`MAX_STEPS\`: ${maxSteps}`)
  }

  return {
    llm: {
      provider: providerName,
      model,
      baseUrl,
      apiKey,
      temperature,
      maxTokens,
    },
    maxSteps,
  }
}

function required(env: EnvReader, name: string): string {
  const value = env(name)?.trim()
  if (!value) {
    throw new ConfigError(`missing required environment variable \`${name}\``)
  }
  return value
}

function optional(env: EnvReader, name: string): string | undefined {
  const value = env(name)?.trim()
  return value ? value : undefined
}

function optionalNumber(env: EnvReader, name: string, fallback: number): number {
  const value = optional(env, name)
  if (value === undefined) {
    return fallback
  }
  const parsed = Number(value)
  if (Number.isNaN(parsed)) {
    throw new ConfigError(`invalid value for \`${name}\`: ${value}`)
  }
  return parsed
}
