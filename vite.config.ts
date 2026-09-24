import { defineConfig, loadEnv, type PluginOption } from 'vite'
import react from '@vitejs/plugin-react'
import { runCoach, readJsonBody } from './server/coach'

// Dev-only handler for /api/coach so the AI coach works in the Vite preview.
// In production the matching Vercel serverless function at api/coach.ts runs
// instead. Both call the same runCoach() in server/coach.ts.
function coachDevApi(): PluginOption {
  return {
    name: 'coach-dev-api',
    configureServer(server) {
      server.middlewares.use('/api/coach', async (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405
          res.end('Method Not Allowed')
          return
        }
        try {
          const body = await readJsonBody(req)
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
      })
    },
  }
}

export default defineConfig(({ mode }) => {
  // Vite does not expose non-VITE_ vars to the dev server's process.env, so
  // load AI_GATEWAY_API_KEY explicitly and hand it to the SDK's zero-config
  // auth. Never exposed to the client — only used in the dev middleware.
  const env = loadEnv(mode, process.cwd(), '')
  if (env.AI_GATEWAY_API_KEY && !process.env.AI_GATEWAY_API_KEY) {
    process.env.AI_GATEWAY_API_KEY = env.AI_GATEWAY_API_KEY
  }

  return {
    plugins: [react(), coachDevApi()],
    server: {
      host: '0.0.0.0',
      port: 3000,
      allowedHosts: ['.vercel.run'],
    },
  }
})
