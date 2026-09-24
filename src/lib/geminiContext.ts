import type { State, CategoryId, DayLog, Config } from '../types'

const CAT_ORDER: CategoryId[] = ['physical', 'study', 'diet', 'digital']

function pad(n: number): string {
  return n < 10 ? '0' + n : String(n)
}

export function todayKey(): string {
  const d = new Date()
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function addDays(dStr: string, n: number): string {
  const [y, m, d] = dStr.split('-').map(Number)
  const dt = new Date(y, m - 1, d)
  dt.setDate(dt.getDate() + n)
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`
}

function isFloorMet(dayLog: DayLog | undefined, catId: CategoryId, catConfig: Config['categories'][CategoryId]): boolean {
  if (!dayLog) return false
  const val = dayLog[catId]
  if (catConfig.type === 'multi') {
    if (!val || typeof val !== 'object') return false
    return Object.values(val as Record<string, boolean>).some(Boolean)
  }
  return Boolean(val)
}

function countCompleted(dayLog: DayLog | undefined, config: Config): number {
  if (!dayLog) return 0
  let met = 0
  for (const catId of CAT_ORDER) {
    if (isFloorMet(dayLog, catId, config.categories[catId])) met++
  }
  return met
}

export function generateGeminiContext(state: State): string {
  const today = todayKey()
  const todayLog = state.logs[today]
  const todayMetCount = countCompleted(todayLog, state.config)

  // 30-day rolling window calculation
  let showUp30 = 0
  const cat30Counts: Record<CategoryId, number> = {
    physical: 0,
    study: 0,
    diet: 0,
    digital: 0,
  }

  for (let i = 29; i >= 0; i--) {
    const d = addDays(today, -i)
    const dl = state.logs[d]
    let dayAny = false
    for (const catId of CAT_ORDER) {
      if (isFloorMet(dl, catId, state.config.categories[catId])) {
        cat30Counts[catId]++
        dayAny = true
      }
    }
    if (dayAny) showUp30++
  }

  const consistencyRate = Math.round((showUp30 / 30) * 100)

  // Check recovery mode: missed last 3 days before today
  let missedBeforeToday = 0
  for (let i = 1; i <= 3; i++) {
    const d = addDays(today, -i)
    if (countCompleted(state.logs[d], state.config) === 0) {
      missedBeforeToday++
    }
  }
  const isRecoveryMode = missedBeforeToday >= 3

  // Past 7 days history
  const recent7Days: string[] = []
  for (let i = 6; i >= 0; i--) {
    const d = addDays(today, -i)
    const met = countCompleted(state.logs[d], state.config)
    recent7Days.push(`${d}${d === today ? ' (Today)' : ''}: ${met}/4 floors met`)
  }

  // Category status breakdown
  const categoryStatus = CAT_ORDER.map((catId) => {
    const cat = state.config.categories[catId]
    const metToday = isFloorMet(todayLog, catId, cat)
    return `• ${cat.label.toUpperCase()}:
    - Status Today: ${metToday ? '✅ SECURED' : '⏳ PENDING'}
    - Minimum Floor: "${cat.floor}"
    - Ideal Target: "${cat.ideal}"
    - If-Then Plan: "${cat.ifthen}"
    - 30-Day Momentum: ${cat30Counts[catId]}/30 days (${Math.round((cat30Counts[catId] / 30) * 100)}%)`
  }).join('\n')

  return `Current Date: ${today}
System Status: ${isRecoveryMode ? '⚠️ RECOVERY PROTOCOL ACTIVE (User missed 3+ consecutive days. Coach user to achieve ONLY 1 floor today to restart momentum without overwhelm)' : '🟢 Normal Resilient Baseline'}
Rolling 30-Day Momentum: ${showUp30}/30 active days (${consistencyRate}% consistency rate)
Today's Floor Progress: ${todayMetCount}/4 floors completed

Past 7 Days History:
${recent7Days.map((l) => '  ' + l).join('\n')}

Category Details & Floor Rules:
${categoryStatus}
`
}
