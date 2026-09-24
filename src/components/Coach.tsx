import { useState } from 'react'
import { fetchCoach, type CoachResult, type CoachSummary } from '../lib/coach'
import './coach.css'

function labelFor(summary: CoachSummary, id?: string): string | null {
  if (!id) return null
  const c = summary.categories.find((x) => x.id === id)
  return c ? c.label : null
}

export function DailyCoachCard({ summary }: { summary: CoachSummary }) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<CoachResult | null>(null)

  const isRecovery = summary.mode === 'recovery'

  async function run() {
    setLoading(true)
    setError(null)
    try {
      const r = await fetchCoach('coach', summary)
      setResult(r)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.')
    } finally {
      setLoading(false)
    }
  }

  const focusLabel = result ? labelFor(summary, result.focusCategoryId) : null

  return (
    <section className={`coach-card ${isRecovery ? 'coach-card-recovery' : ''}`} aria-label="AI coach">
      <div className="coach-head">
        <span className="coach-kicker">{isRecovery ? 'Recovery Coach' : 'Your Floor Coach'}</span>
        <span className="coach-ai-tag">AI</span>
      </div>

      {!result && !loading && !error && (
        <p className="coach-intro">
          {isRecovery
            ? 'A few days off is normal. Get one grounded nudge to reset — no pressure, no guilt.'
            : 'Get one specific, data-grounded nudge for today, based on your last 30 days.'}
        </p>
      )}

      {loading && <p className="coach-loading">Reading your last 30 days…</p>}
      {error && <p className="coach-error">{error}</p>}

      {result && !loading && (
        <div className="coach-result">
          {result.message && <p className="coach-message">{result.message}</p>}
          {result.microAction && (
            <div className="coach-action">
              <span className="coach-action-label">Two-minute move</span>
              <p className="coach-action-text">{result.microAction}</p>
            </div>
          )}
          {focusLabel && <span className="coach-focus">Focus today: {focusLabel}</span>}
        </div>
      )}

      <button type="button" className="coach-btn" onClick={run} disabled={loading}>
        {loading
          ? 'Thinking…'
          : result
            ? 'Get another nudge'
            : isRecovery
              ? 'Reset my day'
              : "Get today's nudge"}
      </button>
    </section>
  )
}

export function WeeklyReflectionCard({ summary }: { summary: CoachSummary }) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<CoachResult | null>(null)

  async function run() {
    setLoading(true)
    setError(null)
    try {
      const r = await fetchCoach('reflection', summary)
      setResult(r)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.')
    } finally {
      setLoading(false)
    }
  }

  const weakestLabel = result ? labelFor(summary, result.weakestCategoryId) : null

  return (
    <section className="coach-card coach-reflection" aria-label="AI weekly reflection">
      <div className="coach-head">
        <span className="coach-kicker">Weekly Reflection</span>
        <span className="coach-ai-tag">AI</span>
      </div>

      {!result && !loading && !error && (
        <p className="coach-intro">
          A short, honest read on your last 30 days — what is holding and what is slipping.
        </p>
      )}

      {loading && <p className="coach-loading">Reviewing your rolling window…</p>}
      {error && <p className="coach-error">{error}</p>}

      {result && !loading && (
        <div className="coach-result">
          {result.headline && <p className="coach-reflection-headline">{result.headline}</p>}
          {result.insights && result.insights.length > 0 && (
            <ul className="coach-insights">
              {result.insights.map((it, i) => (
                <li key={i}>{it}</li>
              ))}
            </ul>
          )}
          {weakestLabel && <span className="coach-focus">Needs the most support: {weakestLabel}</span>}
          {result.encouragement && <p className="coach-message">{result.encouragement}</p>}
        </div>
      )}

      <button type="button" className="coach-btn" onClick={run} disabled={loading}>
        {loading ? 'Reflecting…' : result ? 'Refresh reflection' : 'Generate reflection'}
      </button>
    </section>
  )
}

export function AdjustFloorButton({
  summary,
  categoryId,
  onApply,
}: {
  summary: CoachSummary
  categoryId: string
  onApply: (categoryId: string, floor: string, ifthen: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<CoachResult | null>(null)
  const [applied, setApplied] = useState(false)

  async function run() {
    setOpen(true)
    setLoading(true)
    setError(null)
    setApplied(false)
    setResult(null)
    try {
      const r = await fetchCoach('adjust', summary, categoryId)
      setResult(r)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.')
    } finally {
      setLoading(false)
    }
  }

  function apply() {
    if (result && result.floor) {
      onApply(categoryId, result.floor, result.ifthen || '')
      setApplied(true)
    }
  }

  return (
    <div className="coach-adjust">
      <button type="button" className="coach-adjust-trigger" onClick={run} disabled={loading}>
        {loading ? 'Rethinking your floor…' : 'Make this floor easier'}
      </button>

      {open && (result || error) && (
        <div className="coach-adjust-panel">
          {error && <p className="coach-error">{error}</p>}
          {result && (
            <>
              <div className="coach-adjust-field">
                <span className="coach-adjust-tag">Suggested floor</span>
                <p>{result.floor}</p>
              </div>
              {result.ifthen && (
                <div className="coach-adjust-field">
                  <span className="coach-adjust-tag">If-then</span>
                  <p>{result.ifthen}</p>
                </div>
              )}
              {result.rationale && <p className="coach-adjust-why">{result.rationale}</p>}
              <div className="coach-adjust-actions">
                <button type="button" className="coach-btn coach-btn-small" onClick={apply} disabled={applied}>
                  {applied ? 'Applied ✓' : 'Apply this floor'}
                </button>
                <button type="button" className="coach-adjust-dismiss" onClick={() => setOpen(false)}>
                  Dismiss
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
