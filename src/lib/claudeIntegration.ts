import type { CategoryId, State } from '../types'

// Helpers to format dates and calculate stats for Claude briefings
function fmtDate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return y + '-' + m + '-' + day
}

function addDays(dateStr: string, delta: number): string {
  const parts = dateStr.split('-').map(Number)
  const dt = new Date(parts[0], parts[1] - 1, parts[2])
  dt.setDate(dt.getDate() + delta)
  return fmtDate(dt)
}

function todayKey(): string {
  return fmtDate(new Date())
}

const CAT_ORDER: CategoryId[] = ['physical', 'study', 'diet', 'english']

function isCategoryFloorMet(log: any, catId: CategoryId, catConfig: any): boolean {
  if (!log) return false
  const entry = log[catId]
  if (entry === undefined || entry === null) return false
  if (typeof entry === 'boolean') return entry
  if (typeof entry === 'object' && !Array.isArray(entry)) {
    if (catConfig && catConfig.floorLogic === 'all') {
      const items = catConfig.checklistItems || []
      if (items.length === 0) return false
      return items.every((it: any) => Boolean(entry[it.id]))
    }
    return Object.values(entry).some(Boolean)
  }
  return false
}

function countActiveFloors(log: any, config: any): number {
  if (!log || !config) return 0
  let n = 0
  for (const catId of CAT_ORDER) {
    if (isCategoryFloorMet(log, catId, config.categories[catId])) n++
  }
  return n
}

/**
 * Generate a clean, contextual Daily Briefing formatted for Claude.
 */
export function generateClaudeDailyBriefing(state: State, targetDate?: string): string {
  const today = todayKey()
  const date = targetDate || today
  const log = state.logs[date]
  const config = state.config

  // Calculate 30-day show-up count
  let showUp30 = 0
  for (let i = 0; i < 30; i++) {
    const d = addDays(date, -i)
    const dl = state.logs[d]
    if (countActiveFloors(dl, config) > 0) showUp30++
  }
  const consistencyRate = Math.round((showUp30 / 30) * 100)

  // Calculate 30-day count per category
  const catStats: Record<CategoryId, { count: number; rate: number }> = {
    physical: { count: 0, rate: 0 },
    study: { count: 0, rate: 0 },
    diet: { count: 0, rate: 0 },
    english: { count: 0, rate: 0 },
  }
  for (const catId of CAT_ORDER) {
    let metCount = 0
    for (let i = 0; i < 30; i++) {
      const d = addDays(date, -i)
      const dl = state.logs[d]
      if (isCategoryFloorMet(dl, catId, config.categories[catId])) metCount++
    }
    catStats[catId] = {
      count: metCount,
      rate: Math.round((metCount / 30) * 100),
    }
  }

  // Detect recovery mode (3 consecutive zero days immediately before today)
  let missedRecent = 0
  for (let i = 1; i <= 3; i++) {
    const d = addDays(date, -i)
    const dl = state.logs[d]
    if (countActiveFloors(dl, config) === 0) missedRecent++
  }
  const isRecovery = missedRecent === 3

  const todayCompletedCount = countActiveFloors(log, config)

  const categoryLines = CAT_ORDER.map((catId) => {
    const cat = config.categories[catId]
    const isMet = isCategoryFloorMet(log, catId, cat)
    const icon = catId === 'physical' ? '🧹' : catId === 'study' ? '📚' : catId === 'diet' ? '🍳' : '🗣'
    const status = isMet ? 'SECURED ✓' : 'PENDING ⏳'
    const box = isMet ? '[x]' : '[ ]'

    return `${box} **${icon} ${cat.label}:** ${status}
  • Non-negotiable Floor (Micro-Minimum): "${cat.floor}"
  • Ideal Target (High-Energy Ceiling): "${cat.ideal}"
  • 30-Day Rolling Momentum: ${catStats[catId].count}/30 days (${catStats[catId].rate}%)`
  }).join('\n\n')

  const ifThens = CAT_ORDER.map((catId) => {
    const cat = config.categories[catId]
    return `• **${cat.label}:** ${cat.ifthen}`
  }).join('\n')

  return `# 📊 The Floor — Daily Context & Progress for Claude
**Date:** ${date}${date === today ? ' (Today)' : ''}
**Rolling 30-Day Momentum:** ${showUp30}/30 active days (${consistencyRate}% consistency)
**System Mode:** ${isRecovery ? '⚠️ RECOVERY PROTOCOL (User was inactive for 3 days; only 1 floor required to restart rhythm)' : '🟢 Normal Baseline'}
**Daily Floor Status:** ${todayCompletedCount}/4 floors secured

---

### 1. Today's Floor Checklist
${categoryLines}

---

### 2. Active If-Then Behavioral Protocols (Resistance Rescues)
${ifThens}

---

### 3. Coaching Directives for Claude in This Session:
1. **Never measure me by unbroken streaks.** Streaks cause all-or-nothing thinking. Evaluate me solely on rolling momentum and showing up.
2. **Floors are 100% victories.** Acknowledge any completed floor as a complete win. Do NOT urge me to hit my high-energy ideal ceiling unless I explicitly ask.
3. **Low-Friction Nudge:** If I have pending floors, suggest the single lowest-friction, 2-minute action to lock one in right now.
${isRecovery ? '4. **RECOVERY MODE ACTIVE:** Do not overwhelm me with a 4-floor plan. Urge me to pick ONE micro-floor to break inertia today.\n' : ''}
`
}

