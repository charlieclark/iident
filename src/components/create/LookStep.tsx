"use client";

import { useState } from "react";
import {
  ACCESSORIES,
  BOTTOMS,
  BUILDS,
  COLORS,
  FACIAL_HAIR,
  HAIR_COLORS,
  HAIR_STYLES,
  HEIGHTS,
  OUTERWEAR,
  OUTFIT_PRESETS,
  SHOES,
  STYLES,
  TOPS,
  type Appearance,
} from "@/lib/avatar/options";
import { api, ownerUrl } from "@/lib/client/api";
import { Button, Card, Chip, cx, Field, inputClass, Notice, SectionTitle, Segmented, Spinner, Swatches } from "@/components/ui";
import { BuildCard } from "./BuildStatus";
import type { StepProps } from "./CreateFlow";

const STYLE_TINTS: Record<string, string> = {
  animated: "from-amber-100 to-rose-100",
  realistic: "from-stone-200 to-stone-100",
  toy: "from-sky-100 to-violet-100",
  anime: "from-pink-100 to-indigo-100",
  clay: "from-orange-100 to-lime-100",
};

type Slot = "top" | "outer" | "bottom" | "shoes";
const SLOTS: { id: Slot; label: string; items: readonly { id: string; label: string }[] }[] = [
  { id: "top", label: "Top", items: TOPS },
  { id: "outer", label: "Layer", items: OUTERWEAR },
  { id: "bottom", label: "Bottom", items: BOTTOMS },
  { id: "shoes", label: "Shoes", items: SHOES },
];

const pick = <T,>(xs: readonly T[]) => xs[Math.floor(Math.random() * xs.length)];

