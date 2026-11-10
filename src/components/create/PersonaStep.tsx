"use client";

import { useEffect, useRef, useState } from "react";
import { CONTEXT_LIMITS, type AvatarContext } from "@/lib/avatar/context";
import { PERSONA_TRAITS, type Persona } from "@/lib/avatar/types";
import { api } from "@/lib/client/api";
import { Button, Chip, Field, inputClass, Notice } from "@/components/ui";
import { BuildCard } from "./BuildStatus";
import { ItemsEditor, savableItems } from "./ItemsEditor";
import type { StepProps } from "./CreateFlow";

const LANGUAGES = ["English", "Spanish", "French", "German", "Portuguese", "Italian", "Japanese", "Korean", "Chinese", "Hindi"];

export function PersonaStep({ avatar, token, onChange, goTo }: StepProps) {
  const [p, setP] = useState<Persona>(avatar.persona);
  // Includes items still being filled in; only complete ones are saved.
  const [ctx, setCtx] = useState<AvatarContext>(avatar.context);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const first = useRef(true);

  const set = (patch: Partial<Persona>) => {
    setSaved(false);
    setP((x) => ({ ...x, ...patch }));
  };
  const setContext = (patch: Partial<AvatarContext>) => {
    setSaved(false);
    setCtx((x) => ({ ...x, ...patch }));
  };
  const body = () => ({ persona: p, context: { ...ctx, items: savableItems(ctx.items) } });

  // Autosave a moment after typing stops.
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const t = setTimeout(async () => {
      try {
        const { avatar: next } = await api.patch(avatar.id, token, body());
        onChange(next);
        setSaved(true);
      } catch {}
    }, 900);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p, ctx]);

  async function saveAndContinue() {
    if (!p.name.trim()) return setError("Give your avatar a name.");
    if (savableItems(ctx.items).length < ctx.items.length) {
      return setError("Finish or remove the items marked “Not saved yet” first.");
    }
    setSaving(true);
    setError(null);
    try {
      const { avatar: next } = await api.patch(avatar.id, token, body());
      onChange(next);
      goTo("share");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_400px]">
      <section className="space-y-6">
        <div>
          <p className="text-sm font-medium text-accent-600">Step 4</p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight sm:text-4xl">Shape the persona</h1>
          <p className="mt-2 max-w-xl text-ink-600">
            This is what your avatar knows and how it talks. It will always tell visitors it&apos;s an AI.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name">
            <input className={inputClass} value={p.name} maxLength={60} placeholder="Sam Rivera" onChange={(e) => set({ name: e.target.value })} />
          </Field>
          <Field label="Language">
            <select className={inputClass} value={p.language} onChange={(e) => set({ language: e.target.value })}>
              {LANGUAGES.map((l) => (
                <option key={l}>{l}</option>
              ))}
            </select>
          </Field>
        </div>

        <Field label="One-liner" hint="Shown under your name on your page." counter={`${p.tagline.length}/160`}>
          <input
            className={inputClass}
            value={p.tagline}
            maxLength={160}
            placeholder="Product designer in Lisbon. Ask me about design systems or trail running."
            onChange={(e) => set({ tagline: e.target.value })}
          />
        </Field>

        <Field label="About you" hint="Background, work, interests. Write it like notes for a friend who'll stand in for you." counter={`${p.about.length}/4000`}>
          <textarea
            className={`${inputClass} min-h-32`}
            value={p.about}
            maxLength={4000}
            placeholder="I'm a designer at Acme, previously at Studio Nord. Grew up in Porto. I run trails on weekends and I'm learning Japanese…"
            onChange={(e) => set({ about: e.target.value })}
          />
        </Field>

        <div>
          <p className="text-sm font-medium text-ink-800">Personality</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {PERSONA_TRAITS.map((t) => {
              const on = p.traits.includes(t);
              return (
                <Chip key={t} selected={on} onClick={() => set({ traits: on ? p.traits.filter((x) => x !== t) : [...p.traits, t].slice(-6) })}>
                  {t}
                </Chip>
              );
            })}
          </div>
        </div>

        <Field label="How you talk" hint="Tone, phrases you use, how formal you are.">
          <input className={inputClass} value={p.speakingStyle} maxLength={400} onChange={(e) => set({ speakingStyle: e.target.value })} />
        </Field>

        <Field
          label="What it knows"
          hint="Facts and FAQs you want visitors to know. The avatar won't invent things beyond this."
          counter={`${ctx.knowledge.length}/${CONTEXT_LIMITS.knowledge}`}
        >
          <textarea
            className={`${inputClass} min-h-32`}
            value={ctx.knowledge}
            maxLength={CONTEXT_LIMITS.knowledge}
            placeholder={"Q: What are you working on?\nA: A booking app for climbing gyms.\n\nBest way to reach me: the contact form on my site."}
            onChange={(e) => setContext({ knowledge: e.target.value })}
          />
        </Field>

        <div>
          <p className="text-sm font-medium text-ink-800">Things it can show</p>
          <p className="mt-0.5 mb-2 text-xs text-ink-500">
            Links, products, videos and images your avatar can put on screen while it talks. These are the only links it will ever share.
          </p>
          <ItemsEditor items={ctx.items} onChange={(items) => setContext({ items })} />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Topics to avoid" hint="The avatar will politely steer away.">
            <input className={inputClass} value={p.boundaries} maxLength={1000} placeholder="Politics, salary, my family" onChange={(e) => set({ boundaries: e.target.value })} />
          </Field>
          <Field label="Greeting" hint="What it says when someone arrives.">
            <input
              className={inputClass}
              value={p.greeting}
              maxLength={300}
              placeholder={`Hey, I'm ${p.name || "Sam"}'s AI avatar. What brings you here?`}
              onChange={(e) => set({ greeting: e.target.value })}
            />
          </Field>
        </div>

        {error && <Notice tone="error">{error}</Notice>}
        <div className="flex items-center gap-3">
          <Button size="lg" loading={saving} onClick={saveAndContinue}>
            Save and continue
          </Button>
          {saved && <span className="text-xs text-ink-400">Saved</span>}
        </div>
      </section>
      <aside className="space-y-4 lg:sticky lg:top-24 lg:self-start">
        <BuildCard avatar={avatar} />
      </aside>
    </div>
  );
}
