import { PERSONA } from "./persona";

export type ChatMessage = { role: "user" | "assistant"; content: string };

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";

class ProviderError extends Error {
  status?: number;
  detail?: string;
  constructor(message: string, status?: number, detail?: string) {
    super(message);
    this.status = status;
    this.detail = detail;
  }
}

type OAIMessage = { role: "system" | "user" | "assistant"; content: string };

async function callOpenAICompatible(
  url: string,
  key: string,
  model: string,
  messages: OAIMessage[]
): Promise<string> {
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model, temperature: 0.8, max_tokens: 500, messages }),
  });
  if (!res.ok) {
    const detail = await res.text();
    throw new ProviderError(`HTTP ${res.status}`, res.status, detail);
  }
  const data = await res.json();
  const reply: string = data?.choices?.[0]?.message?.content?.trim() ?? "";
  if (!reply) throw new ProviderError("empty reply");
  return reply;
}

/**
 * Generate a reply. Tries Groq first; on any failure (rate limit, outage),
 * falls back to Gemini when GEMINI_API_KEY is set.
 */
export async function generate(
  history: ChatMessage[]
): Promise<{ reply: string; provider: string }> {
  const messages: OAIMessage[] = [
    { role: "system", content: PERSONA },
    ...history.slice(-12),
  ];
  const errors: string[] = [];

  const groqKey = process.env.GROQ_API_KEY;
  if (groqKey) {
    try {
      const reply = await callOpenAICompatible(
        GROQ_URL,
        groqKey,
        process.env.GROQ_MODEL || "openai/gpt-oss-120b",
        messages
      );
      return { reply, provider: "groq" };
    } catch (e) {
      const err = e as ProviderError;
      errors.push(`groq(${err.status ?? err.message})`);
    }
  }

  const geminiKey = process.env.GEMINI_API_KEY;
  if (geminiKey) {
    try {
      const reply = await callOpenAICompatible(
        GEMINI_URL,
        geminiKey,
        process.env.GEMINI_MODEL || "gemini-2.0-flash",
        messages
      );
      return { reply, provider: "gemini" };
    } catch (e) {
      const err = e as ProviderError;
      errors.push(`gemini(${err.status ?? err.message})`);
    }
  }

  throw new Error(
    `All providers failed: ${errors.join(", ") || "no API keys configured"}`
  );
}
