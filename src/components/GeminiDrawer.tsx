import React, { useState, useEffect, useRef } from 'react'
import type { State } from '../types'
import { generateGeminiContext, todayKey } from '../lib/geminiContext'
import { askGemini } from '../lib/cloud'

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: string
}

interface GeminiDrawerProps {
  isOpen: boolean
  onClose: () => void
  state: State
}

const DEFAULT_GREETING: ChatMessage = {
  id: 'greeting',
  role: 'assistant',
  content: "Hi! I'm Gemini, your resilience & baseline coach for **The Floor**. I have real-time awareness of your 30-day rolling consistency, today's checked floors, and your If-Then rules. How are you feeling today?",
  timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
}

const QUICK_PROMPTS = [
  "What's the lowest-friction 2-minute floor for my pending tasks?",
  "Review my 30-day consistency and give me realistic feedback.",
  "I'm feeling exhausted today. Walk me through the bare minimum.",
  "How can my If-Then plan rescue me right now?",
]

export function GeminiDrawer({ isOpen, onClose, state }: GeminiDrawerProps) {
  const [messages, setMessages] = useState<ChatMessage[]>(() => {
    try {
      const saved = localStorage.getItem('the_floor_gemini_chat')
      if (saved) {
        const parsed = JSON.parse(saved)
        if (Array.isArray(parsed) && parsed.length > 0) return parsed
      }
    } catch (e) {}
    return [DEFAULT_GREETING]
  })

  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  // Persist chat in localStorage
  useEffect(() => {
    try {
      localStorage.setItem('the_floor_gemini_chat', JSON.stringify(messages))
    } catch (e) {}
  }, [messages])

  // Scroll to bottom when messages change or drawer opens
  useEffect(() => {
    if (isOpen) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
      setTimeout(() => inputRef.current?.focus(), 150)
    }
  }, [messages, isOpen])

  // Keyboard navigation: Escape closes drawer
  useEffect(() => {
    if (!isOpen) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose])

  const handleSend = async (textToSend?: string) => {
    const text = (textToSend ?? input).trim()
    if (!text || loading) return

    setError(null)
    const userMsg: ChatMessage = {
      id: String(Date.now()),
      role: 'user',
      content: text,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    }

    const updatedMessages = [...messages, userMsg]
    setMessages(updatedMessages)
    setInput('')
    setLoading(true)

    try {
      const liveContext = generateGeminiContext(state)

      // Ask Gemini through the Convex backend (holds the API key server-side)
      const data = await askGemini(
        updatedMessages.map((m) => ({ role: m.role, content: m.content })),
        liveContext,
      )
      const botMsg: ChatMessage = {
        id: String(Date.now() + 1),
        role: 'assistant',
        content: data.reply || "I'm ready whenever you are.",
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      }

      setMessages((prev) => [...prev, botMsg])
    } catch (err: any) {
      console.error('Chat error:', err)
      setError(err?.message || 'Failed to reach Gemini. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  const handleKeyDownInput = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const handleResetChat = () => {
    if (window.confirm('Clear your conversation with Gemini?')) {
      setMessages([DEFAULT_GREETING])
      setError(null)
      try {
        localStorage.removeItem('the_floor_gemini_chat')
      } catch (e) {}
    }
  }

  if (!isOpen) return null

  // Compute live context summary for the drawer header
  const today = todayKey()
  const todayLog = state.logs[today]
  let metToday = 0
  for (const catId of ['physical', 'study', 'diet', 'english'] as const) {
    const val = todayLog?.[catId]
    if (val && (typeof val !== 'object' || Object.values(val).some(Boolean))) {
      metToday++
    }
  }

  return (
    <div className="gemini-drawer-backdrop" onClick={onClose} role="dialog" aria-modal="true">
      <div className="gemini-drawer" onClick={(e) => e.stopPropagation()}>
        {/* Drawer Header */}
        <div className="gemini-drawer-head">
          <div className="gemini-drawer-title-group">
            <div className="gemini-drawer-badge">
              <span className="gemini-pulse-dot" aria-hidden="true" />
              <span>Gemini Coach</span>
            </div>
            <h2 className="gemini-drawer-title">Real-Time Assistant</h2>
            <div className="gemini-context-pill" title="Gemini has full live context of your habits and logs">
              <span className="gemini-context-icon">⚡</span>
              <span>Live Context: Today {metToday}/4 floors met</span>
            </div>
          </div>

          <div className="gemini-drawer-head-actions">
            <button
              type="button"
              className="gemini-reset-btn"
              onClick={handleResetChat}
              title="Reset conversation"
              aria-label="Clear chat"
            >
              ↺ Reset
            </button>
            <button
              type="button"
              className="gemini-drawer-close"
              onClick={onClose}
              aria-label="Close Gemini chat"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Scrollable Message Thread */}
        <div className="gemini-drawer-messages">
          {messages.map((msg) => (
            <div
              key={msg.id}
              className={`gemini-message-row ${msg.role === 'user' ? 'user' : 'assistant'}`}
            >
              <div className="gemini-message-bubble">
                <div className="gemini-message-role">
                  <span>{msg.role === 'user' ? 'You' : '✦ Gemini'}</span>
                  <span className="gemini-message-time">{msg.timestamp}</span>
                </div>
                <div className="gemini-message-content">
                  {msg.content.split('\n').map((line, idx) => (
                    <p key={idx}>{line}</p>
                  ))}
                </div>
              </div>
            </div>
          ))}

          {loading && (
            <div className="gemini-message-row assistant">
              <div className="gemini-message-bubble loading">
                <div className="gemini-typing-indicator">
                  <span />
                  <span />
                  <span />
                </div>
                <span className="gemini-typing-text">Gemini is analyzing your baseline…</span>
              </div>
            </div>
          )}

          {error && (
            <div className="gemini-error-banner">
              <span>⚠️ {error}</span>
              <button
                type="button"
                className="gemini-retry-btn"
                onClick={() => handleSend(messages[messages.length - 1]?.content)}
              >
                Retry
              </button>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Quick Suggestion Chips */}
        <div className="gemini-chips-bar">
          <div className="gemini-chips-scroll">
            {QUICK_PROMPTS.map((prompt, i) => (
              <button
                key={i}
                type="button"
                className="gemini-chip"
                onClick={() => handleSend(prompt)}
                disabled={loading}
              >
                {prompt}
              </button>
            ))}
          </div>
        </div>

        {/* Input Form */}
        <div className="gemini-drawer-foot">
          <form
            className="gemini-input-form"
            onSubmit={(e) => {
              e.preventDefault()
              handleSend()
            }}
          >
            <textarea
              ref={inputRef}
              className="gemini-textarea"
              placeholder="Ask about your floors, energy, or today's plan… (Enter to send)"
              rows={2}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDownInput}
              disabled={loading}
            />
            <button
              type="submit"
              className="gemini-send-btn"
              disabled={!input.trim() || loading}
              aria-label="Send message"
            >
              {loading ? '…' : 'Send'}
            </button>
          </form>
          <div className="gemini-foot-hint">
            Always aware of your rolling momentum, current floors, and recovery status.
          </div>
        </div>
      </div>
    </div>
  )
}
