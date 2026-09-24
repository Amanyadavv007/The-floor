import { useCallback, useEffect, useRef, useState } from 'react'
import confetti from 'canvas-confetti'
import { createAccountOnCloud, cloudAvailable, loginToCloud, pullFromCloud, pushToCloud, SYNC_BACKEND_URL, type AccountSession } from './lib/cloud'
import type { CatConfig, CategoryId, Config, DayLog, State } from './types'
import { ClaudeModal } from './components/ClaudeModal'
import { GeminiDrawer } from './components/GeminiDrawer'
import { generateClaudeDailyBriefing, copyToClipboard } from './lib/claudeIntegration'

const ALL_FOUR_CELEBRATED_KEY = 'thefloor:all_four_celebrated'

const STOIC_SPARKS = [
  {
    quote: 'A low floor means you cannot fail. Win the floor today, build the ceiling tomorrow.',
    author: 'Baseline Principle',
  },
  {
    quote: 'Action creates motivation, not the other way around. Two minutes counts.',
    author: 'Momentum Rule',
  },
  {
    quote: 'Never drop to zero. A rolling 30-day window turns consistency into identity.',
    author: 'The Floor Philosophy',
  },
  {
    quote: 'Physical space protects mental space. A messy room shouldn’t wreck your study day.',
    author: 'Boundary Principle',
  },
  {
    quote: 'Environment beats willpower every single time. Move the phone before sitting down.',
    author: 'Friction Rule',
  },
  {
    quote: 'Streaks create fragility. Floors create resilience.',
    author: 'Recovery Mindset',
  },
  {
    quote: 'Consistency is not about perfection. It is about never abandoning your baseline.',
    author: 'Discipline Code',
  },
]

const CAT_META: Record<CategoryId, { icon: string; kicker: string }> = {
  physical: { icon: '◫', kicker: 'Environment' },
  study: { icon: '⚡', kicker: 'Deep Work' },
  diet: { icon: '◆', kicker: 'Nutrition' },
  digital: { icon: '⦾', kicker: 'Focus Shield' },
}

function triggerAllFourConfetti(): void {
  try {
    // Primary celebration burst with theme colors (sage green #6FA8A6, warm gold #E2A550, cream #EDEAE2)
    confetti({
      particleCount: 85,
      spread: 70,
      origin: { y: 0.6 },
      colors: ['#6FA8A6', '#E2A550', '#EDEAE2', '#529490', '#F3C978'],
    })

    // Side cannons for full celebration effect
    setTimeout(function () {
      confetti({
        particleCount: 45,
        angle: 60,
        spread: 55,
        origin: { x: 0, y: 0.65 },
        colors: ['#6FA8A6', '#E2A550', '#EDEAE2'],
      })
      confetti({
        particleCount: 45,
        angle: 120,
        spread: 55,
        origin: { x: 1, y: 0.65 },
        colors: ['#6FA8A6', '#E2A550', '#EDEAE2'],
      })
    }, 180)
  } catch (e) {
    console.error('confetti failed', e)
  }
}

// ---------- date helpers ----------
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
function parseDateKey(dateStr: string): Date {
  const parts = dateStr.split('-').map(Number)
  return new Date(parts[0], parts[1] - 1, parts[2])
}
function todayKey(): string {
  return fmtDate(new Date())
}
function displayDate(dateKey?: string): string {
  const d = dateKey ? parseDateKey(dateKey) : new Date()
  return d.toLocaleDateString('en-US', { weekday: 'short', day: 'numeric', month: 'short' })
}

// ---------- types (shared with the cloud sync layer) ----------

// ---------- default config ----------
const CAT_ORDER: CategoryId[] = ['physical', 'study', 'diet', 'digital']
function defaultConfig(): Config {
  return {
    startDate: todayKey(),
    categories: {
      physical: {
        label: 'Physical space & hygiene',
        ideal: 'Bed made, laundry cycle kept up, shower and basic grooming done.',
        floor: 'Any ONE of the three below. That alone is a win.',
        ifthen: "If I get back to my room and want to just collapse, I reset the bed for 30 seconds first — that's the whole rule.",
        type: 'multi',
        items: [
          { id: 'bed', label: 'Bed reset (30 sec)' },
          { id: 'clothes', label: 'Clean clothes on' },
          { id: 'hygiene', label: 'Basic hygiene done' },
        ],
      },
      study: {
        label: 'Study / deep work',
        ideal: 'A real focused block on DSA or JS.',
        floor: 'Open the book or the IDE and attempt ONE problem. Two minutes counts.',
        ifthen: "If I open reels before I've opened my notes, I close it and do one problem attempt first — doesn't matter which subject.",
        type: 'single',
      },
      diet: {
        label: 'Diet',
        ideal: 'A full balanced day, protein around 75-80g.',
        floor: 'Get ONE protein source in — egg, milk, or a shake. Any time of day.',
        ifthen: "If I'm about to skip a PG meal or grab junk instead, I get one protein source in first, before anything else.",
        type: 'single',
      },
      digital: {
        label: 'Digital / reels control',
        ideal: 'A full block with the phone out of reach entirely.',
        floor: 'One environment action before you sit down to study — phone in another room, or blocker on.',
        ifthen: 'If I sit down to study, my phone goes in another room or on airplane mode before I open my notes — not after.',
        type: 'single',
      },
    },
  }
}

const HOW_IT_WORKS: string[] = [
  "Floors, not ideals — every category has a version you genuinely cannot fail. That's what gets logged as a win, not the full ideal.",
  'No streaks — progress is shown as X/30, a rolling window. One bad day doesn’t erase two good weeks.',
  'Recovery mode — after 3 days of zero floors, the ask drops even lower instead of piling on.',
  'Environment over willpower — the digital floor is an action you take (move the phone), not a feeling you’re asked to resist.',
  'If-then plans — decide your response to the hard moment now, below, before it’s midnight and you’re tired.',
  'Physical space is tracked on its own — a bad study day shouldn’t wreck your room too, and a messy room shouldn’t wreck your study day.',
]

// ---------- storage (localStorage-backed; survives closing the browser) ----------
const storage = {
  async get(key: string): Promise<{ value: string } | null> {
    try {
      const value = window.localStorage.getItem('thefloor:' + key)
      return value === null ? null : { value: value }
    } catch (e) {
      return null
    }
  },
  async set(key: string, value: string): Promise<void> {
    window.localStorage.setItem('thefloor:' + key, value)
  },
}
async function loadState(): Promise<State> {
  let config: Config | null = null
  let logs: Record<string, DayLog> | null = null
  try {
    const res = await storage.get('config')
    config = res ? (JSON.parse(res.value) as Config) : null
  } catch (e) {
    config = null
  }
  if (!config) {
    config = defaultConfig()
    try {
      await storage.set('config', JSON.stringify(config))
    } catch (e) {
      console.error('save config failed', e)
    }
  }
  try {
    const res = await storage.get('logs')
    logs = res ? (JSON.parse(res.value) as Record<string, DayLog>) : null
  } catch (e) {
    logs = null
  }
  if (!logs) {
    logs = {}
  }
  if (config && logs) {
    const datesWithActivity = Object.keys(logs).filter((d) => {
      const dl = logs ? logs[d] : undefined
      return dl && config && countCompleted(dl, config) > 0
    })
    if (datesWithActivity.length > 0) {
      datesWithActivity.sort()
      if (!config.startDate || datesWithActivity[0] < config.startDate) {
        config.startDate = datesWithActivity[0]
        void storage.set('config', JSON.stringify(config))
      }
    }
  }
  return { config, logs }
}
async function persistLogs(logs: Record<string, DayLog>): Promise<void> {
  try {
    await storage.set('logs', JSON.stringify(logs))
  } catch (e) {
    console.error('save logs failed', e)
  }
}
async function persistConfig(config: Config): Promise<void> {
  try {
    await storage.set('config', JSON.stringify(config))
  } catch (e) {
    console.error('save config failed', e)
  }
}

