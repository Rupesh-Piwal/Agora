"use client";

import { useEffect, useRef, useState } from "react";

type Role = "user" | "assistant";
type Message = { role: Role; content: string };
type Status = "idle" | "listening" | "transcribing" | "thinking" | "speaking";

const SILENCE_MS = 1400; // stop this long after you stop talking
const MAX_RECORD_MS = 25000; // hard cap
const SPEECH_RMS = 0.015; // volume threshold that counts as "talking"
const SESSION_KEY = "agora_session";

export default function Home() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [supported, setSupported] = useState(true);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const rafRef = useRef<number | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const messagesRef = useRef<Message[]>(messages);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const sessionIdRef = useRef<string | null>(null);

  useEffect(() => {
    messagesRef.current = messages;
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    const ok =
      typeof window !== "undefined" &&
      !!navigator.mediaDevices?.getUserMedia &&
      typeof window.MediaRecorder !== "undefined";
    setSupported(ok);
  }, []);

  // Restore the saved conversation from the DB on load.
  useEffect(() => {
    let sid: string | null = null;
    try {
      sid = localStorage.getItem(SESSION_KEY);
    } catch {}
    if (!sid) return;
    sessionIdRef.current = sid;
    (async () => {
      try {
        const res = await fetch(`/api/history?sessionId=${encodeURIComponent(sid)}`);
        const data = await res.json();
        if (Array.isArray(data?.messages) && data.messages.length > 0) {
          setMessages(data.messages);
        }
      } catch {}
    })();
  }, []);

  function pickMime(): string {
    const prefs = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg"];
    for (const m of prefs) {
      if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(m)) return m;
    }
    return "";
  }

  function teardownMeter() {
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    audioCtxRef.current?.close().catch(() => {});
    audioCtxRef.current = null;
  }

  function watchForSilence(stream: MediaStream, onDone: () => void) {
    const ctx = new AudioContext();
    audioCtxRef.current = ctx;
    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    source.connect(analyser);
    const data = new Uint8Array(analyser.frequencyBinCount);

    const startedAt = performance.now();
    let lastLoud = performance.now();
    let hasSpoken = false;

    const tick = () => {
      analyser.getByteTimeDomainData(data);
      let sum = 0;
      for (let i = 0; i < data.length; i++) {
        const n = (data[i] - 128) / 128;
        sum += n * n;
      }
      const rms = Math.sqrt(sum / data.length);
      const now = performance.now();

      if (rms > SPEECH_RMS) {
        hasSpoken = true;
        lastLoud = now;
      }
      const silentLongEnough = hasSpoken && now - lastLoud > SILENCE_MS;
      const tooLong = now - startedAt > MAX_RECORD_MS;
      if (silentLongEnough || tooLong) {
        onDone();
        return;
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }

  async function startListening() {
    setError(null);
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) {
      const name = (e as DOMException)?.name;
      setError(
        name === "NotAllowedError"
          ? "Microphone blocked — allow it for this site and tap again."
          : "Couldn't open the microphone."
      );
      setStatus("idle");
      return;
    }

    streamRef.current = stream;
    chunksRef.current = [];
    const mime = pickMime();
    const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    recorderRef.current = rec;

    rec.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };
    rec.onstop = async () => {
      teardownMeter();
      stream.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      recorderRef.current = null;
      const blob = new Blob(chunksRef.current, { type: rec.mimeType || "audio/webm" });
      if (blob.size < 1200) {
        setStatus("idle");
        return;
      }
      await transcribeAndSend(blob);
    };

    rec.start();
    setStatus("listening");
    watchForSilence(stream, () => {
      if (recorderRef.current?.state === "recording") recorderRef.current.stop();
    });
  }

  function stopListening() {
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
  }

  async function transcribeAndSend(blob: Blob) {
    setStatus("transcribing");
    try {
      const fd = new FormData();
      fd.append("audio", blob, "audio.webm");
      const res = await fetch("/api/transcribe", { method: "POST", body: fd });
      const data = await res.json();
      const text: string = (data?.text || "").trim();
      if (!res.ok) {
        setError(data?.error || "Transcription failed.");
        setStatus("idle");
        return;
      }
      if (!text) {
        setError("Didn't catch that — tap and try again.");
        setStatus("idle");
        return;
      }
      await handleUserText(text);
    } catch {
      setError("Network error reaching transcription.");
      setStatus("idle");
    }
  }

  async function handleUserText(text: string) {
    const next = [...messagesRef.current, { role: "user" as Role, content: text }];
    setMessages(next);
    setStatus("thinking");
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: next, sessionId: sessionIdRef.current }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error || "Something went wrong.");
        setStatus("idle");
        return;
      }
      if (data.sessionId && data.sessionId !== sessionIdRef.current) {
        sessionIdRef.current = data.sessionId;
        try {
          localStorage.setItem(SESSION_KEY, data.sessionId);
        } catch {}
      }
      const reply: string = data.reply;
      setMessages((m) => [...m, { role: "assistant", content: reply }]);
      speak(reply);
    } catch {
      setError("Network error — is the dev server running?");
      setStatus("idle");
    }
  }

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

  function toggleMic() {
    if (status === "listening") {
      stopListening();
      return;
    }
    if (status === "transcribing" || status === "thinking") return;
    if (status === "speaking") {
      window.speechSynthesis?.cancel();
      setStatus("idle");
      return;
    }
    startListening();
  }

  function newChat() {
    window.speechSynthesis?.cancel();
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
    setMessages([]);
    setError(null);
    setStatus("idle");
    sessionIdRef.current = null;
    try {
      localStorage.removeItem(SESSION_KEY);
    } catch {}
  }

  const orbAnim =
    status === "listening"
      ? "orb-listen 1s ease-in-out infinite"
      : status === "speaking"
        ? "orb-speak .7s ease-in-out infinite"
        : "orb-idle 4s ease-in-out infinite";

  const hot = status === "transcribing" || status === "thinking" || status === "speaking";
  const label =
    status === "listening"
      ? "Listening… — tap to send"
      : status === "transcribing"
        ? "Transcribing…"
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
        {messages.length > 0 && (
          <button
            onClick={newChat}
            className="ml-auto rounded-full border border-line px-3 py-1 font-mono text-xs text-muted transition-colors hover:border-teal hover:text-teal"
          >
            New chat
          </button>
        )}
      </header>

      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto py-2">
        {messages.length === 0 && (
          <div className="mt-10 text-center text-muted">
            <p className="text-lg text-fg">Your history buddy is listening.</p>
            <p className="mt-2 text-sm">
              Try: <span className="text-teal">&ldquo;Did Nero really fiddle while Rome burned?&rdquo;</span>
              <br />or just <span className="text-teal">&ldquo;Tell me something wild about the Mongols.&rdquo;</span>
            </p>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={m.role === "user" ? "flex justify-end" : "flex justify-start"}>
            <div
              className={
                "max-w-[82%] rounded-2xl px-4 py-2.5 text-[15px] leading-relaxed " +
                (m.role === "user" ? "bg-surface-2 text-fg" : "border border-line bg-surface text-fg")
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
      </div>

      <div className="flex flex-col items-center gap-4 py-7">
        {error && <p className="text-sm text-[color:var(--danger)]">{error}</p>}
        {!supported && (
          <p className="max-w-sm text-center text-sm text-[color:var(--danger)]">
            This browser can&rsquo;t record audio. Try a recent Chrome, Edge, or Brave.
          </p>
        )}

        <button
          onClick={toggleMic}
          disabled={!supported || status === "transcribing" || status === "thinking"}
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
            className="relative grid h-28 w-28 place-items-center rounded-full border"
            style={{
              animation: orbAnim,
              borderColor: hot ? "var(--gold)" : "var(--teal)",
              background: hot
                ? "radial-gradient(circle at 35% 30%, rgba(224,162,74,0.35), rgba(27,39,56,0.9))"
                : "radial-gradient(circle at 35% 30%, rgba(84,198,210,0.35), rgba(27,39,56,0.9))",
              boxShadow: hot ? "0 0 40px rgba(224,162,74,0.25)" : "0 0 40px rgba(84,198,210,0.22)",
            }}
          >
            {(status === "transcribing" || status === "thinking") && (
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
