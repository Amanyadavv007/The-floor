import express from 'express'
import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'
import { GoogleGenAI } from '@google/genai'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const app = express()
app.use(express.json({ limit: '2mb' }))

const port = Number(process.env.PORT) || 3000

// Resolve the actual Gemini API key, handling any container dev environment placeholder
function resolveGeminiApiKey(): string | undefined {
  let key = process.env.GEMINI_API_KEY
  if (!key || key === 'MY_GEMINI_API_KEY' || key.trim() === '') {
    try {
      if (fs.existsSync('/app/.dev.env.json')) {
        const raw = fs.readFileSync('/app/.dev.env.json', 'utf8')
        const parsed = JSON.parse(raw)
        if (parsed.GEMINI_API_KEY && parsed.GEMINI_API_KEY !== 'MY_GEMINI_API_KEY') {
          key = parsed.GEMINI_API_KEY
        }
      }
    } catch (e) {
      console.warn('Could not read /app/.dev.env.json:', e)
    }
  }
  return key
}

function getGeminiClient(): GoogleGenAI {
  const apiKey = resolveGeminiApiKey()
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  })
}

// Gemini multi-turn chat endpoint with full app context
app.post('/api/gemini/chat', async (req, res) => {
  try {
    const { messages, context } = req.body

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'Messages array is required' })
    }

    const ai = getGeminiClient()

    const systemInstruction = `You are Gemini, a live, intelligent, and natural conversational coach embedded inside "The Floor" habit tracking app.

CRITICAL BEHAVIOR:
- You are an actual real-time conversational AI. Respond DIRECTLY and NATURALLY to what the user said.
- If the user says "hello", "hi", or casual greetings, do NOT dump unprompted lectures or full state analyses. Greet them warmly and briefly (1-2 sentences) like a real human coach.
- Use the app state below as BACKGROUND KNOWLEDGE. Only reference specific numbers, floors, or metrics when relevant to the user's questions or when they ask for advice, analysis, or help.
- Never give canned boilerplate or repetitive pre-written scripts. Match the user's tone and query length.

CORE APP PRINCIPLES (The Floor):
- Anti-Guilt & Rolling Consistency: We track rolling 30-day show-up counts (e.g., 25/30 days). Perfection is never required; securing at least 1 floor counts as showing up.
- Floor vs Ideal:
  * Floor = non-negotiable bare minimum (e.g. 5 pushups, 2 minutes reading) when tired, sick, or busy.
  * Ideal = aspirational target when energy is high.
- Recovery Protocol: When returning after 3+ missed days, the goal is just ONE floor to eliminate inertia.
- The 4 Categories: Physical, Study, Diet, English speaking practice.

CURRENT USER APP STATE (Background Reference):
${context || 'No specific state provided.'}`

    // Format messages for @google/genai
    const contents = messages.map((m: { role: string; content: string }) => ({
      role: m.role === 'assistant' || m.role === 'model' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }))

    let reply = ''
    try {
      // Use gemini-3.5-flash as primary
      const response = await ai.models.generateContent({
        model: 'gemini-3.5-flash',
        contents,
        config: {
          systemInstruction,
          temperature: 0.7,
        },
      })
      reply = response.text || ''
    } catch (primaryErr: any) {
      console.warn('Primary model gemini-3.5-flash failed, trying gemini-3.1-flash-lite...', primaryErr?.message)
      const fallbackResponse = await ai.models.generateContent({
        model: 'gemini-3.1-flash-lite',
        contents,
        config: {
          systemInstruction,
          temperature: 0.7,
        },
      })
      reply = fallbackResponse.text || ''
    }

    if (!reply) {
      reply = 'I could not generate a response. Please try again.'
    }

    res.json({ reply })
  } catch (err: any) {
    console.error('Gemini chat error:', err)
    let rawMsg = err?.message || 'Failed to communicate with Gemini'
    if (typeof rawMsg === 'string' && rawMsg.trim().startsWith('{')) {
      try {
        const parsed = JSON.parse(rawMsg)
        if (parsed?.error?.message) rawMsg = parsed.error.message
      } catch (_) {}
    }
    res.status(500).json({ error: rawMsg })
  }
})

// Setup Vite dev server middleware or serve static files in production
const isProd = process.env.NODE_ENV === 'production'
if (!isProd) {
  const { createServer } = await import('vite')
  const vite = await createServer({
    server: { middlewareMode: true, host: '0.0.0.0' },
    appType: 'spa',
  })
  app.use(vite.middlewares)
} else {
  app.use(express.static(path.resolve(__dirname, 'dist')))
  app.get('*', (_req, res) => {
    res.sendFile(path.resolve(__dirname, 'dist', 'index.html'))
  })
}

app.listen(port, '0.0.0.0', () => {
  console.log(`The Floor server listening on port ${port}`)
})