export function LookStep({ avatar, token, onChange, goTo }: StepProps) {
  const [look, setLook] = useState<Appearance>(avatar.appearance);
  const [generating, setGenerating] = useState(false);
  const [refining, setRefining] = useState(false);
  const [building, setBuilding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(avatar.selectedConceptId ?? avatar.concepts[0]?.id ?? null);
  const [instruction, setInstruction] = useState("");
  const [slot, setSlot] = useState<Slot>("top");

  const set = (patch: Partial<Appearance>) => setLook((l) => ({ ...l, ...patch }));
  const selectedConcept = avatar.concepts.find((c) => c.id === selected) ?? null;
  const builtFrom = avatar.model?.conceptId;

  async function generate() {
    setGenerating(true);
    setError(null);
    try {
      const { avatar: next, created } = await api.generateConcepts(avatar.id, token, look);
      onChange(next);
      setSelected(created[0] ?? null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setGenerating(false);
    }
  }

  async function refine() {
    if (!selected || instruction.trim().length < 2) return;
    setRefining(true);
    setError(null);
    try {
      const { avatar: next, created } = await api.refineConcept(avatar.id, token, selected, instruction.trim());
      onChange(next);
      setSelected(created[0] ?? selected);
      setInstruction("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRefining(false);
    }
  }

  async function build() {
    if (!selected) return;
    setBuilding(true);
    setError(null);
    try {
      const { avatar: next } = await api.buildModel(avatar.id, token, selected);
      onChange(next);
      goTo(next.voice ? "persona" : "voice");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBuilding(false);
    }
  }

  function surprise() {
    const preset = pick(OUTFIT_PRESETS);
    set({
      ...preset.outfit,
      top: { ...preset.outfit.top, color: pick(COLORS).id },
      accessories: Math.random() < 0.5 ? [pick(ACCESSORIES).id] : [],
    });
  }

  const slotValue = look[slot];
  const latest = avatar.concepts.slice(0, 4);
  const history = avatar.concepts.slice(4);
  const modelBusy = !!avatar.model && avatar.model.status !== "ready" && avatar.model.status !== "failed";

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_460px]">
      <section className="space-y-8">
        <div>
          <p className="text-sm font-medium text-accent-600">Step 2</p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight sm:text-4xl">Design your character</h1>
          <p className="mt-2 max-w-xl text-ink-600">
            Pick a style, body and outfit. We&apos;ll draw a few versions of you, then turn your favorite into a 3D
            character that can move and talk.
          </p>
        </div>

        <div>
          <SectionTitle title="Style" />
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            {STYLES.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => set({ style: s.id })}
                aria-pressed={look.style === s.id}
                className={cx(
                  "rounded-2xl border bg-gradient-to-br p-3 text-left transition-all",
                  STYLE_TINTS[s.id],
                  look.style === s.id ? "border-accent-500 ring-2 ring-accent-200" : "border-transparent hover:border-ink-200",
                )}
              >
                <span className="block text-sm font-semibold text-ink-900">{s.label}</span>
                <span className="block text-xs text-ink-600">{s.hint}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="grid gap-6 sm:grid-cols-2">
          <div>
            <SectionTitle title="Build" />
            <div className="flex flex-wrap gap-1.5">
              {BUILDS.map((b) => (
                <Chip key={b.id} selected={look.build === b.id} onClick={() => set({ build: b.id })}>
                  {b.label}
                </Chip>
              ))}
            </div>
          </div>
          <div>
            <SectionTitle title="Height" />
            <Segmented value={look.height} options={HEIGHTS} onChange={(height) => set({ height })} />
          </div>
        </div>

        <div>
          <SectionTitle title="Hair" hint="Keep it as in your photo, or try something new." />
          <Segmented
            value={look.hair.keep ? "keep" : "custom"}
            options={[
              { id: "keep", label: "As in photo" },
              { id: "custom", label: "Change it" },
            ]}
            onChange={(v) => set({ hair: { ...look.hair, keep: v === "keep" } })}
          />
          {!look.hair.keep && (
            <div className="mt-3 space-y-3">
              <div className="flex flex-wrap gap-1.5">
                {HAIR_STYLES.map((h) => (
                  <Chip key={h.id} selected={look.hair.style === h.id} onClick={() => set({ hair: { ...look.hair, style: h.id } })}>
                    {h.label}
                  </Chip>
                ))}
              </div>
              <Swatches
                label="Hair color"
                value={look.hair.color}
                colors={HAIR_COLORS}
                onChange={(color) => set({ hair: { ...look.hair, color: color as Appearance["hair"]["color"] } })}
              />
            </div>
          )}
          <div className="mt-4">
            <p className="mb-2 text-xs font-medium text-ink-500">Facial hair</p>
            <div className="flex flex-wrap gap-1.5">
              {FACIAL_HAIR.map((f) => (
                <Chip key={f.id} selected={look.facialHair === f.id} onClick={() => set({ facialHair: f.id })}>
                  {f.label}
                </Chip>
              ))}
            </div>
          </div>
        </div>

        <div>
          <div className="mb-3 flex items-end justify-between gap-3">
            <SectionTitle title="Outfit" hint="Start from a preset, then fine-tune each piece." />
            <Button variant="ghost" size="sm" onClick={surprise}>
              Surprise me
            </Button>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {OUTFIT_PRESETS.map((p) => (
              <Chip key={p.id} onClick={() => set(p.outfit)}>
                {p.label}
              </Chip>
            ))}
          </div>
          <Card className="mt-4 p-4">
            <div className="flex flex-wrap gap-1 border-b border-ink-100 pb-3">
              {SLOTS.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setSlot(s.id)}
                  className={cx(
                    "rounded-full px-3 py-1 text-sm",
                    slot === s.id ? "bg-ink-900 text-white" : "text-ink-600 hover:bg-ink-100",
                  )}
                >
                  {s.label}
                </button>
              ))}
            </div>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {SLOTS.find((s) => s.id === slot)!.items.map((item) => (
                <Chip
                  key={item.id}
                  selected={slotValue.type === item.id}
                  onClick={() => set({ [slot]: { ...slotValue, type: item.id } } as Partial<Appearance>)}
                >
                  {item.label}
                </Chip>
              ))}
            </div>
            {!(slot === "outer" && look.outer.type === "none") && (
              <div className="mt-4">
                <Swatches
                  label={`${slot} color`}
                  value={slotValue.color}
                  colors={COLORS}
                  onChange={(color) => set({ [slot]: { ...slotValue, color } } as Partial<Appearance>)}
                />
              </div>
            )}
          </Card>
        </div>

        <div>
          <SectionTitle title="Accessories" hint="Up to five." />
          <div className="flex flex-wrap gap-1.5">
            {ACCESSORIES.map((a) => {
              const on = look.accessories.includes(a.id);
              return (
                <Chip
                  key={a.id}
                  selected={on}
                  onClick={() =>
                    set({
                      accessories: on
                        ? look.accessories.filter((x) => x !== a.id)
                        : [...look.accessories, a.id].slice(-5),
                    })
                  }
                >
                  {a.label}
                </Chip>
              );
            })}
          </div>
        </div>

        <Field label="Anything else?" hint="Small details work best, like a pin, a logo color or a specific shade." counter={`${look.extras.length}/240`}>
          <input
            className={inputClass}
            maxLength={240}
            value={look.extras}
            placeholder="e.g. a small enamel cat pin on the jacket"
            onChange={(e) => set({ extras: e.target.value })}
          />
        </Field>
      </section>

      <aside className="space-y-4 lg:sticky lg:top-24 lg:self-start">
        <Card className="p-4">
          <div className="flex items-center gap-3">
            {avatar.selfieUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={ownerUrl(avatar.selfieUrl, token)} alt="" className="size-11 rounded-full object-cover" />
            )}
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">Your looks</p>
              <p className="text-xs text-ink-500">Generate, pick one, then tweak it with words.</p>
            </div>
            <Button onClick={generate} loading={generating} variant={avatar.concepts.length ? "secondary" : "primary"}>
              {avatar.concepts.length ? "Regenerate" : "Generate"}
            </Button>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-2">
            {generating &&
              [0, 1].map((i) => (
                <div key={i} className="grid aspect-[9/16] animate-pulse place-items-center rounded-2xl bg-gradient-to-b from-ink-100 to-ink-50 text-xs text-ink-400">
                  Drawing…
                </div>
              ))}
            {latest.map((c) => (
              <ConceptTile key={c.id} url={ownerUrl(c.imageUrl, token)} selected={c.id === selected} built={c.id === builtFrom} onClick={() => setSelected(c.id)} />
            ))}
            {!generating && !latest.length && (
              <div className="col-span-2 grid aspect-[16/10] place-items-center rounded-2xl border border-dashed border-ink-200 px-6 text-center text-sm text-ink-500">
                Your character sheets will appear here. Each takes about 15 seconds.
              </div>
            )}
          </div>

          {history.length > 0 && (
            <details className="mt-3">
              <summary className="cursor-pointer text-xs text-ink-500">Earlier versions ({history.length})</summary>
              <div className="mt-2 grid grid-cols-4 gap-1.5">
                {history.map((c) => (
                  <ConceptTile key={c.id} url={ownerUrl(c.imageUrl, token)} selected={c.id === selected} built={c.id === builtFrom} onClick={() => setSelected(c.id)} small />
                ))}
              </div>
            </details>
          )}

          {selectedConcept && (
            <div className="mt-4 flex gap-2">
              <input
                className={inputClass}
                value={instruction}
                maxLength={240}
                placeholder="Tweak it: make the sneakers red…"
                onChange={(e) => setInstruction(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && refine()}
              />
              <Button variant="secondary" onClick={refine} loading={refining} disabled={instruction.trim().length < 2}>
                Apply
              </Button>
            </div>
          )}

          {error && (
            <div className="mt-3">
              <Notice tone="error">{error}</Notice>
            </div>
          )}

          <Button
            size="lg"
            className="mt-4 w-full"
            disabled={!selected || modelBusy}
            loading={building}
            onClick={build}
            variant="dark"
          >
            {builtFrom && builtFrom !== selected
              ? "Rebuild 3D with this look"
              : builtFrom === selected && avatar.model?.status === "failed"
                ? "Try building again"
                : builtFrom === selected && avatar.model?.status === "ready"
                  ? "Rebuild 3D"
                  : "Bring it to life in 3D"}
          </Button>
          <p className="mt-2 text-center text-xs text-ink-500">
            Building takes a few minutes. You&apos;ll pick a voice and set up the persona meanwhile.
          </p>
        </Card>
        {avatar.model && <BuildCard avatar={avatar} />}
        {avatar.model?.status === "failed" && (
          <Notice tone="warn">Try building again, or pick a different look. Full-body images with a plain background work best.</Notice>
        )}
        {modelBusy && (
          <Button variant="secondary" className="w-full" onClick={() => goTo(avatar.voice ? "persona" : "voice")}>
            Continue while it builds
          </Button>
        )}
        {generating && (
          <p className="flex items-center justify-center gap-2 text-xs text-ink-500">
            <Spinner className="size-3" /> Drawing your character sheets
          </p>
        )}
      </aside>
    </div>
  );
}

function ConceptTile({
  url,
  selected,
  built,
  onClick,
  small,
}: {
  url: string;
  selected: boolean;
  built: boolean;
  onClick: () => void;
  small?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={cx(
        "relative overflow-hidden rounded-2xl border-2 bg-white transition-all",
        selected ? "border-accent-500 shadow-lift" : "border-transparent hover:border-ink-200",
        small ? "aspect-[9/16]" : "aspect-[9/16]",
      )}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={url} alt="Character concept" className="size-full object-contain" />
      {built && !small && (
        <span className="absolute left-2 top-2 rounded-full bg-ink-900/80 px-2 py-0.5 text-[10px] font-medium text-white">3D</span>
      )}
    </button>
  );
}