/**
 * Generate a pre-configured System Prompt for Claude Custom Instructions or Projects.
 */
export function generateClaudeSystemPrompt(): string {
  return `You are "The Floor" Habit & Accountability Coach.
You help the user stay consistent without guilt, burnout, or fragile streak-chasing.

FOUNDATIONAL PHILOSOPHY:
1. THE FLOOR VS. THE CEILING:
   - Every habit has a "Floor" (the bare minimum non-negotiable baseline that takes <2-5 minutes, done even on worst or exhausted days) and an "Ideal" (the high-energy ceiling).
   - Hitting the Floor is a 100% win. Never minimize or demean a completed floor.
   - You protect the user from the all-or-nothing trap ("If I can't do a full 2-hour workout, I'll do nothing").

2. ANTI-GUILT & ROLLING BASELINE:
   - We do NOT use fragile unbroken streaks. When a streak breaks, people often abandon their habits entirely.
   - We measure a rolling 30-day momentum score (e.g., 22/30 days active).
   - If a day is missed, past wins remain permanent. You never say "streak reset to zero".

3. RECOVERY PROTOCOL:
   - If the user has been inactive for 3+ days, they enter Recovery Mode.
   - In Recovery Mode, their only objective is to hit ONE single floor. Lower friction to almost zero to reset momentum.

4. IF-THEN BEHAVIORAL RESCUE:
   - When the user expresses procrastination, fatigue, or resistance, point them to their pre-committed If-Then rules.

COACHING TONE:
Calm, direct, empathetic, stoic, and grounded. No toxic positivity or cheerleader clichés. Speak like an experienced mentor.`
}

/**
 * Generate a full Markdown Project Knowledge document for Claude Projects (claude.ai/projects).
 */
export function generateClaudeProjectKnowledge(state: State): string {
  const catOrder: CategoryId[] = ['physical', 'study', 'diet', 'english']
  const today = todayKey()

  let showUp30 = 0
  for (let i = 0; i < 30; i++) {
    const d = addDays(today, -i)
    const dl = state.logs[d]
    if (countActiveFloors(dl, state.config) > 0) showUp30++
  }

  const categoryDetails = catOrder.map((catId) => {
    const c = state.config.categories[catId]
    return `### ${c.label}
- **Floor (Minimum Baseline):** ${c.floor}
- **Ideal (High-Energy Ceiling):** ${c.ideal}
- **If-Then Rescue Rule:** ${c.ifthen}`
  }).join('\n\n')

  return `# The Floor — User Knowledge Base & Habit Rules
**Exported Date:** ${today}
**Current 30-Day Rolling Momentum:** ${showUp30}/30 days

## Overview
The user tracks daily consistency using "The Floor", an anti-guilt daily baseline app.
The user prioritizes non-zero days over perfectionism.

## User's 4 Configured Categories
${categoryDetails}

## Coaching Ground Rules for Claude
- Whenever the user checks in or asks for focus assistance, check what floors they have not yet met today.
- Encourage them to execute the easiest pending floor (under 2 minutes) immediately.
- If the user missed several days, do not lecture or ask for explanations; recommend the Recovery Protocol (1 floor today).
`
}

/**
 * Safe clipboard helper with legacy fallback.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch (e) {
    // continue to fallback
  }

  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    ta.style.left = '-9999px'
    ta.style.top = '-9999px'
    document.body.appendChild(ta)
    ta.focus()
    ta.select()
    const success = document.execCommand('copy')
    ta.remove()
    return success
  } catch (e) {
    return false
  }
}
