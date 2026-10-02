import { NextRequest, NextResponse } from "next/server";
import { generate, type ChatMessage } from "@/lib/llm";
import { createSession, addMessages } from "@/lib/db";

export async function POST(req: NextRequest) {
  if (!process.env.GROQ_API_KEY && !process.env.GEMINI_API_KEY) {
    return NextResponse.json(
      { error: "No model API key set. Add GROQ_API_KEY (and optionally GEMINI_API_KEY) to .env.local." },
      { status: 500 }
    );
  }

  let messages: ChatMessage[];
  let sessionId: string | null;
  try {
    const body = await req.json();
    messages = Array.isArray(body?.messages) ? body.messages : [];
    sessionId = typeof body?.sessionId === "string" ? body.sessionId : null;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  if (messages.length === 0) {
    return NextResponse.json({ error: "No messages provided." }, { status: 400 });
  }

  let reply: string;
  let provider: string;
  try {
    ({ reply, provider } = await generate(messages));
  } catch (err) {
    return NextResponse.json(
      { error: "All model providers failed.", detail: String(err) },
      { status: 502 }
    );
  }

  // Persist this turn (no-ops silently if Supabase isn't configured).
  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  if (lastUser) {
    if (!sessionId) sessionId = await createSession(lastUser.content);
    if (sessionId) {
      await addMessages(sessionId, [
        { role: "user", content: lastUser.content },
        { role: "assistant", content: reply },
      ]);
    }
  }

  return NextResponse.json({ reply, provider, sessionId });
}
