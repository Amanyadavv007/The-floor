import { useState } from 'react'
import type { State } from '../types'
import {
  generateClaudeDailyBriefing,
  generateClaudeSystemPrompt,
  generateClaudeProjectKnowledge,
  copyToClipboard,
} from '../lib/claudeIntegration'

export interface ClaudeModalProps {
  state: State
  initialTab?: 'briefing' | 'prompt' | 'project'
  onClose: () => void
}

export function ClaudeModal({ state, initialTab = 'briefing', onClose }: ClaudeModalProps) {
  const [activeTab, setActiveTab] = useState<'briefing' | 'prompt' | 'project'>(initialTab)
  const [copiedKey, setCopiedKey] = useState<string | null>(null)

  const briefingText = generateClaudeDailyBriefing(state)
  const promptText = generateClaudeSystemPrompt()
  const projectText = generateClaudeProjectKnowledge(state)

  const handleCopy = async (text: string, key: string) => {
    const ok = await copyToClipboard(text)
    if (ok) {
      setCopiedKey(key)
      setTimeout(() => setCopiedKey(null), 2500)
    }
  }

  const handleDownloadFile = () => {
    try {
      const blob = new Blob([projectText], { type: 'text/markdown;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'the-floor-claude-knowledge.md'
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch (e) {
      console.error('Download failed', e)
    }
  }

  return (
    <div className="claude-modal-backdrop" onClick={onClose} role="dialog" aria-modal="true">
      <div className="claude-modal-card" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="claude-modal-head">
          <div className="claude-modal-title-wrap">
            <div className="claude-modal-badge">
              <span className="claude-modal-dot" aria-hidden="true" />
              <span>Claude Companion</span>
            </div>
            <h3 className="claude-modal-title">Sync Your Floors with Claude</h3>
            <p className="claude-modal-sub">
              Give Claude your real-time 30-day baseline and today's floors for personalized, anti-guilt coaching.
            </p>
          </div>
          <button
            type="button"
            className="claude-modal-close-btn"
            onClick={onClose}
            aria-label="Close Claude modal"
          >
            ✕
          </button>
        </div>

        {/* Tab switcher */}
        <div className="claude-modal-tabs">
          <button
            type="button"
            className={`claude-modal-tab-btn ${activeTab === 'briefing' ? 'active' : ''}`}
            onClick={() => setActiveTab('briefing')}
          >
            📋 Daily Briefing
          </button>
          <button
            type="button"
            className={`claude-modal-tab-btn ${activeTab === 'prompt' ? 'active' : ''}`}
            onClick={() => setActiveTab('prompt')}
          >
            🧠 Coach Instructions
          </button>
          <button
            type="button"
            className={`claude-modal-tab-btn ${activeTab === 'project' ? 'active' : ''}`}
            onClick={() => setActiveTab('project')}
          >
            📁 Project Knowledge
          </button>
        </div>

        {/* Tab Content */}
        <div className="claude-modal-body">
          {activeTab === 'briefing' && (
            <div className="claude-tab-content">
              <div className="claude-card-lead">
                <p>
                  Paste this into your Claude chat anytime. Claude will instantly see which floors are secured, which are pending, and your rolling 30-day momentum.
                </p>
                <div className="claude-actions-row">
                  <button
                    type="button"
                    className={`claude-primary-btn ${copiedKey === 'briefing' ? 'copied' : ''}`}
                    onClick={() => handleCopy(briefingText, 'briefing')}
                  >
                    {copiedKey === 'briefing' ? '✓ Copied to Clipboard!' : '📋 Copy Today’s Briefing'}
                  </button>
                </div>
              </div>

              <div className="claude-code-container">
                <div className="claude-code-header">
                  <span className="claude-code-label">Generated Markdown Briefing</span>
                  <button
                    type="button"
                    className="claude-code-quick-copy"
                    onClick={() => handleCopy(briefingText, 'briefing-mini')}
                  >
                    {copiedKey === 'briefing-mini' ? '✓ Copied' : 'Copy'}
                  </button>
                </div>
                <pre className="claude-code-block">
                  <code>{briefingText}</code>
                </pre>
              </div>

              <div className="claude-suggested-prompts">
                <span className="claude-prompt-label">Quick Prompts to send with this:</span>
                <div className="claude-prompt-chips">
                  <button
                    type="button"
                    className="claude-prompt-chip"
                    onClick={() => handleCopy(`${briefingText}\n\nWhat is the single lowest-friction 2-minute floor I should do right now?`, 'chip-1')}
                  >
                    <span>"What’s the lowest-friction 2-minute floor right now?"</span>
                    <span className="chip-copy-indicator">{copiedKey === 'chip-1' ? '✓' : '⎘'}</span>
                  </button>
                  <button
                    type="button"
                    className="claude-prompt-chip"
                    onClick={() => handleCopy(`${briefingText}\n\nI feel exhausted today. Walk me through my bare minimum floor without lecturing me about the ideal ceiling.`, 'chip-2')}
                  >
                    <span>"I feel exhausted today. Help me do the bare minimum floor."</span>
                    <span className="chip-copy-indicator">{copiedKey === 'chip-2' ? '✓' : '⎘'}</span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'prompt' && (
            <div className="claude-tab-content">
              <div className="claude-card-lead">
                <p>
                  Copy and paste this into <b>Claude's Custom Instructions</b> or your <b>Claude Project Instructions</b>. This programs Claude to coach you using <i>The Floor's</i> philosophy (anti-guilt, rolling 30-day baselines, and recovery mode).
                </p>
                <div className="claude-actions-row">
                  <button
                    type="button"
                    className={`claude-primary-btn ${copiedKey === 'prompt' ? 'copied' : ''}`}
                    onClick={() => handleCopy(promptText, 'prompt')}
                  >
                    {copiedKey === 'prompt' ? '✓ Copied System Instructions!' : '🧠 Copy Coach Instructions'}
                  </button>
                </div>
              </div>

              <div className="claude-code-container">
                <div className="claude-code-header">
                  <span className="claude-code-label">System Instructions for Claude</span>
                  <button
                    type="button"
                    className="claude-code-quick-copy"
                    onClick={() => handleCopy(promptText, 'prompt-mini')}
                  >
                    {copiedKey === 'prompt-mini' ? '✓ Copied' : 'Copy'}
                  </button>
                </div>
                <pre className="claude-code-block">
                  <code>{promptText}</code>
                </pre>
              </div>
            </div>
          )}

          {activeTab === 'project' && (
            <div className="claude-tab-content">
              <div className="claude-card-lead">
                <p>
                  If you use <b>Claude Projects</b> (available on claude.ai), upload this Markdown document into your Project Knowledge. Claude will remember your 4 floor definitions and If-Then rules across all future conversations.
                </p>
                <div className="claude-actions-row">
                  <button
                    type="button"
                    className="claude-primary-btn"
                    onClick={handleDownloadFile}
                  >
                    📥 Download floor-knowledge.md
                  </button>
                  <button
                    type="button"
                    className={`claude-secondary-btn ${copiedKey === 'project' ? 'copied' : ''}`}
                    onClick={() => handleCopy(projectText, 'project')}
                  >
                    {copiedKey === 'project' ? '✓ Copied Markdown!' : '⎘ Copy Markdown'}
                  </button>
                </div>
              </div>

              <div className="claude-code-container">
                <div className="claude-code-header">
                  <span className="claude-code-label">Project Knowledge Document</span>
                  <button
                    type="button"
                    className="claude-code-quick-copy"
                    onClick={() => handleCopy(projectText, 'project-mini')}
                  >
                    {copiedKey === 'project-mini' ? '✓ Copied' : 'Copy'}
                  </button>
                </div>
                <pre className="claude-code-block">
                  <code>{projectText}</code>
                </pre>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="claude-modal-footer">
          <span className="claude-footer-hint">
            💡 Tip: You can paste the briefing into any Claude conversation, Claude Mobile, or Claude Desktop.
          </span>
          <button type="button" className="claude-close-action" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  )
}
