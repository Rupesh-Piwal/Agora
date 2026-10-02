"use client";

import { useEffect, useRef, useState } from "react";

type Role = "user" | "assistant";
type Message = { role: Role; content: string };
type Status = "idle" | "listening" | "thinking" | "speaking";

export default function Home() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [status, setStatus] = useState<Status>("idle");
  const [interim, setInterim] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [supported, setSupported] = useState(true);

  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const messagesRef = useRef<Message[]>(messages);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    messagesRef.current = messages;
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, interim]);

  useEffect(() => {
    const ok = typeof window !== "undefined" && !!(window.SpeechRecognition || window.webkitSpeechRecognition);
    setSupported(ok);
  }, []);

  function speak(text: string) {
    const synth = window.speechSynthesis;
    if (!synth) {
      setStatus("idle");
      return;
    }
    synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 1.03;
    const voices = synth.getVoices();
    const pref =
      voices.find((v) => v.lang.startsWith("en") && /Google|Natural|Samantha|Daniel/i.test(v.name)) ||
      voices.find((v) => v.lang.startsWith("en"));
    if (pref) u.voice = pref;
    u.onstart = () => setStatus("speaking");
    u.onend = () => setStatus("idle");
    u.onerror = () => setStatus("idle");
    synth.speak(u);
  }

  async function handleUserText(text: string) {
    const next = [...messagesRef.current, { role: "user" as Role, content: text }];
    setMessages(next);
    setStatus("thinking");
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: next }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error || "Something went wrong.");
        setStatus("idle");
        return;
      }
      const reply: string = data.reply;
      setMessages((m) => [...m, { role: "assistant", content: reply }]);
      speak(reply);
    } catch {
      setError("Network error — is the dev server running?");
      setStatus("idle");
    }
  }

  function startListening() {
    const Ctor = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Ctor) {
      setSupported(false);
      return;
    }
    window.speechSynthesis?.cancel();
    setError(null);
    const rec = new Ctor();
    rec.lang = "en-US";
    rec.interimResults = true;
    rec.continuous = false;
    rec.maxAlternatives = 1;

    let finalText = "";
    rec.onstart = () => {
      setInterim("");
      setStatus("listening");
    };
    rec.onresult = (e: SpeechRecognitionEvent) => {
      let live = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finalText += r[0].transcript;
        else live += r[0].transcript;
      }
      setInterim(live);
    };
    rec.onerror = (e: SpeechRecognitionErrorEvent) => {
      setError(e.error === "no-speech" ? "Didn't catch that — tap and try again." : `Mic error: ${e.error}`);
      setStatus("idle");
    };
    rec.onend = () => {
      setInterim("");
      recognitionRef.current = null;
      const text = finalText.trim();
      if (text) handleUserText(text);
      else setStatus((s) => (s === "listening" ? "idle" : s));
    };

    recognitionRef.current = rec;
    rec.start();
  }

  function toggleMic() {
    if (status === "listening") {
      recognitionRef.current?.stop();
      return;
    }
    if (status === "thinking") return;
    if (status === "speaking") {
      window.speechSynthesis?.cancel();
      setStatus("idle");
      return;
    }
    startListening();
  }

  const orbAnim =
    status === "listening"
      ? "orb-listen 1s ease-in-out infinite"
      : status === "thinking"
        ? "orb-idle 3s ease-in-out infinite"
        : status === "speaking"
          ? "orb-speak .7s ease-in-out infinite"
          : "orb-idle 4s ease-in-out infinite";

  const hot = status === "thinking" || status === "speaking";
  const label =
    status === "listening"
      ? "Listening…"
      : status === "thinking"
        ? "Thinking…"
        : status === "speaking"
          ? "Speaking… — tap to cut in"
          : messages.length === 0
            ? "Tap to talk history"
            : "Tap to reply";

  return (
    <main className="mx-auto flex h-full w-full max-w-2xl flex-col px-4">
      <header className="flex items-center gap-2.5 py-5">
        <span className="h-2.5 w-2.5 rounded-full bg-teal shadow-[0_0_0_3px_rgba(84,198,210,0.25)]" />
        <span className="font-mono text-sm tracking-wide text-muted">
          Agora <span className="text-fg">· talk history</span>
        </span>
      </header>

      {/* transcript */}
      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto py-2">
        {messages.length === 0 && (
          <div className="mt-10 text-center text-muted">
            <p className="text-lg text-fg">Your history buddy is listening.</p>
            <p className="mt-2 text-sm">
              Try: <span className="text-teal">“Did Nero really fiddle while Rome burned?”</span>
              <br />or just <span className="text-teal">“Tell me something wild about the Mongols.”</span>
            </p>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={m.role === "user" ? "flex justify-end" : "flex justify-start"}>
            <div
              className={
                "max-w-[82%] rounded-2xl px-4 py-2.5 text-[15px] leading-relaxed " +
                (m.role === "user"
                  ? "bg-surface-2 text-fg"
                  : "border border-line bg-surface text-fg")
              }
            >
              {m.role === "assistant" && (
                <span className="mb-1 block font-mono text-[11px] uppercase tracking-wider text-gold">
                  Agora
                </span>
              )}
              {m.content}
            </div>
          </div>
        ))}
        {interim && (
          <div className="flex justify-end">
            <div className="max-w-[82%] rounded-2xl bg-surface-2/50 px-4 py-2.5 text-[15px] italic text-muted">
              {interim}
            </div>
          </div>
        )}
      </div>

      {/* controls */}
      <div className="flex flex-col items-center gap-4 py-7">
        {error && <p className="text-sm text-[color:var(--danger)]">{error}</p>}
        {!supported && (
          <p className="max-w-sm text-center text-sm text-[color:var(--danger)]">
            Voice input needs Chrome or Edge (the Web Speech API). Open this in one of those.
          </p>
        )}

        <button
          onClick={toggleMic}
          disabled={!supported || status === "thinking"}
          aria-label={label}
          className="relative grid h-36 w-36 place-items-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-teal disabled:opacity-60"
        >
          {status === "listening" && (
            <>
              <span className="absolute inset-0 rounded-full border border-teal" style={{ animation: "ring-pulse 1.4s ease-out infinite" }} />
              <span className="absolute inset-0 rounded-full border border-teal" style={{ animation: "ring-pulse 1.4s ease-out .7s infinite" }} />
            </>
          )}
          <span
            className="grid h-28 w-28 place-items-center rounded-full border"
            style={{
              animation: orbAnim,
              borderColor: hot ? "var(--gold)" : "var(--teal)",
              background: hot
                ? "radial-gradient(circle at 35% 30%, rgba(224,162,74,0.35), rgba(27,39,56,0.9))"
                : "radial-gradient(circle at 35% 30%, rgba(84,198,210,0.35), rgba(27,39,56,0.9))",
              boxShadow: hot
                ? "0 0 40px rgba(224,162,74,0.25)"
                : "0 0 40px rgba(84,198,210,0.22)",
            }}
          >
            {status === "thinking" && (
              <span
                className="absolute h-28 w-28 rounded-full border-2 border-transparent"
                style={{ borderTopColor: "var(--gold)", animation: "orb-think 1s linear infinite" }}
              />
            )}
            <MicGlyph color={hot ? "var(--gold)" : "var(--teal)"} />
          </span>
        </button>

        <p className="font-mono text-sm text-muted">{label}</p>
      </div>
    </main>
  );
}

function MicGlyph({ color }: { color: string }) {
  return (
    <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0" />
      <line x1="12" y1="18" x2="12" y2="21" />
    </svg>
  );
}
