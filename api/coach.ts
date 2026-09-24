import { runCoach, readJsonBody } from '../server/coach'

// Vercel serverless function (Node runtime). Vercel auto-detects the `api/`
// directory for any framework, including this Vite SPA. AI_GATEWAY_API_KEY is
// injected by the platform, so the AI SDK authenticates with zero config.
export default async function handler(
  req: { method?: string; body?: unknown; [key: string]: unknown },
  res: {
    statusCode: number
    setHeader: (k: string, v: string) => void
    end: (body?: string) => void
  },
) {
  if (req.method !== 'POST') {
    res.statusCode = 405
    res.end('Method Not Allowed')
    return
  }
  try {
    const body = await readJsonBody(req as unknown as import('node:http').IncomingMessage)
    const result = await runCoach(body as Parameters<typeof runCoach>[0])
    res.statusCode = 200
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify(result))
  } catch (e) {
    res.statusCode = 500
    res.setHeader('content-type', 'application/json')
    res.end(
      JSON.stringify({
        error: e instanceof Error ? e.message : 'The coach is unavailable right now.',
      }),
    )
  }
}
