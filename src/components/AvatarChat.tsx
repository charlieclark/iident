"use client";

import { useEffect, useRef, useState } from "react";
import type { AvatarPlayer } from "@/lib/avatar/player";
import { api } from "@/lib/client/api";
import { Recorder } from "@/lib/client/audio";
import { streamChat, type ChatMessage } from "@/lib/client/chat";
import { Button, cx, Spinner } from "@/components/ui";

type Props = {
  slug: string;
  name: string;
  player: AvatarPlayer | null;
  /** Owner preview of an unpublished avatar. */
  previewId?: string;
  token?: string | null;
  language?: string;
  className?: string;
  dark?: boolean;
};

const LANGUAGE_CODES: Record<string, string> = {
  English: "en",
  Spanish: "es",
  French: "fr",
  German: "de",
  Portuguese: "pt",
  Italian: "it",
  Japanese: "ja",
  Korean: "ko",
  Chinese: "zh",
  Hindi: "hi",
};

/**
 * Conversation UI: text or push-to-talk input, streamed replies, and speech
 * playback through the avatar (which handles lip sync and gestures).
 */
export function AvatarChat({ slug, name, player, previewId, token, language, className, dark }: Props) {
  const [started, setStarted] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [speaking, setSpeaking] = useState(false);
  const recorder = useRef<Recorder | null>(null);
  const abort = useRef<AbortController | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => player?.onSpeaking(setSpeaking), [player]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  async function turn(body: { messages?: ChatMessage[]; greet?: boolean }) {
    if (!player) return;
    abort.current?.abort();
    const ctrl = new AbortController();
    abort.current = ctrl;
    setBusy(true);
    setError(null);
    player.beginReply();
    if (!body.greet) player.setMood("thinking");
    let reply = "";
    setMessages((m) => [...m, { role: "assistant", content: "" }]);
    try {
      await streamChat(
        slug,
        { ...body, previewId },
        (e) => {
          if (e.type === "text") {
            reply += e.delta;
            setMessages((m) => [...m.slice(0, -1), { role: "assistant", content: reply }]);
          } else if (e.type === "chunk") {
            player.expectSpeech(e.index);
          } else if (e.type === "audio") {
            player.enqueueSpeech(e.url, e.index);
          } else if (e.type === "audio_error") {
            player.skipSpeech(e.index);
          } else if (e.type === "error") {
            setError(e.message);
          }
        },
        { token, signal: ctrl.signal },
      );
    } catch (e) {
      if (!ctrl.signal.aborted) setError((e as Error).message);
    } finally {
      player.endReply();
      if (!reply) setMessages((m) => (m[m.length - 1]?.content ? m : m.slice(0, -1)));
      setBusy(false);
    }
  }

  async function start() {
    if (!player) return;
    await player.unlockAudio();
    setStarted(true);
    player.wave();
    await turn({ greet: true });
  }

  async function send(text: string) {
    const content = text.trim();
    if (!content || busy) return;
    setInput("");
    const history = [...messages.filter((m) => m.content), { role: "user" as const, content }];
    setMessages(history);
    await turn({ messages: history });
  }

  async function toggleMic() {
    if (listening) {
      const r = recorder.current;
      recorder.current = null;
      setListening(false);
      player?.setMood("idle");
      if (!r) return;
      const blob = await r.stop();
      if (blob.size < 2000) return;
      setTranscribing(true);
      try {
        const { text } = await api.transcribe(blob, language ? LANGUAGE_CODES[language] : undefined);
        if (text) await send(text);
        else setError("I didn't catch that. Try again?");
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setTranscribing(false);
      }
      return;
    }
    try {
      player?.stopSpeech();
      const r = new Recorder();
      await r.start();
      recorder.current = r;
      setListening(true);
      player?.setMood("listening");
    } catch {
      setError("Microphone access was blocked.");
    }
  }

  const surface = dark ? "bg-white/10 text-white border-white/15" : "bg-card text-ink-900 border-ink-100";

  if (!started) {
    return (
      <div className={cx("flex flex-col items-center gap-3", className)}>
        <Button size="lg" onClick={start} disabled={!player} className="shadow-lift">
          {player ? `Talk to ${name || "the avatar"}` : "Loading…"}
        </Button>
        <p className={cx("text-xs", dark ? "text-white/60" : "text-ink-500")}>Turn your sound on. You can type or speak.</p>
      </div>
    );
  }

  return (
    <div className={cx("flex flex-col gap-3", className)}>
      <div ref={listRef} className="max-h-[32vh] space-y-2 overflow-y-auto pr-1" aria-live="polite">
        {messages.map((m, i) => (
          <div key={i} className={cx("flex", m.role === "user" ? "justify-end" : "justify-start")}>
            <div
              className={cx(
                "max-w-[85%] rounded-2xl px-3.5 py-2 text-sm leading-relaxed backdrop-blur",
                m.role === "user" ? "bg-accent-500 text-white" : cx("border", surface),
              )}
            >
              {m.content || <Spinner className="size-3.5 opacity-60" />}
            </div>
          </div>
        ))}
      </div>
      {error && <p className={cx("text-xs", dark ? "text-red-300" : "text-red-600")}>{error}</p>}
      <form
        className={cx("flex items-center gap-2 rounded-full border p-1.5 pl-4 backdrop-blur", surface)}
        onSubmit={(e) => {
          e.preventDefault();
          void send(input);
        }}
      >
        <input
          className={cx("min-w-0 flex-1 bg-transparent text-sm outline-none", dark ? "placeholder:text-white/50" : "placeholder:text-ink-400")}
          placeholder={listening ? "Listening… tap the mic to send" : transcribing ? "Transcribing…" : `Message ${name || "the avatar"}`}
          value={input}
          maxLength={1000}
          disabled={listening || transcribing}
          onChange={(e) => setInput(e.target.value)}
        />
        {speaking && (
          <button
            type="button"
            onClick={() => player?.stopSpeech()}
            className={cx("rounded-full px-3 py-1.5 text-xs", dark ? "text-white/70 hover:bg-white/10" : "text-ink-500 hover:bg-ink-100")}
          >
            Stop
          </button>
        )}
        <button
          type="button"
          onClick={toggleMic}
          disabled={transcribing || busy}
          aria-label={listening ? "Stop and send voice message" : "Speak"}
          className={cx(
            "grid size-9 place-items-center rounded-full transition-colors disabled:opacity-40",
            listening ? "animate-pulse bg-red-500 text-white" : dark ? "bg-white/15 text-white hover:bg-white/25" : "bg-ink-100 text-ink-700 hover:bg-ink-200",
          )}
        >
          {transcribing ? <Spinner className="size-4" /> : <MicIcon />}
        </button>
        <button
          type="submit"
          disabled={!input.trim() || busy}
          aria-label="Send"
          className="grid size-9 place-items-center rounded-full bg-accent-500 text-white transition-colors hover:bg-accent-600 disabled:opacity-40"
        >
          {busy ? <Spinner className="size-4" /> : <SendIcon />}
        </button>
      </form>
    </div>
  );
}

function MicIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3" strokeLinecap="round" />
    </svg>
  );
}

function SendIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M5 12h13M13 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
