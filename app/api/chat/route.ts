import { NextRequest, NextResponse } from "next/server";
import { PERSONA } from "@/lib/persona";

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const MODEL = process.env.GROQ_MODEL || "openai/gpt-oss-120b";

type ChatMessage = { role: "user" | "assistant"; content: string };

export async function POST(req: NextRequest) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "Missing GROQ_API_KEY. Add it to .env.local and restart." },
      { status: 500 }
    );
  }

  let messages: ChatMessage[];
  try {
    const body = await req.json();
    messages = Array.isArray(body?.messages) ? body.messages : [];
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (messages.length === 0) {
    return NextResponse.json({ error: "No messages provided." }, { status: 400 });
  }

  // Keep the request light: only the last 12 turns go to the model.
  const recent = messages.slice(-12);

  try {
    const res = await fetch(GROQ_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0.8,
        max_tokens: 500,
        messages: [{ role: "system", content: PERSONA }, ...recent],
      }),
    });

    if (!res.ok) {
      const detail = await res.text();
      return NextResponse.json(
        { error: `Groq error (${res.status}).`, detail },
        { status: 502 }
      );
    }

    const data = await res.json();
    const reply: string = data?.choices?.[0]?.message?.content?.trim() ?? "";
    if (!reply) {
      return NextResponse.json({ error: "Empty reply from model." }, { status: 502 });
    }

    return NextResponse.json({ reply });
  } catch (err) {
    return NextResponse.json(
      { error: "Failed to reach Groq.", detail: String(err) },
      { status: 502 }
    );
  }
}
