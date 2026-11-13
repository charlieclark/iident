"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError, saveDraft, tokenFor, type Avatar } from "@/lib/client/api";
import { Button, cx, Logo, Notice, Spinner } from "@/components/ui";
import { AccountLink } from "@/components/account/AccountLink";
import { BuildStatus } from "./BuildStatus";
import { LookStep } from "./LookStep";
import { PersonaStep } from "./PersonaStep";
import { PhotoStep } from "./PhotoStep";
import { ShareStep } from "./ShareStep";
import { VoiceStep } from "./VoiceStep";

export type Step = "photo" | "look" | "voice" | "persona" | "share";

const STEPS: { id: Step; label: string }[] = [
  { id: "photo", label: "Photo" },
  { id: "look", label: "Look" },
  { id: "voice", label: "Voice" },
  { id: "persona", label: "Persona" },
  { id: "share", label: "Share" },
];

export type StepProps = {
  avatar: Avatar;
  token: string;
  onChange: (a: Avatar) => void;
  goTo: (s: Step) => void;
};

function initialStep(a: Avatar): Step {
  if (!a.selfieUrl) return "photo";
  if (!a.model) return "look";
  if (!a.voice) return "voice";
  if (!a.persona.name) return "persona";
  return "share";
}

const isBuilding = (a: Avatar | null) =>
  !!a?.model && a.model.status !== "ready" && a.model.status !== "failed";

/** The creator: owns the draft, step navigation and polling of the 3D build. */
export function CreateFlow() {
  const params = useSearchParams();
  const router = useRouter();
  const [avatar, setAvatar] = useState<Avatar | null>(null);
  // null while loading; "" when the avatar is open through the signed-in account instead of this browser's token.
  const [token, setToken] = useState<string | null>(null);
  const [step, setStep] = useState<Step>("photo");
  const [error, setError] = useState<string | null>(null);
  const booted = useRef(false);

  useEffect(() => {
    if (booted.current) return;
    booted.current = true;
    (async () => {
      try {
        const id = params.get("id");
        // An account comes first: visitors sign up (or in) and are brought back here.
        const { user } = await api.me();
        if (!user) {
          router.replace(`/login?next=${encodeURIComponent(id ? `/create?id=${id}` : "/create")}`);
          return;
        }
        // Drafts this browser made before accounts were required come along.
        await api.claimDrafts().catch(() => {});
        if (id) {
          // This browser's token if it made the avatar, otherwise the account's session.
          const existing = tokenFor(id) ?? "";
          const opened = await api.get(id, existing).catch((e) => {
            if (e instanceof ApiError && (e.status === 403 || e.status === 404)) return null;
            throw e;
          });
          if (opened) {
            setAvatar(opened.avatar);
            setToken(existing);
            // Back from checkout: the look step starts the build that was paid for.
            setStep(params.get("build") ? "look" : initialStep(opened.avatar));
            if (existing) saveDraft(id, existing);
            return;
          }
        }
        const { avatar, editToken } = await api.create();
        saveDraft(avatar.id, editToken);
        setAvatar(avatar);
        setToken(editToken);
        router.replace(`/create?id=${avatar.id}`);
      } catch (e) {
        setError((e as Error).message);
      }
    })();
  }, [params, router]);

  // Poll while the 3D character is being built.
  useEffect(() => {
    if (!avatar || token === null || !isBuilding(avatar)) return;
    const t = setInterval(async () => {
      try {
        const { avatar: next } = await api.get(avatar.id, token);
        setAvatar((prev) => (prev && prev.id === next.id ? { ...prev, model: next.model, faceRig: next.faceRig } : next));
      } catch {}
    }, 4000);
    return () => clearInterval(t);
  }, [avatar, token]);

  const goTo = useCallback((s: Step) => {
    setStep(s);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  if (error) {
    return (
      <div className="mx-auto max-w-md p-8">
        <Notice tone="error">{error}</Notice>
        <Button className="mt-4" onClick={() => window.location.reload()}>
          Start over
        </Button>
      </div>
    );
  }
  if (!avatar || token === null) {
    return (
      <div className="grid min-h-dvh place-items-center text-ink-500">
        <Spinner className="size-8 text-accent-500" />
      </div>
    );
  }

  const props: StepProps = { avatar, token, onChange: setAvatar, goTo };
  const reachable = (s: Step) => {
    if (s === "photo") return true;
    if (s === "look") return !!avatar.selfieUrl;
    return !!avatar.model;
  };

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-30 border-b border-ink-100/80 bg-paper/85 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-4 px-4 py-3 sm:px-6">
          <Link href="/" aria-label="Twiins home">
            <Logo />
          </Link>
          <nav aria-label="Steps" className="mx-auto hidden items-center gap-1 md:flex">
            {STEPS.map((s, i) => (
              <button
                key={s.id}
                type="button"
                disabled={!reachable(s.id)}
                onClick={() => goTo(s.id)}
                aria-current={step === s.id ? "step" : undefined}
                className={cx(
                  "flex items-center gap-2 rounded-full px-3 py-1.5 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-40",
                  step === s.id ? "bg-ink-900 text-white" : "text-ink-600 hover:bg-ink-100",
                )}
              >
                <span
                  className={cx(
                    "grid size-5 place-items-center rounded-full text-[11px] font-semibold",
                    step === s.id ? "bg-white/20" : "bg-ink-100 text-ink-600",
                  )}
                >
                  {i + 1}
                </span>
                {s.label}
              </button>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-1 md:ml-0">
            <BuildStatus avatar={avatar} onOpen={() => goTo(avatar.model?.status === "ready" ? "share" : "look")} />
            <AccountLink next={`/create?id=${avatar.id}`} />
          </div>
        </div>
        <nav aria-label="Steps" className="flex gap-1 overflow-x-auto px-4 pb-2.5 md:hidden">
          {STEPS.map((s, i) => (
            <button
              key={s.id}
              type="button"
              disabled={!reachable(s.id)}
              onClick={() => goTo(s.id)}
              aria-current={step === s.id ? "step" : undefined}
              className={cx(
                "shrink-0 rounded-full px-3 py-1 text-xs transition-colors disabled:opacity-40",
                step === s.id ? "bg-ink-900 text-white" : "bg-ink-100 text-ink-600",
              )}
            >
              {i + 1}. {s.label}
            </button>
          ))}
        </nav>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-10">
        {step === "photo" && <PhotoStep {...props} />}
        {step === "look" && <LookStep {...props} autoBuild={params.get("build")} />}
        {step === "voice" && <VoiceStep {...props} />}
        {step === "persona" && <PersonaStep {...props} />}
        {step === "share" && <ShareStep {...props} />}
      </main>
    </div>
  );
}