// ---------- cloud sync (account number + password, any device) ----------
const ACCOUNT_KEY = 'account'

function readSession(): AccountSession | null {
  try {
    const raw = window.localStorage.getItem('thefloor:' + ACCOUNT_KEY)
    return raw ? (JSON.parse(raw) as AccountSession) : null
  } catch (e) {
    return null
  }
}
function saveSession(s: AccountSession): void {
  try {
    window.localStorage.setItem('thefloor:' + ACCOUNT_KEY, JSON.stringify(s))
  } catch (e) {
    console.error('save account failed', e)
  }
}
function clearSession(): void {
  try {
    window.localStorage.removeItem('thefloor:' + ACCOUNT_KEY)
  } catch (e) {}
}

// Merge rule, per category field (day × category, and × item for multi):
// a tick that exists on either side stays ticked — unchecking on one device
// only counts if no other device still has it checked. Devices converge
// instead of overwriting each other.
function mergeLogs(local: Record<string, DayLog>, cloud: Record<string, DayLog>): Record<string, DayLog> {
  const merged: Record<string, DayLog> = { ...cloud }
  for (const day of Object.keys(local)) {
    const l = local[day] || {}
    const c = cloud[day] || {}
    const dayLog: DayLog = { ...c }
    const keys = new Set([...Object.keys(l), ...Object.keys(c)])
    for (const key of keys) {
      const lv = l[key]
      const cv = c[key]
      if (lv && typeof lv === 'object' && !Array.isArray(lv)) {
        const lm = (lv as Record<string, boolean>) || {}
        const cm = (cv && typeof cv === 'object' && !Array.isArray(cv) ? (cv as Record<string, boolean>) : {}) || {}
        const m: Record<string, boolean> = { ...cm }
        for (const k of Object.keys(lm)) m[k] = !!lm[k] || !!cm[k]
        dayLog[key] = m
      } else {
        dayLog[key] = !!(lv as boolean) || !!(cv as boolean)
      }
    }
    merged[day] = dayLog
  }
  return merged
}

// 3-way log merge: local vs. the last state this device confirmed with the
// cloud (baseline) vs. the current cloud copy. For every field (day ×
// category, and × item for multi):
//   • both sides agree            → that value
//   • only the cloud changed      → take the cloud value (a tick or an
//                                    un-check made on another device lands)
//   • only this device changed    → keep the local value (never clobber an
//                                    edit this device hasn't pushed yet)
//   • both changed                → keep the tick (a checked floor is the
//                                    positive signal; losing one is worse)
function isTickObj(v: unknown): v is Record<string, boolean> {
  return !!v && typeof v === 'object' && !Array.isArray(v)
}
function mergeDayLogs(l: DayLog, b: DayLog | undefined, c: DayLog): DayLog {
  const bl = b || {}
  const out: DayLog = { ...c }
  const keys = new Set([...Object.keys(l), ...Object.keys(c)])
  for (const key of keys) {
    const lv = l[key]
    const bv = bl[key]
    const cv = c[key]
    if (isTickObj(lv) || isTickObj(bv) || isTickObj(cv)) {
      const lo = isTickObj(lv) ? lv : {}
      const bo = isTickObj(bv) ? bv : {}
      const co = isTickObj(cv) ? cv : {}
      const m: Record<string, boolean> = { ...co }
      const ikeys = new Set([...Object.keys(lo), ...Object.keys(co)])
      for (const ik of ikeys) {
        const a = !!lo[ik]
        const base = !!bo[ik]
        const cloud = !!co[ik]
        m[ik] = a === cloud ? a : cloud === base ? a : a === base ? cloud : a || cloud
      }
      out[key] = m
    } else {
      const a = !!lv
      const base = !!bv
      const cloud = !!cv
      out[key] = a === cloud ? a : cloud === base ? a : a === base ? cloud : a || cloud
    }
  }
  return out
}
function mergeLogsWithBaseline(
  local: Record<string, DayLog>,
  baseline: Record<string, DayLog>,
  cloud: Record<string, DayLog>,
): Record<string, DayLog> {
  const merged: Record<string, DayLog> = { ...cloud }
  for (const day of Object.keys(local)) {
    merged[day] = mergeDayLogs(local[day] || {}, baseline[day], cloud[day] || {})
  }
  return merged
}

// Plan text: prefer whichever side has non-empty text for each field.
function mergeConfig(local: Config, cloud: Config): Config {
  const categories: Record<CategoryId, CatConfig> = { ...local.categories }
  for (const key of Object.keys(cloud.categories) as CategoryId[]) {
    const l = local.categories[key]
    const c = cloud.categories[key]
    if (!l) {
      categories[key] = c
      continue
    }
    categories[key] = {
      label: l.label || c.label,
      ideal: l.ideal || c.ideal,
      floor: l.floor || c.floor,
      ifthen: l.ifthen || c.ifthen,
      type: l.type || c.type,
      items: l.items && l.items.length ? l.items : c.items,
    }
  }
  return { startDate: local.startDate || cloud.startDate, categories }
}

// ---------- logic ----------
function emptyDayLog(): DayLog {
  return { physical: { bed: false, clothes: false, hygiene: false }, study: false, diet: false, digital: false }
}
function isFloorMet(dayLog: DayLog | undefined, catId: CategoryId, catDef: CatConfig): boolean {
  if (!dayLog) return false
  if (catDef.type === 'multi') {
    const v = (dayLog[catId] as Record<string, boolean>) || {}
    return Object.values(v).some(Boolean)
  }
  return !!dayLog[catId]
}
function countCompleted(dayLog: DayLog | undefined, config: Config): number {
  if (!dayLog) return 0
  let n = 0
  for (const catId of CAT_ORDER) {
    if (isFloorMet(dayLog, catId, config.categories[catId])) n++
  }
  return n
}
function getEffectiveStartDate(state: State): string {
  let earliest = state.config.startDate || todayKey()
  for (const dateStr of Object.keys(state.logs)) {
    if (countCompleted(state.logs[dateStr], state.config) > 0) {
      if (dateStr < earliest) {
        earliest = dateStr
      }
    }
  }
  return earliest
}

function computeMode(state: State): 'normal' | 'recovery' {
  const today = todayKey()
  const effectiveStart = getEffectiveStartDate(state)
  const daysSinceStart = Math.round((new Date(today).getTime() - new Date(effectiveStart).getTime()) / 86400000)
  if (daysSinceStart < 3) return 'normal'
  let missed = 0
  for (let i = 1; i <= 3; i++) {
    const d = addDays(today, -i)
    const dl = state.logs[d]
    if (countCompleted(dl, state.config) === 0) missed++
  }
  return missed === 3 ? 'recovery' : 'normal'
}
function overallShowUpCount(state: State): number {
  const today = todayKey()
  let n = 0
  for (let i = 0; i < 30; i++) {
    const d = addDays(today, -i)
    const dl = state.logs[d]
    if (countCompleted(dl, state.config) > 0) n++
  }
  return n
}

