export type CoachKind = 'coach' | 'reflection' | 'adjust'

export interface CoachCategoryInput {
  id: string
  label: string
  floor: string
  ifthen: string
  count30: number
}

export interface CoachSummary {
  mode: 'normal' | 'recovery'
  showUpCount: number
  todayCount: number
  daysTracked: number
  categories: CoachCategoryInput[]
}

export interface CoachResult {
  kind?: CoachKind
  // coach
  message?: string
  microAction?: string
  focusCategoryId?: string
  // reflection
  headline?: string
  insights?: string[]
  weakestCategoryId?: string
  encouragement?: string
  // adjust
  categoryId?: string
  floor?: string
  ifthen?: string
  rationale?: string
}

export async function fetchCoach(
  kind: CoachKind,
  summary: CoachSummary,
  categoryId?: string,
): Promise<CoachResult> {
  const res = await fetch('/api/coach', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ kind, summary, categoryId }),
  })
  if (!res.ok) {
    let msg = 'The coach is unavailable right now.'
    try {
      const data = (await res.json()) as { error?: string }
      if (data && data.error) msg = data.error
    } catch {
      // ignore parse failure, keep default message
    }
    throw new Error(msg)
  }
  return (await res.json()) as CoachResult
}
