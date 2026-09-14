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
}

export async function loginToCloud(accountNumber: string, password: string): Promise<AuthResult> {
  const c = getClient()
  if (!c) return { ok: false, error: 'Cloud sync is not configured yet.' }
  const acct = accountNumber.trim()
  // Salt lives server-side; fetch it by deriving with a placeholder first is not
  // possible, so the login flow uses a two-step: ask for the salt, then verify.
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
