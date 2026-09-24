import { v } from "convex/values";
import { action } from "./_generated/server";

// Gemini chat for The Floor's AI coach drawer.
// AI Studio's original version served this from an Express server (server.ts),
// which can't run on Freebuff's static hosting — so it lives here instead.
// The GEMINI_API_KEY is read from the Convex deployment env and never reaches the browser.

const GEMINI_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";
// Try modern Flash models in order; fall back if a model id is unavailable on the key.
const MODEL_CANDIDATES = ["gemini-2.5-flash", "gemini-2.0-flash", "gemini-flash-latest"];

const SYSTEM_INSTRUCTION = `You are Gemini, a live, intelligent, and natural conversational coach embedded inside "The Floor" habit tracking app.

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
- The 4 Categories: Physical, Study, Diet, Digital.

CURRENT USER APP STATE (Background Reference):
`;

type ChatMessage = { role: string; content: string };

async function callGemini(
  apiKey: string,
  model: string,
  systemInstruction: string,
  contents: { role: "user" | "model"; parts: { text: string }[] }[],
): Promise<string> {
  const res = await fetch(`${GEMINI_ENDPOINT}/${model}:generateContent?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemInstruction }] },
      contents,
      generationConfig: { temperature: 0.7 },
    }),
  });
  if (!res.ok) {
    const raw = await res.text().catch(() => "");
    let msg = raw;
    try {
      const parsed = JSON.parse(raw);
      if (parsed?.error?.message) msg = parsed.error.message;
    } catch {}
    throw new Error(`Gemini ${model} failed (${res.status}): ${msg}`);
  }
  const data = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  const parts = data.candidates?.[0]?.content?.parts ?? [];
  return parts.map((p) => p.text ?? "").join("");
}

export const chat = action({
  args: {
    messages: v.array(v.object({ role: v.string(), content: v.string() })),
    context: v.optional(v.string()),
  },
  handler: async (_ctx, args) => {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey || apiKey === "MY_GEMINI_API_KEY") {
      throw new Error(
        "Gemini is not configured yet. Add a GEMINI_API_KEY (from aistudio.google.com/apikey) to the Convex deployment.",
      );
    }

    // Keep the thread bounded and map roles to Gemini's user/model format.
    const recent: ChatMessage[] = args.messages.slice(-20);
    const contents = recent.map((m) => ({
      role: (m.role === "assistant" || m.role === "model" ? "model" : "user") as "user" | "model",
      parts: [{ text: String(m.content).slice(0, 4000) }],
    }));

    const systemInstruction = SYSTEM_INSTRUCTION + (args.context || "No specific state provided.");

    let lastErr: unknown = null;
    for (const model of MODEL_CANDIDATES) {
      try {
        const reply = await callGemini(apiKey, model, systemInstruction, contents);
        if (reply) return { reply };
      } catch (err) {
        lastErr = err;
      }
    }

    const msg = lastErr instanceof Error ? lastErr.message : "Failed to communicate with Gemini";
    throw new Error(msg);
  },
});
