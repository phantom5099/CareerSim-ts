import type { Role } from './role.ts'

export const STAGE_ALL = [
  'hr_screen',
  'exam',
  'tech_interview',
  'manager_interview',
  'hrbp_interview',
  'offer',
  'review',
] as const

export type Stage = (typeof STAGE_ALL)[number]

const STAGE_ROLE: Record<Stage, Role> = {
  hr_screen: 'hr_screener',
  exam: 'exam_author',
  tech_interview: 'tech_interviewer',
  manager_interview: 'hiring_manager',
  hrbp_interview: 'hrbp',
  offer: 'offer_negotiator',
  review: 'coach',
}

const NEXT_STAGE: Record<Stage, Stage | undefined> = {
  hr_screen: 'exam',
  exam: 'tech_interview',
  tech_interview: 'manager_interview',
  manager_interview: 'hrbp_interview',
  hrbp_interview: 'offer',
  offer: 'review',
  review: undefined,
}

export function stageRole(stage: Stage): Role {
  return STAGE_ROLE[stage]
}

export function nextStage(stage: Stage): Stage | undefined {
  return NEXT_STAGE[stage]
}

export function isStage(value: unknown): value is Stage {
  return typeof value === 'string' && (STAGE_ALL as readonly string[]).includes(value)
}

export function parseStage(value: string): Stage | undefined {
  return isStage(value) ? value : undefined
}
