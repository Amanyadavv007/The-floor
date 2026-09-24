import { ConvexHttpClient } from 'convex/browser'
import { api } from '../convex/_generated/api'
import type { Config, DayLog, State } from '../types'
import { deriveCredentials } from './crypto'

// Thin wrapper over the Convex backend for account sync.
// The deployment URL is public app configuration (never a secret), so it is
// hardcoded as a fallback to guarantee every build — preview or production —
// points at the right backend. VITE_CONVEX_URL can still override it.
const CONVEX_URL =
  (import.meta.env.VITE_CONVEX_URL as string | undefined) || 'https://usable-parrot-39.convex.cloud'

/** Shown in the UI so a sync failure always reveals which backend was used. */
export const SYNC_BACKEND_URL = CONVEX_URL

export interface AccountSession {
  accountNumber: string
  salt: string
  passwordHash: string
}

export type AuthResult =
  | { ok: true; config: Config | null; logs: Record<string, DayLog> | null; updatedAt: number; session?: AccountSession }
  | { ok: false; error: string }

let client: ConvexHttpClient | null = null
function getClient(): ConvexHttpClient | null {
  if (!CONVEX_URL) return null
  if (!client) client = new ConvexHttpClient(CONVEX_URL)
  return client
}

export function cloudAvailable(): boolean {
  return !!CONVEX_URL
}

export async function createAccountOnCloud(
  accountNumber: string,
  password: string,
  state: State,
): Promise<AuthResult> {
  const c = getClient()
  if (!c) return { ok: false, error: 'Cloud sync is not configured yet.' }
  try {
    if (!crypto?.subtle) {
      return { ok: false, error: 'This browser blocked secure cryptography (the page must be opened over HTTPS). Reopen the site with https:// in the address bar.' }
    }
    const creds = await deriveCredentials(password)
    const res = await c.mutation(api.sync.createAccount, {
      accountNumber,
      passwordHash: creds.passwordHash,
      passwordSalt: creds.salt,
      config: state.config,
      logs: state.logs,
    })
    if (!res.ok) return { ok: false, error: res.error }
    return {
      ok: true,
      config: null,
      logs: null,
      updatedAt: Date.now(),
      session: { accountNumber: accountNumber.trim(), salt: creds.salt, passwordHash: creds.passwordHash },
    }
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e)
    console.error('create account failed', e)
    return { ok: false, error: 'Sync call failed: ' + detail + ' (backend: ' + CONVEX_URL + ')' }
  }
}

export async function loginToCloud(accountNumber: string, password: string): Promise<AuthResult> {
  const c = getClient()
  if (!c) return { ok: false, error: 'Cloud sync is not configured yet.' }
  const acct = accountNumber.trim()
  try {
    // Salt lives server-side; the login flow is two-step: ask for the salt,
    // derive the hash locally, then let the server verify it.
    const saltRes = await c.query(api.sync.getSalt, { accountNumber: acct })
    if (!saltRes.ok) return { ok: false, error: saltRes.error }
    const creds = await deriveCredentials(password, saltRes.salt)
    const res = await c.query(api.sync.login, { accountNumber: acct, passwordHash: creds.passwordHash })
    if (!res.ok) return { ok: false, error: res.error }
    return {
      ok: true,
      config: res.config,
      logs: res.logs,
      updatedAt: res.updatedAt,
      session: { accountNumber: acct, salt: creds.salt, passwordHash: creds.passwordHash },
    }
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e)
    console.error('login failed', e)
    return { ok: false, error: 'Sync call failed: ' + detail + ' (backend: ' + CONVEX_URL + ')' }
  }
}

export interface PullResult {
  ok: boolean
  found: boolean
  config: Config | null
  logs: Record<string, DayLog> | null
  updatedAt: number
}

// Authenticated read of the account's cloud state. Used by the live poll loop
// so a device that is already signed in picks up changes made on other devices.
export async function pullFromCloud(session: AccountSession): Promise<PullResult> {
  const c = getClient()
  if (!c) return { ok: false, found: false, config: null, logs: null, updatedAt: 0 }
  try {
    const res = await c.query(api.sync.login, {
      accountNumber: session.accountNumber,
      passwordHash: session.passwordHash,
    })
    if (!res.ok) return { ok: false, found: false, config: null, logs: null, updatedAt: 0 }
    return { ok: true, found: true, config: res.config, logs: res.logs, updatedAt: res.updatedAt }
  } catch (e) {
    console.error('cloud pull failed', e)
    return { ok: false, found: false, config: null, logs: null, updatedAt: 0 }
  }
}

export async function pushToCloud(session: AccountSession, state: State): Promise<boolean> {
  const c = getClient()
  if (!c) return false
  try {
    const res = await c.mutation(api.sync.push, {
      accountNumber: session.accountNumber,
      passwordHash: session.passwordHash,
      config: state.config,
      logs: state.logs,
    })
    return res.ok
  } catch (e) {
    console.error('cloud push failed', e)
    return false
  }
}

// ---------------------------------------------------------------------------
// Gemini AI coach
// ---------------------------------------------------------------------------

/**
 * Send the chat thread (plus live app context) to Gemini through the Convex
 * backend, which holds the GEMINI_API_KEY server-side. Replaces AI Studio's
 * /api/gemini/chat Express endpoint, which cannot run on Freebuff's static
 * hosting.
 */
export async function askGemini(
  messages: { role: string; content: string }[],
  context: string,
): Promise<{ reply: string }> {
  const c = getClient()
  if (!c) throw new Error('Gemini is not configured yet (no backend URL).')
  try {
    return await c.action(api.gemini.chat, { messages, context })
  } catch (err: any) {
    let msg: string = err?.message || err?.toString() || 'Failed to reach Gemini. Please try again.'
    if (typeof msg === 'string' && msg.trim().startsWith('{')) {
      try {
        const parsed = JSON.parse(msg)
        if (parsed?.error?.message) msg = parsed.error.message
        else if (parsed?.message) msg = parsed.message
      } catch (_) {}
    }
    throw new Error(msg)
  }
}
