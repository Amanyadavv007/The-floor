import { useCallback, useEffect, useRef, useState } from 'react'
import { createAccountOnCloud, cloudAvailable, loginToCloud, pushToCloud, SYNC_BACKEND_URL, type AccountSession } from './lib/cloud'
import type { CatConfig, CategoryId, Config, DayLog, State } from './types'

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
function todayKey(): string {
  return fmtDate(new Date())
}
function displayDate(): string {
  return new Date().toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })
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

// Days are merged as a union: days only in the cloud copy appear, days only
// locally stay, and if a day exists on both sides the local version wins.
function mergeLogs(local: Record<string, DayLog>, cloud: Record<string, DayLog>): Record<string, DayLog> {
  const merged: Record<string, DayLog> = { ...cloud }
  for (const k of Object.keys(local)) merged[k] = local[k]
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
function computeMode(state: State): 'normal' | 'recovery' {
  const today = todayKey()
  const daysSinceStart = Math.round((new Date(today).getTime() - new Date(state.config.startDate).getTime()) / 86400000)
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
function Header({ showUpCount }: { showUpCount: number }) {
  return (
    <header className="header">
      <div className="header-top">
        <span className="wordmark">The Floor</span>
        <span className="today-date">{displayDate()}</span>
      </div>
      <div className="identity">
        <span className="identity-num">{showUpCount}</span>
        <span className="identity-label">/30 days you showed up</span>
      </div>
    </header>
  )
}

type Tab = 'today' | 'progress' | 'plan'

function Tabs({ currentTab, onSelect }: { currentTab: Tab; onSelect: (t: Tab) => void }) {
  const tabs: Array<{ id: Tab; label: string }> = [
    { id: 'today', label: 'Today' },
    { id: 'progress', label: 'Progress' },
    { id: 'plan', label: 'Plan' },
  ]
  return (
    <nav className="tabs" role="tablist">
      {tabs.map(function (t) {
        return (
          <button
            key={t.id}
            className="tab-btn"
            data-tab={t.id}
            role="tab"
            aria-selected={currentTab === t.id}
            onClick={function () {
              onSelect(t.id)
            }}
          >
            {t.label}
          </button>
        )
      })}
    </nav>
  )
}

function TodayTab({ state, onToggle }: { state: State; onToggle: (catId: CategoryId, itemId?: string) => void }) {
  const today = todayKey()
  const dayLog = state.logs[today] || emptyDayLog()

  const mode = computeMode(state)
  let banner: JSX.Element | null = null
  if (mode === 'recovery') {
    banner = (
      <div className="mode-banner">
        <h3>You’ve gone quiet for 3 days.</h3>
        <p>
          That’s the exact pattern — a couple good weeks, then months of nothing. Don’t try to fix all four today.
          Pick ONE category below and just hit the floor. That’s the whole job right now.
        </p>
      </div>
    )
  } else {
    const daysSinceStart = Math.round((new Date(today).getTime() - new Date(state.config.startDate).getTime()) / 86400000)
    if (daysSinceStart < 1) {
      banner = (
        <div className="welcome-banner">
          <h3>Day one.</h3>
          <p>Just hit the floors below. Nothing else matters today.</p>
        </div>
      )
    }
  }

  return (
    <main id="tabToday" className="tab-panel">
      {banner}
      <div id="todayCards">
        {CAT_ORDER.map(function (catId) {
          const cat = state.config.categories[catId]
          let body: JSX.Element
          if (cat.type === 'multi') {
            body = (
              <>
                {(cat.items || []).map(function (item) {
                  const multiLog = (dayLog[catId] as Record<string, boolean> | undefined) || {}
                  const checked = multiLog[item.id] ? true : false
                  return (
                    <div className="check-row" key={item.id}>
                      <input
                        type="checkbox"
                        id={'chk-' + catId + '-' + item.id}
                        checked={checked}
                        onChange={function () {
                          onToggle(catId, item.id)
                        }}
                      />
                      <label htmlFor={'chk-' + catId + '-' + item.id}>{item.label}</label>
                    </div>
                  )
                })}
              </>
            )
          } else {
            const checked = dayLog[catId] ? true : false
            body = (
              <div className="check-row">
                <input
                  type="checkbox"
                  id={'chk-' + catId}
                  checked={checked}
                  onChange={function () {
                    onToggle(catId)
                  }}
                />
                <label htmlFor={'chk-' + catId}>Floor met today</label>
              </div>
            )
          }
          return (
            <div className="cat-card" key={catId}>
              <p className="cat-label">{cat.label}</p>
              <p className="cat-ideal">ideal: {cat.ideal}</p>
              <p className="cat-floor">
                <b>Floor:</b> {cat.floor}
              </p>
              {body}
            </div>
          )
        })}
      </div>
    </main>
  )
}

function ProgressTab({ state }: { state: State }) {
  const today = todayKey()
  return (
    <main id="tabProgress" className="tab-panel">
      <div id="progressGrids">
        {CAT_ORDER.map(function (catId) {
          const cat = state.config.categories[catId]
          let doneCount = 0
          const cells: JSX.Element[] = []
          for (let i = 29; i >= 0; i--) {
            const d = addDays(today, -i)
            const dl = state.logs[d]
            const met = isFloorMet(dl, catId, cat)
            if (met) doneCount++
            cells.push(<span className={'cell' + (met ? ' done' : '')} title={d} key={i}></span>)
          }
          return (
            <div className="progress-block" key={catId}>
              <div className="progress-head">
                <span className="progress-title">{cat.label}</span>
                <span className="progress-count">{doneCount}/30</span>
              </div>
              <div className="grid-cells">{cells}</div>
            </div>
          )
        })}
      </div>
    </main>
  )
}

function PlanTab({
  state,
  onSave,
  onPersist,
}: {
  state: State
  onSave: (catId: CategoryId, field: 'ideal' | 'floor' | 'ifthen', value: string) => void
  onPersist: () => void
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
  const [currentTab, setCurrentTab] = useState<Tab>('today')
  const [account, setAccount] = useState<AccountSession | null>(null)
  const [cloudBusy, setCloudBusy] = useState<string | null>(null)
  const [cloudMsg, setCloudMsg] = useState<string | null>(null)
  const accountRef = useRef<AccountSession | null>(null)

  useEffect(function () {
    accountRef.current = account
  }, [account])

  const syncStateToCloud = useCallback(function (s: State) {
    const acct = accountRef.current
    if (!acct) return
    void pushToCloud(acct, s).then(function (ok) {
      setCloudMsg(ok ? null : 'Sync is offline — changes are saved on this device and will sync later.')
    })
  }, [])

  useEffect(function () {
    let alive = true
    void (async function () {
      const loaded = await loadState()
      if (alive) setState(loaded)
      if (alive) setAccount(readSession())
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
        if (accountRef.current) void pushToCloud(accountRef.current, state!)
      }
    }
    document.addEventListener('visibilitychange', onVis)
    return function () {
      window.removeEventListener('beforeunload', flush)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [state])

  const handleToggle = useCallback(function (catId: CategoryId, itemId?: string) {
    setState(function (prev) {
      if (!prev) return prev
      const today = todayKey()
      const logs = { ...prev.logs }
      const dayLog: DayLog = logs[today] ? { ...logs[today] } : emptyDayLog()
      if (itemId) {
        const multiLog = { ...((dayLog[catId] as Record<string, boolean>) || {}) }
        multiLog[itemId] = !multiLog[itemId]
        dayLog[catId] = multiLog
      } else {
        dayLog[catId] = !dayLog[catId]
      }
      logs[today] = dayLog
      void persistLogs(logs)
      const acct = accountRef.current
      if (acct) void pushToCloud(acct, { config: prev.config, logs: logs })
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
      setState(merged)
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
      <Header showUpCount={showUpCount} />
      <Tabs currentTab={currentTab} onSelect={setCurrentTab} />
      <SyncPanel
        key={account ? account.accountNumber : 'anon'}
        account={account}
        busy={cloudBusy}
        message={cloudMsg}
        onCreate={handleCreateAccount}
        onLogin={handleLogin}
        onSignOut={handleSignOut}
      />
      {currentTab === 'today' && <TodayTab state={state} onToggle={handleToggle} />}
      {currentTab === 'progress' && <ProgressTab state={state} />}
      {currentTab === 'plan' && <PlanTab state={state} onSave={handlePlanChange} onPersist={handlePersistConfig} />}
    </div>
  )
}
