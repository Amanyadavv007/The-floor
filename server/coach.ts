import { generateObject } from 'ai'
import { z } from 'zod'
import type { IncomingMessage } from 'node:http'

// A fast, capable Gemini model routed through the Vercel AI Gateway. Plain
// `provider/model` strings resolve to the Gateway automatically; auth comes
// from AI_GATEWAY_API_KEY / OIDC with no per-call key handling.
const MODEL = 'google/gemini-2.5-flash'

interface CoachCategoryInput {
  id: string
  label: string
  floor: string
  ifthen: string
  count30: number
}
interface CoachSummary {
  mode: 'normal' | 'recovery'
  showUpCount: number
  todayCount: number
  daysTracked: number
  categories: CoachCategoryInput[]
}
interface CoachRequestBody {
  kind: 'coach' | 'reflection' | 'adjust'
  summary: CoachSummary
  categoryId?: string
}

const SYSTEM = `You are the coach inside "The Floor", a habit app built on one principle: keep a daily "floor" — a version of each habit so small you cannot fail — instead of chasing perfect streaks. On hard days people drop to the floor, and that still counts as showing up.

Voice and rules:
- Warm, direct, grounded. Talk like a level-headed friend, not a hype coach.
- Never shame, guilt, or scold. Missing days is expected and completely fine.
- Ground everything you say in the specific numbers you are given. Name real categories.
- When you suggest a next step, make it SMALLER and more concrete than what they already have — never bigger or more ambitious.
- Plain language. No emojis. No generic motivational filler or clichés.`

function summaryToText(s: CoachSummary): string {
  const cats = s.categories
    .map(
      (c) =>
        `- ${c.label} (id: ${c.id}): floor met on ${c.count30} of the last 30 days. Current floor: "${c.floor}". If-then plan: "${c.ifthen || 'none set'}".`,
    )
    .join('\n')
  return `Mode: ${
    s.mode === 'recovery'
      ? 'RECOVERY (they have missed every floor for the last 3 days)'
      : 'normal'
  }.
Show-up momentum: ${s.showUpCount} of the last 30 days had at least one floor met.
Today so far: ${s.todayCount} of 4 floors met.
Total days ever active: ${s.daysTracked}.
Categories:
${cats}`
}

export async function runCoach(body: CoachRequestBody) {
  if (!body || !body.summary || !Array.isArray(body.summary.categories)) {
    throw new Error('Invalid request')
  }
  const s = body.summary
  const ctx = summaryToText(s)

  if (body.kind === 'reflection') {
    const { object } = await generateObject({
      model: MODEL,
      system: SYSTEM,
      schema: z.object({
        headline: z.string().describe('One honest, specific line summarizing the last 30 days.'),
        insights: z
          .array(z.string())
          .min(2)
          .max(3)
          .describe('2-3 concrete observations grounded in the numbers: what is working and what is slipping.'),
        weakestCategoryId: z.string().describe('The id of the category that needs the most support.'),
        encouragement: z.string().describe('One or two sentences of grounded encouragement for the week ahead.'),
      }),
      prompt: `${ctx}\n\nWrite a short weekly reflection on their last 30 days.`,
    })
    return { kind: 'reflection', ...object }
  }

  if (body.kind === 'adjust') {
    const target = s.categories.find((c) => c.id === body.categoryId) || s.categories[0]
    const { object } = await generateObject({
      model: MODEL,
      system: SYSTEM,
      schema: z.object({
        floor: z
          .string()
          .describe('A rewritten floor for this category that is even easier and more concrete — a cannot-fail minimum. One short sentence.'),
        ifthen: z
          .string()
          .describe('A matching if-then plan in the form: "If [likely obstacle], then [tiny recovery action]."'),
        rationale: z
          .string()
          .describe('One sentence on why this smaller floor will stick better, referencing their data.'),
      }),
      prompt: `${ctx}\n\nThe user wants the floor for "${target.label}" (id: ${target.id}) to be easier to hit consistently. It has been met on ${target.count30} of the last 30 days. Current floor: "${target.floor}". Propose a smaller, stickier floor and a matching if-then plan.`,
    })
    return { kind: 'adjust', categoryId: target.id, ...object }
  }

  // Default: today's coaching nudge.
  const { object } = await generateObject({
    model: MODEL,
    system: SYSTEM,
    schema: z.object({
      message: z
        .string()
        .describe('1-2 sentences. In recovery mode, acknowledge the dip without judgment and point to the floor. Otherwise reinforce real momentum. Reference their actual numbers.'),
      microAction: z
        .string()
        .describe('One concrete action they can finish in under two minutes today. Smaller than their floor.'),
      focusCategoryId: z
        .string()
        .describe('The id of the single category most worth attention today (usually the weakest).'),
    }),
    prompt: `${ctx}\n\nGive today's single coaching nudge.`,
  })
  return { kind: 'coach', ...object }
}

// Body reader shared by the Vercel serverless function and the Vite dev
// middleware. Handles pre-parsed bodies (Vercel) and raw streams (dev).
export async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const anyReq = req as unknown as { body?: unknown }
  if (anyReq.body && typeof anyReq.body === 'object') return anyReq.body
  if (typeof anyReq.body === 'string') {
    try {
      return JSON.parse(anyReq.body)
    } catch {
      return {}
    }
  }
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
  const raw = Buffer.concat(chunks).toString('utf8')
  return raw ? JSON.parse(raw) : {}
}
