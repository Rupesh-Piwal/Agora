import { NextRequest, NextResponse } from "next/server";

const GROQ_STT_URL = "https://api.groq.com/openai/v1/audio/transcriptions";

export async function POST(req: NextRequest) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "Missing GROQ_API_KEY." }, { status: 500 });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Expected multipart form data." }, { status: 400 });
  }

  const audio = form.get("audio");
  if (!(audio instanceof File) || audio.size === 0) {
    return NextResponse.json({ error: "No audio provided." }, { status: 400 });
  }

  const groqForm = new FormData();
  groqForm.append("file", audio, "audio.webm");
  groqForm.append("model", process.env.GROQ_STT_MODEL || "whisper-large-v3-turbo");
  groqForm.append("response_format", "json");
  groqForm.append("language", "en");

  try {
    const res = await fetch(GROQ_STT_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: groqForm,
    });
    if (!res.ok) {
      const detail = await res.text();
      return NextResponse.json({ error: `Transcription error (${res.status}).`, detail }, { status: 502 });
    }
    const data = await res.json();
    return NextResponse.json({ text: (data?.text || "").trim() });
  } catch (err) {
    return NextResponse.json({ error: "Failed to reach transcription service.", detail: String(err) }, { status: 502 });
  }
}
