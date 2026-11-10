import { ROLE_PROMPTS } from './role-prompts.ts'

export const ROLES = [
  'hr_screener',
  'exam_author',
  'tech_interviewer',
  'hiring_manager',
  'hrbp',
  'offer_negotiator',
  'coach',
] as const

export type Role = (typeof ROLES)[number]

export function systemPrompt(role: Role): string {
  return ROLE_PROMPTS[role]
}
