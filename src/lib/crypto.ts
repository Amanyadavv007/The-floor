// Password handling happens in the browser with PBKDF2 (Web Crypto API).
// Only the derived hash and a random salt ever leave the device — never the
// password itself. Every cloud call must send the correct passwordHash, so a
// stolen account number alone can't read or write anyone's progress.

const ITERATIONS = 310000

export interface DerivedCredentials {
  salt: string
  passwordHash: string
}

function toArrayBuffer(data: Uint8Array): ArrayBuffer {
  const buf = new ArrayBuffer(data.byteLength)
  new Uint8Array(buf).set(data)
  return buf
}

function toHex(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf)
  let s = ''
  for (let i = 0; i < bytes.length; i++) s += bytes[i].toString(16).padStart(2, '0')
  return s
}

export function randomSalt(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return toHex(toArrayBuffer(bytes))
}

export async function deriveCredentials(password: string, salt?: string): Promise<DerivedCredentials> {
  const useSalt = salt ?? randomSalt()
  const enc = new TextEncoder()
  const keyMaterial = await crypto.subtle.importKey('raw', toArrayBuffer(enc.encode(password)), 'PBKDF2', false, [
    'deriveBits',
  ])
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: toArrayBuffer(enc.encode(useSalt)), iterations: ITERATIONS },
    keyMaterial,
    256,
  )
  return { salt: useSalt, passwordHash: toHex(bits) }
}

