import { NextRequest, NextResponse } from "next/server";
import { generate, type ChatMessage } from "@/lib/llm";

export async function POST(req: NextRequest) {
  if (!process.env.GROQ_API_KEY && !process.env.GEMINI_API_KEY) {
    return NextResponse.json(
      { error: "No model API key set. Add GROQ_API_KEY (and optionally GEMINI_API_KEY) to .env.local." },
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

  try {
    const { reply, provider } = await generate(messages);
    return NextResponse.json({ reply, provider });
  } catch (err) {
    return NextResponse.json(
      { error: "All model providers failed.", detail: String(err) },
      { status: 502 }
    );
  }
}