// ---------- components ----------
function Header({
  showUpCount,
  account,
  onToggleSettings,
  onToggleGemini,
  geminiOpen,
}: {
  showUpCount: number
  account: AccountSession | null
  onToggleSettings: () => void
  onToggleGemini: () => void
  geminiOpen: boolean
}) {
  return (
    <header className="header">
      <div className="header-top">
        <div className="wordmark-group">
          <div className="wordmark-row">
            <span className="wordmark">The Floor</span>
            <span className="brand-dot" aria-hidden="true" />
          </div>
          <span className="wordmark-sub">
            <b className="tabular-nums">{showUpCount}/30</b> days active · Never zero
          </span>
        </div>
        <div className="header-actions">
          <button
            type="button"
            className={`gemini-toggle-btn ${geminiOpen ? 'active' : ''}`}
            onClick={onToggleGemini}
            title="Ask Gemini Coach — Context-Aware Assistant"
            aria-label="Toggle Gemini Chatbot"
          >
            <span className="gemini-toggle-sparkle" aria-hidden="true">✦</span>
            <span className="gemini-toggle-text">Gemini</span>
          </button>
          <button
            type="button"
            className={`settings-toggle-btn ${account ? 'has-account' : ''}`}
            onClick={onToggleSettings}
            title={account ? `Account: ${account.accountNumber} · Settings & Sync` : 'Settings & Account Info'}
            aria-label="Settings and Account"
          >
            <svg
              className="settings-gear-icon"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
            <span className="settings-toggle-text">Settings</span>
            {account && <span className="settings-account-dot" aria-hidden="true" />}
          </button>
        </div>
      </div>
    </header>
  )
}

type Tab = 'today' | 'progress' | 'plan'

function Tabs({ currentTab, onSelect }: { currentTab: Tab; onSelect: (t: Tab) => void }) {
  const tabs: Array<{ id: Tab; label: string; icon: string }> = [
    { id: 'today', label: 'Today', icon: '◎' },
    { id: 'progress', label: 'Progress', icon: '◫' },
    { id: 'plan', label: 'Plan & If-Then', icon: '⚙' },
  ]
  return (
    <nav className="tabs" role="tablist" aria-label="Main Navigation">
      {tabs.map(function (t) {
        const isSelected = currentTab === t.id
        return (
          <button
            key={t.id}
            className={`tab-btn ${isSelected ? 'active' : ''}`}
            data-tab={t.id}
            role="tab"
            aria-selected={isSelected}
            onClick={function () {
              onSelect(t.id)
            }}
          >
            <span className="tab-btn-icon" aria-hidden="true">{t.icon}</span>
            <span className="tab-btn-label">{t.label}</span>
          </button>
        )
      })}
    </nav>
  )
}

