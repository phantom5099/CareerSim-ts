/** OpenAI 兼容供应商的端点与凭据约定。 */
export const PROVIDERS = ['openai', 'deepseek', 'glm'] as const

export type ModelProvider = (typeof PROVIDERS)[number]

export interface ProviderDefaults {
  baseUrl: string
  apiKeyEnv: string
}

const DEFAULTS: Record<ModelProvider, ProviderDefaults> = {
  openai: {
    baseUrl: 'https://api.openai.com/v1',
    apiKeyEnv: 'OPENAI_API_KEY',
  },
  deepseek: {
    baseUrl: 'https://api.deepseek.com',
    apiKeyEnv: 'DEEPSEEK_API_KEY',
  },
  glm: {
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    apiKeyEnv: 'ZAI_API_KEY',
  },
}

export function isModelProvider(value: string): value is ModelProvider {
  return (PROVIDERS as readonly string[]).includes(value)
}

export function providerDefaults(provider: ModelProvider): ProviderDefaults {
  return DEFAULTS[provider]
}
