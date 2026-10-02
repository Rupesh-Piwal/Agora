# Agora

A voice buddy for history nerds who have no one to argue with. It talks history with you — has opinions, pushes back, and (soon) remembers you. Built to run free on Vercel.

## Stack (v1)

- **Next.js 16** (App Router) + TypeScript + Tailwind v4
- **Web Speech API** — speech → text, in the browser (Chrome/Edge)
- **Groq** (Llama 3.x) — the brain, behind `/api/chat`
- **speechSynthesis** — text → voice, in the browser

## Run locally

```bash
npm install
# add your key to .env.local (see .env.example)
npm run dev
```

Open http://localhost:3000 **in Chrome or Edge**, tap the orb, and talk.

## How one turn flows

```
you speak → Web Speech (STT) → POST /api/chat → Groq → reply text
         → back to the browser → speechSynthesis (TTS) → you hear it
```

The Groq API key lives only in `.env.local` (gitignored) and is used server-side in `/api/chat`, so it never reaches the browser.

## Roadmap

- **v1** — voice loop, live on Vercel ← *you are here*
- **v2** — neural voice (msedge-tts), memory (Supabase), transcript + reactive orb
- **v3** — modes (debate / fact-check / rabbit-hole), retrieval