function TodayTab({
  state,
  onToggle,
}: {
  state: State
  onToggle: (catId: CategoryId, itemId?: string, targetDate?: string) => void
}) {
  const today = todayKey()
  const [activeDate, setActiveDate] = useState<string>(today)
  const [quoteIdx, setQuoteIdx] = useState<number>(() => Math.floor(Math.random() * STOIC_SPARKS.length))
  const [expandedIfThen, setExpandedIfThen] = useState<Record<CategoryId, boolean>>({
    physical: false,
    study: false,
    diet: false,
    digital: false,
  })

  const isViewingToday = activeDate === today
  const activeDayLog = state.logs[activeDate] || emptyDayLog()
  const completedCount = countCompleted(activeDayLog, state.config)
  const mode = computeMode(state)
  const showUpCount = overallShowUpCount(state)
  const consistencyRate = Math.round((showUpCount / 30) * 100)

  // Past 7 days rolling window (6 days back up to today)
  const pastWeekDays: Array<{
    dateStr: string
    dayNum: number
    dayName: string
    isToday: boolean
    isSelected: boolean
    count: number
  }> = []

  for (let i = 6; i >= 0; i--) {
    const d = addDays(today, -i)
    const dt = parseDateKey(d)
    const log = state.logs[d]
    const c = log ? countCompleted(log, state.config) : 0
    pastWeekDays.push({
      dateStr: d,
      dayNum: dt.getDate(),
      dayName: dt.toLocaleDateString('en-US', { weekday: 'short' }),
      isToday: d === today,
      isSelected: d === activeDate,
      count: c,
    })
  }

  const totalDaysWithFloors = Object.keys(state.logs).filter(
    (d) => countCompleted(state.logs[d], state.config) > 0
  ).length

  let banner: JSX.Element | null = null
  if (mode === 'recovery') {
    banner = (
      <div className="mode-banner">
        <div className="mode-banner-badge">Recovery Protocol Active</div>
        <h3>You’ve been away for 3 days.</h3>
        <p>
          Don’t attempt all four today. The system asks for just <b>ONE floor</b> to reset the pattern and break inertia. That’s your entire job today.
        </p>
      </div>
    )
  } else if (totalDaysWithFloors === 0 && showUpCount === 0) {
    banner = (
      <div className="welcome-banner">
        <div className="welcome-banner-badge">Day 1 of 30</div>
        <h3>Baseline initialized.</h3>
        <p>Hit any floors below today. Perfection is never required; showing up is everything.</p>
      </div>
    )
  }

  return (
    <main id="tabToday" className="tab-panel">
      {banner}

      {/* Hero Momentum Card */}
      <div className="today-hero-card">
        <div className="hero-top-row">
          <div className="hero-kicker-group">
            <span className="hero-kicker-date">
              {isViewingToday ? 'Today · ' + displayDate(today) : `Log for ${displayDate(activeDate)}`}
            </span>
            <span className="hero-pill-status">
              {completedCount === 4 ? 'All Floors Secured' : `${completedCount}/4 Completed`}
            </span>
          </div>
          <div className="hero-completion-pct">
            {Math.round((completedCount / 4) * 100)}%
          </div>
        </div>

        <h2 className="hero-headline">
          {completedCount === 4
            ? 'Daily baseline secured. The floor holds.'
            : completedCount === 3
            ? '3 floors locked in. Just one remaining.'
            : completedCount === 2
            ? 'Halfway through your daily foundation.'
            : completedCount === 1
            ? 'Baseline activated. Momentum is moving.'
            : 'One floor is all it takes to start.'}
        </h2>

        {/* 4-segment visual floor bar */}
        <div className="hero-segments-bar" aria-label={`${completedCount} of 4 floors completed`}>
          {[0, 1, 2, 3].map((idx) => {
            const isFilled = idx < completedCount
            return (
              <div
                key={idx}
                className={`hero-segment ${isFilled ? 'filled' : ''}`}
                title={`Floor ${idx + 1}: ${isFilled ? 'Secured' : 'Pending'}`}
              />
            )
          })}
        </div>

        <div className="hero-footer-metrics">
          <div className="hero-metric">
            <span className="hero-metric-label">30-Day Rolling Momentum</span>
            <span className="hero-metric-val">
              <b className="tabular-nums">{showUpCount}</b>
              <span className="dim">/30 days</span>
            </span>
          </div>
          <div className="hero-metric-sep" />
          <div className="hero-metric">
            <span className="hero-metric-label">Rolling Consistency</span>
            <span className="hero-metric-val">
              <b className="tabular-nums">{consistencyRate}%</b>
            </span>
          </div>
          <div className="hero-metric-sep" />
          <div className="hero-metric">
            <span className="hero-metric-label">Floor System</span>
            <span className={`hero-status-pill ${mode === 'recovery' ? 'recovery' : 'active'}`}>
              {mode === 'recovery' ? 'Recovery' : 'Resilient'}
            </span>
          </div>
        </div>
      </div>

      {/* 7-Day Rolling Scroller */}
      <div className="week-strip-wrapper">
        <div className="week-strip-header">
          <span className="week-strip-title">Recent 7 Days</span>
          {!isViewingToday && (
            <button
              type="button"
              className="jump-today-link"
              onClick={() => setActiveDate(today)}
            >
              Return to Today →
            </button>
          )}
        </div>

        <div className="week-strip" role="group" aria-label="7-Day History Strip">
          {pastWeekDays.map((d) => {
            return (
              <button
                key={d.dateStr}
                type="button"
                className={`week-day-cell ${d.isSelected ? 'selected' : ''} ${d.isToday ? 'is-today' : ''} ${
                  d.count > 0 ? 'has-floors' : ''
                }`}
                onClick={() => setActiveDate(d.dateStr)}
                title={`${d.dayName} ${d.dateStr}: ${d.count}/4 floors met`}
              >
                <span className="week-day-name">{d.dayName}</span>
                <span className="week-day-num tabular-nums">{d.dayNum}</span>
                <div className="week-day-indicator" aria-hidden="true">
                  <span className={`dot-bar level-${d.count}`} />
                </div>
              </button>
            )
          })}
        </div>
      </div>

      {/* Today Cards */}
      <div id="todayCards">
        {CAT_ORDER.map(function (catId) {
          const cat = state.config.categories[catId]
          const meta = CAT_META[catId]
          const isCatFloorMet = isFloorMet(activeDayLog, catId, cat)
          const isExpanded = !!expandedIfThen[catId]
          const isMulti = cat.type === 'multi'

          let body: JSX.Element
          if (isMulti) {
            const items = cat.items || []
            const multiLog = (activeDayLog[catId] as Record<string, boolean> | undefined) || {}
            const metItemsCount = items.filter((it) => multiLog[it.id]).length

            body = (
              <div className="multi-check-grid">
                <div className="multi-check-meta">
                  <span className="multi-check-count">
                    {metItemsCount}/{items.length} completed
                  </span>
                  {isCatFloorMet && <span className="floor-done-tag">Floor Met</span>}
                </div>
                {items.map(function (item) {
                  const checked = !!multiLog[item.id]
                  return (
                    <label
                      className={`check-row ${checked ? 'checked' : ''}`}
                      key={item.id}
                      htmlFor={'chk-' + catId + '-' + item.id}
                    >
                      <input
                        type="checkbox"
                        id={'chk-' + catId + '-' + item.id}
                        checked={checked}
                        onChange={function () {
                          onToggle(catId, item.id, activeDate)
                        }}
                      />
                      <span className="check-box-visual" aria-hidden="true" />
                      <span className="check-label">{item.label}</span>
                    </label>
                  )
                })}
              </div>
            )
          } else {
            const checked = !!activeDayLog[catId]
            body = (
              <label
                className={`check-row primary-check-action ${checked ? 'checked' : ''}`}
                htmlFor={'chk-' + catId}
              >
                <input
                  type="checkbox"
                  id={'chk-' + catId}
                  checked={checked}
                  onChange={function () {
                    onToggle(catId, undefined, activeDate)
                  }}
                />
                <span className="check-box-visual" aria-hidden="true" />
                <span className="check-label">
                  {checked ? 'Floor locked in for today' : 'Mark floor as completed'}
                </span>
                {checked && <span className="floor-tag-done">✓ Done</span>}
              </label>
            )
          }

          return (
            <div
              className={`cat-card ${isCatFloorMet ? 'floor-met' : ''}`}
              key={catId}
            >
              <div className="cat-card-top">
                <div className="cat-card-badge-row">
                  <span className="cat-icon-chip" aria-hidden="true">
                    {meta.icon}
                  </span>
                  <span className="cat-kicker">{meta.kicker}</span>
                  {isCatFloorMet && (
                    <span className="cat-met-pill">Floor Secured ✓</span>
                  )}
                </div>
                <h3 className="cat-label">{cat.label}</h3>
              </div>

              {/* Highlighted Floor block */}
              <div className="cat-floor-highlight">
                <div className="cat-floor-header">
                  <span className="cat-floor-tag">The Floor</span>
                  <span className="cat-floor-sub">Your non-negotiable win</span>
                </div>
                <p className="cat-floor-body">{cat.floor}</p>
              </div>

              {/* Muted Ideal ceiling */}
              <div className="cat-ideal-row">
                <span className="cat-ideal-prefix">Ideal:</span>
                <span className="cat-ideal-text">{cat.ideal}</span>
              </div>

              {/* Interactive checkboxes */}
              <div className="cat-actions-zone">{body}</div>

              {/* If-Then Rescue Protocol */}
              {cat.ifthen && (
                <div className="cat-ifthen-drawer">
                  <button
                    type="button"
                    className="cat-ifthen-trigger"
                    onClick={() =>
                      setExpandedIfThen((prev) => ({
                        ...prev,
                        [catId]: !prev[catId],
                      }))
                    }
                    aria-expanded={isExpanded}
                  >
                    <span className="cat-ifthen-label">
                      {isExpanded ? 'Hide If-Then protocol' : 'If tempted / friction hits'}
                    </span>
                    <span className="cat-ifthen-arrow" aria-hidden="true">
                      {isExpanded ? '▲' : '▼'}
                    </span>
                  </button>
                  {isExpanded && (
                    <div className="cat-ifthen-body">
                      <p>{cat.ifthen}</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Stoic Grounding Wisdom */}
      <div className="daily-spark-card">
        <div className="spark-header">
          <span className="spark-kicker">Daily Grounding Principle</span>
          <button
            type="button"
            className="spark-refresh-btn"
            onClick={() => setQuoteIdx((prev) => (prev + 1) % STOIC_SPARKS.length)}
            title="Cycle next insight"
          >
            Next Principle ↻
          </button>
        </div>
        <blockquote className="spark-body">
          “{STOIC_SPARKS[quoteIdx].quote}”
        </blockquote>
        <div className="spark-author">— {STOIC_SPARKS[quoteIdx].author}</div>
      </div>
    </main>
  )
}

function HeatmapCalendar({ state }: { state: State }) {
  const today = todayKey()
  const [selectedDay, setSelectedDay] = useState<string | null>(today)

  const days: {
    dateStr: string
    dayNum: number
    weekday: string
    isToday: boolean
    floorsMet: number
    metCategories: string[]
  }[] = []

  for (let i = 29; i >= 0; i--) {
    const d = addDays(today, -i)
    const dt = parseDateKey(d)
    const dl = state.logs[d]
    const metCategories: string[] = []
    for (const catId of CAT_ORDER) {
      if (isFloorMet(dl, catId, state.config.categories[catId])) {
        metCategories.push(state.config.categories[catId].label)
      }
    }
    days.push({
      dateStr: d,
      dayNum: dt.getDate(),
      weekday: dt.toLocaleDateString('en-IN', { weekday: 'short' }),
      isToday: d === today,
      floorsMet: metCategories.length,
      metCategories,
    })
  }

  const firstDt = parseDateKey(days[0].dateStr)
  // 0 = Sun, 1 = Mon ... 6 = Sat -> Mon start: 0 for Mon, 6 for Sun
  const leadingOffset = (firstDt.getDay() + 6) % 7
  const totalDaysMet = days.filter((d) => d.floorsMet > 0).length

  const activeDayData = (selectedDay && days.find((d) => d.dateStr === selectedDay)) || days[days.length - 1]

  const weekHeaders = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

  return (
    <div className="heatmap-card">
      <div className="heatmap-head">
        <h3 className="heatmap-title">30–Day Activity Heatmap</h3>
        <p className="heatmap-sub">Days you showed up with at least 1 floor</p>
        <div className="heatmap-stats">
          <span className="heatmap-stat-num">{totalDaysMet}</span>
          <span className="heatmap-stat-den">/30 days</span>
        </div>
      </div>

      <div className="heatmap-weekdays" aria-hidden="true">
        {weekHeaders.map((w) => (
          <span key={w} className="heatmap-weekday">
            {w}
          </span>
        ))}
      </div>

      <div className="heatmap-grid" role="grid" aria-label="30-day floor activity calendar">
        {Array.from({ length: leadingOffset }).map((_, idx) => (
          <span key={'empty-' + idx} className="heatmap-cell empty" aria-hidden="true" />
        ))}
        {days.map((day) => {
          const isSelected = selectedDay === day.dateStr
          const level = day.floorsMet
          const tooltip = `${day.weekday}, ${day.dateStr}${day.isToday ? ' (Today)' : ''}: ${
            day.floorsMet === 0
              ? '0 floors met'
              : `${day.floorsMet}/4 floors met (${day.metCategories.join(', ')})`
          }`

          return (
            <button
              key={day.dateStr}
              type="button"
              className={`heatmap-cell level-${level}${day.isToday ? ' today' : ''}${
                isSelected ? ' selected' : ''
              }`}
              title={tooltip}
              aria-label={tooltip}
              aria-pressed={isSelected}
              onClick={() => setSelectedDay(day.dateStr)}
            >
              <span className="heatmap-day-num">{day.dayNum}</span>
            </button>
          )
        })}
      </div>

      {activeDayData && (
        <div className="heatmap-selected-info">
          <div className="heatmap-selected-date">
            <span className="heatmap-selected-dayname">{activeDayData.weekday}, </span>
            <span className="heatmap-selected-datestr">{activeDayData.dateStr}</span>
            {activeDayData.isToday && <span className="heatmap-today-badge">Today</span>}
          </div>
          <div className="heatmap-selected-result">
            {activeDayData.floorsMet > 0 ? (
              <span className="text-met">
                <b>{activeDayData.floorsMet}/4 floors met</b>
                <span className="heatmap-cat-list"> — {activeDayData.metCategories.join(', ')}</span>
              </span>
            ) : (
              <span className="text-missed">0 floors met (No activity)</span>
            )}
          </div>
        </div>
      )}

      <div className="heatmap-footer">
        <span className="heatmap-legend-label">Floors met:</span>
        <div className="heatmap-legend" aria-label="Heatmap legend">
          <span className="heatmap-legend-item">
            <span className="heatmap-legend-swatch level-0" /> 0
          </span>
          <span className="heatmap-legend-item">
            <span className="heatmap-legend-swatch level-1" /> 1
          </span>
          <span className="heatmap-legend-item">
            <span className="heatmap-legend-swatch level-2" /> 2
          </span>
          <span className="heatmap-legend-item">
            <span className="heatmap-legend-swatch level-3" /> 3
          </span>
          <span className="heatmap-legend-item">
            <span className="heatmap-legend-swatch level-4" /> 4
          </span>
        </div>
      </div>
    </div>
  )
}

function ProgressTab({
  state,
  onOpenClaude,
}: {
  state: State
  onOpenClaude: (tab?: 'briefing' | 'prompt' | 'project') => void
}) {
  const today = todayKey()
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    const text = generateClaudeDailyBriefing(state, today)
    const ok = await copyToClipboard(text)
    if (ok) {
      setCopied(true)
      setTimeout(() => setCopied(false), 2400)
    }
  }

  return (
    <main id="tabProgress" className="tab-panel">
      <HeatmapCalendar state={state} />

      <div className="category-progress-title">
        <span>Category Rolling Windows</span>
      </div>

      <div id="progressGrids">
        {CAT_ORDER.map(function (catId) {
          const cat = state.config.categories[catId]
          // Collect dates in the 30-day rolling window where this floor was met
          const completedDates: string[] = []
          for (let i = 29; i >= 0; i--) {
            const d = addDays(today, -i)
            const dl = state.logs[d]
            if (isFloorMet(dl, catId, cat)) {
              completedDates.push(d)
            }
          }
          const doneCount = completedDates.length
          const cells: JSX.Element[] = []
          for (let i = 0; i < 30; i++) {
            const isDone = i < doneCount
            const title = isDone
              ? `${completedDates[i]} — Floor met`
              : `Day ${i + 1} of 30`
            cells.push(
              <span
                className={'cell' + (isDone ? ' done' : '')}
                title={title}
                key={i}
              ></span>
            )
          }
          const pct = Math.round((doneCount / 30) * 100)
          const meta = CAT_META[catId]
          return (
            <div className="progress-block" key={catId}>
              <div className="progress-head">
                <div className="progress-head-left">
                  <span className="progress-icon" aria-hidden="true">{meta.icon}</span>
                  <span className="progress-title">{cat.label}</span>
                </div>
                <div className="progress-head-right">
                  <span className="progress-count tabular-nums">{doneCount}/30</span>
                  <span className="progress-pct tabular-nums">{pct}%</span>
                </div>
              </div>
              <div className="progress-bar-track">
                <div className="progress-bar-fill" style={{ width: `${pct}%` }} />
              </div>
              <div className="grid-cells">{cells}</div>
            </div>
          )
        })}
      </div>

      {/* Claude AI Briefing section at the end of the Progress section */}
      <div className="progress-claude-section">
        <div className="progress-claude-head">
          <div className="progress-claude-badge">
            <span className="progress-claude-dot" aria-hidden="true" />
            <span>Claude AI Companion</span>
          </div>
          <h3 className="progress-claude-title">Export Progress to Claude</h3>
          <p className="progress-claude-sub">
            Generate a clean, structured summary of your rolling 30-day baseline and today's floor checklist to paste directly into your Claude chatbot.
          </p>
        </div>
        <div className="progress-claude-actions">
          <button
            type="button"
            className={`btn-primary progress-claude-copy ${copied ? 'copied' : ''}`}
            onClick={handleCopy}
          >
            {copied ? '✓ Copied to Clipboard!' : 'Copy Briefing for Claude'}
          </button>
          <button
            type="button"
            className="btn-ghost progress-claude-hub"
            onClick={() => onOpenClaude('briefing')}
          >
            Claude Hub & Prompts ↗
          </button>
        </div>
      </div>
    </main>
  )
}

function PlanTab({
  state,
  onSave,
  onPersist,
  onOpenClaude,
}: {
  state: State
  onSave: (catId: CategoryId, field: 'ideal' | 'floor' | 'ifthen', value: string) => void
  onPersist: () => void
  onOpenClaude?: (tab?: 'briefing' | 'prompt' | 'project') => void
}) {
  const [saved, setSaved] = useState(false)
  useEffect(function () {
    if (!saved) return
    const t = setTimeout(function () {
      setSaved(false)
    }, 1500)
    return function () {
      clearTimeout(t)
    }
  }, [saved])

  async function handleSaveClick() {
    onPersist()
    setSaved(true)
  }

  return (
    <main id="tabPlan" className="tab-panel">
      <div className="how-it-works">
        <h2>How this works</h2>
        <ul id="howList">
          {HOW_IT_WORKS.map(function (t, i) {
            return <li key={i}>{t}</li>
          })}
        </ul>
      </div>
      <div id="planForm">
        {CAT_ORDER.map(function (catId) {
          const cat = state.config.categories[catId]
          return (
            <div className="plan-cat" key={catId}>
              <h3>{cat.label}</h3>
              <label className="field-label" htmlFor={'ideal-' + catId}>
                ideal
              </label>
              <input
                className="field"
                id={'ideal-' + catId}
                defaultValue={cat.ideal}
                onChange={function (e) {
                  onSave(catId, 'ideal', e.target.value)
                }}
              />
              <label className="field-label" htmlFor={'floor-' + catId}>
                floor
              </label>
              <textarea
                className="field"
                id={'floor-' + catId}
                rows={2}
                defaultValue={cat.floor}
                onChange={function (e) {
                  onSave(catId, 'floor', e.target.value)
                }}
              />
              <label className="field-label" htmlFor={'ifthen-' + catId}>
                if-then plan
              </label>
              <textarea
                className="field"
                id={'ifthen-' + catId}
                rows={2}
                defaultValue={cat.ifthen}
                onChange={function (e) {
                  onSave(catId, 'ifthen', e.target.value)
                }}
              />
            </div>
          )
        })}
      </div>
      <button id="savePlanBtn" className="btn-primary" onClick={handleSaveClick}>
        {saved ? 'Saved' : 'Save plan'}
      </button>

      {onOpenClaude && (
        <div className="plan-claude-section">
          <div className="plan-claude-header">
            <div className="plan-claude-badge">
              <span className="plan-claude-dot" aria-hidden="true" />
              <span>Claude Companion</span>
            </div>
            <h3 className="plan-section-title">Claude AI Integration</h3>
            <p className="plan-section-desc">
              Connect your daily baseline with Claude to receive personalized, anti-guilt coaching in your Claude chats.
            </p>
          </div>
          <div className="plan-claude-card">
            <div className="plan-claude-row">
              <div>
                <div className="plan-claude-card-title">Claude Hub & Prompt Setup</div>
                <div className="plan-claude-card-sub">
                  Copy today's live briefing, download Claude Project knowledge, or get the custom System Prompt.
                </div>
              </div>
              <button
                type="button"
                className="plan-claude-btn"
                onClick={() => onOpenClaude('briefing')}
              >
                Open Claude Hub ↗
              </button>
            </div>
          </div>
        </div>
      )}

      <DangerZone />
    </main>
  )
}

function DangerZone() {
  const [confirming, setConfirming] = useState(false)
  const [timer, setTimer] = useState<ReturnType<typeof setTimeout> | null>(null)
  useEffect(function () {
    return function () {
      if (timer) clearTimeout(timer)
    }
  }, [timer])

  function handleClick() {
    if (!confirming) {
      setConfirming(true)
      if (timer) clearTimeout(timer)
      setTimer(
        setTimeout(function () {
          setConfirming(false)
        }, 3000),
      )
      return
    }
    if (timer) clearTimeout(timer)
    setConfirming(false)
    void doReset()
  }

  return (
    <div className="danger-zone">
      <button id="resetBtn" className={'btn-ghost' + (confirming ? ' confirming' : '')} onClick={handleClick}>
        {confirming ? 'Tap again to confirm — deletes everything' : 'Reset all data'}
      </button>
    </div>
  )
}

async function doReset(): Promise<void> {
  const config = defaultConfig()
  const logs: Record<string, DayLog> = {}
  try {
    window.localStorage.removeItem(ALL_FOUR_CELEBRATED_KEY)
  } catch (e) {}
  await persistConfig(config)
  await persistLogs(logs)
  const session = readSession()
  if (session) {
    // Keep devices consistent: the reset also replaces the cloud copy.
    await pushToCloud(session, { config, logs })
  }
  window.location.reload()
}

// ---------- sync panel (account number + password) ----------
function SyncPanel({
  account,
  busy,
  message,
  onCreate,
  onLogin,
  onSignOut,
}: {
  account: AccountSession | null
  busy: string | null
  message: string | null
  onCreate: (acct: string, pw: string) => Promise<void> | void
  onLogin: (acct: string, pw: string) => Promise<void> | void
  onSignOut: () => void
}) {
  const [mode, setMode] = useState<'choice' | 'create' | 'login'>('choice')
  const [acctInput, setAcctInput] = useState('')
  const [pwInput, setPwInput] = useState('')

  if (!cloudAvailable()) return null

  if (account) {
    const okMsg = message && message.indexOf('ok: ') === 0 ? message.slice(4) : null
    const errMsg = message && !okMsg ? message : null
    return (
      <section className="sync-panel" aria-label="Sync">
        <div className="sync-row">
          <span className="sync-dot synced" aria-hidden="true"></span>
          <span className="sync-text">
            Synced for <b className="mono">{account.accountNumber}</b> — this progress follows you on any device.
          </span>
          <button className="btn-ghost sync-btn" onClick={onSignOut}>
            Sign out
          </button>
        </div>
        {okMsg && <p className="sync-note ok">{okMsg}</p>}
        {errMsg && <p className="sync-note err">{errMsg}</p>}
      </section>
    )
  }

  const okMsg = message && message.indexOf('ok: ') === 0 ? message.slice(4) : null
  const errMsg = message && !okMsg ? message : null

  function submit() {
    if (busy) return
    if (mode === 'create') void onCreate(acctInput.trim(), pwInput)
    else void onLogin(acctInput.trim(), pwInput)
  }

  return (
    <section className="sync-panel" aria-label="Sync">
      {mode === 'choice' ? (
        <div className="sync-row">
          <span className="sync-dot" aria-hidden="true"></span>
          <span className="sync-text">
            <b>Access your progress from any device.</b> Create a sync account with your phone number and a PIN — then sign in with the same phone number + PIN on any other device to load the same progress.
          </span>
        </div>
      ) : (
        <div className="sync-form">
          <label className="field-label" htmlFor="sync-acct">
            phone number
          </label>
          <input
            className="field"
            id="sync-acct"
            type="tel"
            inputMode="tel"
            autoComplete="username"
            value={acctInput}
            onChange={function (e) {
              setAcctInput(e.target.value)
            }}
            placeholder={mode === 'create' ? 'e.g. 9876543210' : 'The phone number you signed up with'}
            disabled={!!busy}
          />
          <label className="field-label" htmlFor="sync-pw">
            PIN
          </label>
          <input
            className="field"
            id="sync-pw"
            type="password"
            autoComplete={mode === 'create' ? 'new-password' : 'current-password'}
            value={pwInput}
            onChange={function (e) {
              setPwInput(e.target.value)
            }}
            placeholder={mode === 'create' ? 'Choose a PIN (4+ characters)' : 'Your PIN'}
            disabled={!!busy}
          />
        </div>
      )}
      {okMsg && <p className="sync-note ok">{okMsg}</p>}
      {errMsg && <p className="sync-note err">{errMsg}</p>}
      <p className="sync-backend">backend: {SYNC_BACKEND_URL.replace(/^https:\/\//, '')}</p>
      <div className="sync-actions">
        {mode === 'choice' ? (
          <>
            <button className="btn-primary sync-cta" onClick={function () { setMode('create') }}>
              Create sync account
            </button>
            <button className="btn-ghost sync-alt" onClick={function () { setMode('login') }}>
              I have an account
            </button>
          </>
        ) : (
          <>
            <button className="btn-primary sync-cta" onClick={submit} disabled={!!busy}>
              {busy ? busy : mode === 'create' ? 'Create account' : 'Sign in'}
            </button>
            <button className="btn-ghost sync-alt" onClick={function () { setMode('choice') }} disabled={!!busy}>
              Back
            </button>
          </>
        )}
      </div>
    </section>
  )
}

// ---------- app ----------
export default function App() {
  const [state, setState] = useState<State | null>(null)
  const [stateReady, setStateReady] = useState(false)
  const [currentTab, setCurrentTab] = useState<Tab>('today')
  const [account, setAccount] = useState<AccountSession | null>(null)
  const [cloudBusy, setCloudBusy] = useState<string | null>(null)
  const [cloudMsg, setCloudMsg] = useState<string | null>(null)
  const accountRef = useRef<AccountSession | null>(null)
  const stateRef = useRef<State | null>(null)
  // Cloud state version we've already incorporated, and the merged state as
  // of the last confirmed sync (the 3-way merge baseline). No local-clock
  // comparisons: server timestamps are only ever compared to each other, so
  // a device with a skewed clock can't mistake a remote update for its own.
  const lastCloudUpdatedAtRef = useRef<number>(0)
  const lastSyncedRef = useRef<State | null>(null)

  useEffect(function () {
    accountRef.current = account
  }, [account])

  useEffect(function () {
    stateRef.current = state
  }, [state])

  const syncStateToCloud = useCallback(function (s: State) {
    const acct = accountRef.current
    if (!acct) return
    void pushToCloud(acct, s).then(function (ok) {
      // The cloud now mirrors s — it becomes the next merge baseline. On
      // failure the baseline stays put so a later pull can't undo local edits.
      if (ok) lastSyncedRef.current = s
      setCloudMsg(ok ? null : 'Sync is offline — changes are saved on this device and will sync later.')
    })
  }, [])

  useEffect(function () {
    let alive = true
    void (async function () {
      const loaded = await loadState()
      if (alive) setState(loaded)
      if (alive) setAccount(readSession())
      if (alive) setStateReady(true)
    })()
    return function () {
      alive = false
    }
  }, [])

  // Auto-push: any change is sent to the cloud shortly after it happens.
  useEffect(function () {
    if (!account || !state) return
    const h = setTimeout(function () {
      syncStateToCloud(state)
    }, 900)
    return function () {
      clearTimeout(h)
    }
  }, [state, account, syncStateToCloud])

  // Live sync: pull the account's cloud copy right away, every few seconds,
  // and whenever the tab regains focus. A pull that is newer than anything
  // this device has seen gets merged in — ticks (and un-ticks) made on another
  // device appear here with no action needed.
  useEffect(function () {
    if (!account || !stateReady) return
    let alive = true
    async function pull() {
      const acct = accountRef.current
      if (!acct) return
      const res = await pullFromCloud(acct)
      if (!alive || !res.ok || !res.found) return
      if (res.updatedAt <= lastCloudUpdatedAtRef.current) return
      lastCloudUpdatedAtRef.current = res.updatedAt
      const s = stateRef.current
      if (!s) return
      const cloudLogs = (res.logs as Record<string, DayLog>) || {}
      const cloudConfig = res.config && (res.config as Config).categories ? (res.config as Config) : null
      const base = lastSyncedRef.current
      const logs = base ? mergeLogsWithBaseline(s.logs, base.logs, cloudLogs) : mergeLogs(s.logs, cloudLogs)
      const remoteConfigChanged = cloudConfig
        ? base
          ? JSON.stringify(cloudConfig) !== JSON.stringify(base.config)
          : true
        : false
      const config = remoteConfigChanged ? mergeConfig(s.config, cloudConfig as Config) : s.config
      const logsChanged = JSON.stringify(logs) !== JSON.stringify(s.logs)
      const configChanged = JSON.stringify(config) !== JSON.stringify(s.config)
      if (logsChanged || configChanged) {
        const merged: State = { config, logs }
        setState(merged)
        void persistConfig(config)
        void persistLogs(logs)
        void pushToCloud(acct, merged).then(function (ok) {
          if (ok) lastSyncedRef.current = merged
        })
      } else {
        lastSyncedRef.current = { config, logs }
      }
    }
    void pull()
    const iv = setInterval(function () {
      void pull()
    }, 8000)
    function onVis() {
      if (document.visibilityState === 'visible') void pull()
    }
    document.addEventListener('visibilitychange', onVis)
    window.addEventListener('focus', onVis)
    return function () {
      alive = false
      clearInterval(iv)
      document.removeEventListener('visibilitychange', onVis)
      window.removeEventListener('focus', onVis)
    }
  }, [account, stateReady])

  // Safety net: flush state right before the page closes or is hidden, so a
  // tick you just made is never lost even if the normal save didn't finish.
  useEffect(function () {
    if (!state) return
    function flush() {
      if (!state) return
      try {
        storage.set('config', JSON.stringify(state.config))
      } catch (e) {}
      try {
        storage.set('logs', JSON.stringify(state.logs))
      } catch (e) {}
    }
    window.addEventListener('beforeunload', flush)
    function onVis() {
      if (document.visibilityState === 'hidden') {
        try {
          storage.set('logs', JSON.stringify(state!.logs))
        } catch (e) {}
        if (accountRef.current) {
          void pushToCloud(accountRef.current, state!).then(function (ok) {
            if (ok) lastSyncedRef.current = state!
          })
        }
      }
    }
    document.addEventListener('visibilitychange', onVis)
    return function () {
      window.removeEventListener('beforeunload', flush)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [state])

  const [syncModalOpen, setSyncModalOpen] = useState(false)
  const [claudeModalOpen, setClaudeModalOpen] = useState(false)
  const [claudeModalTab, setClaudeModalTab] = useState<'briefing' | 'prompt' | 'project'>('briefing')
  const [geminiOpen, setGeminiOpen] = useState(false)

  const handleOpenClaude = useCallback(function (tab: 'briefing' | 'prompt' | 'project' = 'briefing') {
    setClaudeModalTab(tab)
    setClaudeModalOpen(true)
  }, [])

  const handleToggle = useCallback(function (catId: CategoryId, itemId?: string, targetDate?: string) {
    setState(function (prev) {
      if (!prev) return prev
      const date = targetDate || todayKey()
      const logs = { ...prev.logs }
      const dayLog: DayLog = logs[date] ? { ...logs[date] } : emptyDayLog()
      const prevCompleted = countCompleted(dayLog, prev.config)
      if (itemId) {
        const multiLog = { ...((dayLog[catId] as Record<string, boolean>) || {}) }
        multiLog[itemId] = !multiLog[itemId]
        dayLog[catId] = multiLog
      } else {
        dayLog[catId] = !dayLog[catId]
      }
      logs[date] = dayLog
      const newCompleted = countCompleted(dayLog, prev.config)

      if (date === todayKey() && prevCompleted < 4 && newCompleted === 4) {
        try {
          const already = window.localStorage.getItem(ALL_FOUR_CELEBRATED_KEY)
          if (!already) {
            window.localStorage.setItem(ALL_FOUR_CELEBRATED_KEY, 'true')
            triggerAllFourConfetti()
          }
        } catch (e) {
          triggerAllFourConfetti()
        }
      }

      void persistLogs(logs)
      const acct = accountRef.current
      if (acct) {
        void pushToCloud(acct, { config: prev.config, logs: logs }).then(function (ok) {
          if (ok) lastSyncedRef.current = { config: prev.config, logs: logs }
        })
      }
      return { ...prev, logs: logs }
    })
  }, [])

  const handlePlanChange = useCallback(function (catId: CategoryId, field: 'ideal' | 'floor' | 'ifthen', value: string) {
    setState(function (prev) {
      if (!prev) return prev
      const categories = { ...prev.config.categories }
      categories[catId] = { ...categories[catId], [field]: value }
      return { ...prev, config: { ...prev.config, categories: categories } }
    })
  }, [])

  const handlePersistConfig = useCallback(function () {
    if (!state) return
    void persistConfig(state.config)
    syncStateToCloud(state)
  }, [state, syncStateToCloud])

  const handleCreateAccount = useCallback(async function (acct: string, pw: string) {
    if (!state) return
    const phone = acct.replace(/[\s()\-]/g, '')
    if (!/^\+?\d{6,15}$/.test(phone)) {
      setCloudMsg('Enter a valid phone number (6–15 digits, numbers only).')
      return
    }
    if (pw.length < 4) {
      setCloudMsg('Choose a PIN with at least 4 characters.')
      return
    }
    setCloudBusy('Creating account…')
    setCloudMsg(null)
    try {
      const res = await createAccountOnCloud(phone, pw, state)
      if (!res.ok || !res.session) {
        setCloudMsg((res as { error?: string }).error || 'Could not create the account.')
        return
      }
      saveSession(res.session)
      setAccount(res.session)
      setStateReady(true)
      setCloudMsg('ok: Sync account created for ' + phone + ' — use this phone number + PIN on any device to open your progress.')
    } catch (e) {
      setCloudMsg('Could not reach the sync service. Try again.')
    } finally {
      setCloudBusy(null)
    }
  }, [state])

  const handleLogin = useCallback(async function (acct: string, pw: string) {
    const phone = acct.replace(/[\s()\-]/g, '')
    if (!/^\+?\d{6,15}$/.test(phone)) {
      setCloudMsg('Enter the phone number you created the account with.')
      return
    }
    if (pw.length < 4) {
      setCloudMsg('Enter your PIN.')
      return
    }
    setCloudBusy('Signing in…')
    setCloudMsg(null)
    try {
      const res = await loginToCloud(phone, pw)
      if (!res.ok || !res.session) {
        setCloudMsg((res as { error?: string }).error || 'Sign in failed.')
        return
      }
      saveSession(res.session)
      setAccount(res.session)
      const local = state ?? (await loadState())
      const mergedConfig = res.config && res.config.categories ? mergeConfig(local.config, res.config as Config) : local.config
      const merged: State = { config: mergedConfig, logs: mergeLogs(local.logs, (res.logs as Record<string, DayLog>) || {}) }
      lastCloudUpdatedAtRef.current = 0
      lastSyncedRef.current = merged
      setState(merged)
      setStateReady(true)
      void persistConfig(merged.config)
      void persistLogs(merged.logs)
      void pushToCloud(res.session, merged)
      setCloudMsg('ok: Signed in — progress from your account is loaded and merged.')
    } catch (e) {
      setCloudMsg('Could not reach the sync service. Try again.')
    } finally {
      setCloudBusy(null)
    }
  }, [state])

  const handleSignOut = useCallback(function () {
    clearSession()
    setAccount(null)
    setCloudMsg('Signed out — this device keeps its local copy; your cloud account is untouched.')
  }, [])

  if (!state) {
    return (
      <div className="app">
        <div className="loading">Loading your data…</div>
      </div>
    )
  }

  const showUpCount = overallShowUpCount(state)
  return (
    <div className="app" id="app">
      <Header
        showUpCount={showUpCount}
        account={account}
        onToggleSettings={() => setSyncModalOpen((v) => !v)}
        onToggleGemini={() => setGeminiOpen((v) => !v)}
        geminiOpen={geminiOpen}
      />
      <Tabs currentTab={currentTab} onSelect={setCurrentTab} />

      {/* Gemini Context-Aware Assistant Drawer */}
      <GeminiDrawer
        isOpen={geminiOpen}
        onClose={() => setGeminiOpen(false)}
        state={state}
      />

      {/* Claude AI Briefing Modal */}
      {claudeModalOpen && (
        <ClaudeModal
          state={state}
          initialTab={claudeModalTab}
          onClose={() => setClaudeModalOpen(false)}
        />
      )}

      {/* Settings / Account Modal */}
      {syncModalOpen && (
        <div className="sync-modal-backdrop" onClick={() => setSyncModalOpen(false)}>
          <div className="sync-modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="sync-modal-head">
              <div className="sync-modal-title-group">
                <span className="sync-modal-title">Settings & Account</span>
                <span className="sync-modal-sub">
                  {account
                    ? `Account #${account.accountNumber} · Synced across devices`
                    : 'Manage cloud backup, cross-device sync, and account details'}
                </span>
              </div>
              <button
                type="button"
                className="sync-modal-close"
                onClick={() => setSyncModalOpen(false)}
                aria-label="Close sync modal"
              >
                ✕
              </button>
            </div>
            <SyncPanel
              key={account ? account.accountNumber : 'anon'}
              account={account}
              busy={cloudBusy}
              message={cloudMsg}
              onCreate={handleCreateAccount}
              onLogin={handleLogin}
              onSignOut={handleSignOut}
            />
          </div>
        </div>
      )}

      {currentTab === 'today' && <TodayTab state={state} onToggle={handleToggle} />}
      {currentTab === 'progress' && <ProgressTab state={state} onOpenClaude={handleOpenClaude} />}
      {currentTab === 'plan' && (
        <div className="plan-tab-wrapper">
          <PlanTab
            state={state}
            onSave={handlePlanChange}
            onPersist={handlePersistConfig}
            onOpenClaude={handleOpenClaude}
          />
          <div className="plan-sync-section">
            <div className="plan-sync-header">
              <h3 className="plan-section-title">Cloud Account & Sync</h3>
              <p className="plan-section-desc">Access your floors on other devices or create a secure backup.</p>
            </div>
            <SyncPanel
              key={account ? account.accountNumber : 'anon'}
              account={account}
              busy={cloudBusy}
              message={cloudMsg}
              onCreate={handleCreateAccount}
              onLogin={handleLogin}
              onSignOut={handleSignOut}
            />
          </div>
        </div>
      )}
    </div>
  )
}
