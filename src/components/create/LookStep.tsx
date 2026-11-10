"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
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
  TOPS,
  type Appearance,
} from "@/lib/avatar/options";
import { PLANS } from "@/lib/billing/plans";
import { needsPlan, useAccount } from "@/lib/client/account";
import { api, ApiError, ownerUrl } from "@/lib/client/api";
import { Button, Card, Chip, cx, Field, inputClass, Notice, SectionTitle, Segmented, Spinner, Swatches } from "@/components/ui";
import { BuildCard } from "./BuildStatus";
import type { StepProps } from "./CreateFlow";

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
  const [drafting, setDrafting] = useState(false);
  const [finalizing, setFinalizing] = useState(false);
  const [refining, setRefining] = useState(false);
  const [building, setBuilding] = useState(false);
  const [needsUpgrade, setNeedsUpgrade] = useState(false);
  const router = useRouter();
  const { account } = useAccount();
  const here = `/create?id=${avatar.id}`;
  const plansUrl = `/pricing?next=${encodeURIComponent(here)}`;
  /** Building in 3D needs a plan (when payments are switched on). */
  const locked = needsPlan(account);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(avatar.selectedConceptId ?? avatar.concepts[0]?.id ?? null);
  const [instruction, setInstruction] = useState("");
  const [slot, setSlot] = useState<Slot>("top");

  const set = (patch: Partial<Appearance>) => setLook((l) => ({ ...l, ...patch }));
  const selectedConcept = avatar.concepts.find((c) => c.id === selected) ?? null;
  const builtFrom = avatar.model?.conceptId;

  // Quick sketches follow the look as it changes: the first one is drawn on
  // arrival, later ones a moment after the last change. `drawn` is the look
  // the newest picture shows, so nothing is redrawn without a change.
  const lookKey = JSON.stringify(look);
  const drawn = useRef<string | null>(avatar.concepts.length ? JSON.stringify(avatar.appearance) : null);
  const draft = useRef<AbortController | null>(null);
  useEffect(() => {
    if (lookKey === drawn.current || finalizing || refining) return;
    const timer = setTimeout(
      async () => {
        draft.current?.abort();
        const ctrl = new AbortController();
        draft.current = ctrl;
        setDrafting(true);
        setError(null);
        try {
          const { avatar: next, created } = await api.drawCharacter(avatar.id, token, look, "preview", ctrl.signal);
          drawn.current = lookKey;
          onChange(next);
          setSelected(created[0] ?? null);
        } catch (e) {
          if (!ctrl.signal.aborted) setError((e as Error).message);
        } finally {
          if (draft.current === ctrl) setDrafting(false);
        }
      },
      drawn.current === null ? 200 : 1100,
    );
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lookKey, finalizing, refining]);
  useEffect(() => () => draft.current?.abort(), []);

  async function finalize() {
    draft.current?.abort();
    setFinalizing(true);
    setError(null);
    try {
      const { avatar: next, created } = await api.drawCharacter(avatar.id, token, look, "final");
      drawn.current = lookKey;
      onChange(next);
      setSelected(created[0] ?? null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setFinalizing(false);
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
    if (locked) {
      // The plans page leads through sign-in and checkout, then back here.
      router.push(plansUrl);
      return;
    }
    setBuilding(true);
    setError(null);
    try {
      const { avatar: next } = await api.buildModel(avatar.id, token, selected);
      onChange(next);
      goTo(next.voice ? "persona" : "voice");
    } catch (e) {
      // The server has the final say on plans (for example this month's builds are used up).
      if (e instanceof ApiError && e.status === 401) router.push(`/login?next=${encodeURIComponent(here)}`);
      else setError((e as Error).message);
      setNeedsUpgrade(e instanceof ApiError && e.status === 402);
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
  const isFinal = selectedConcept?.kind === "final";
  const recent = avatar.concepts.slice(0, 8);
  const modelBusy = !!avatar.model && avatar.model.status !== "ready" && avatar.model.status !== "failed";

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_460px]">
      <section className="space-y-8">
        <div>
          <p className="text-sm font-medium text-accent-600">Step 2</p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight sm:text-4xl">Design your character</h1>
          <p className="mt-2 max-w-xl text-ink-600">
            Try bodies, hair and outfits: a quick sketch of you updates as you go. When you like it, we draw your final
            character with close attention to your face, then turn it into 3D.
          </p>
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
              <p className="text-sm font-semibold">{isFinal ? "Your character" : "Quick sketch"}</p>
              <p className="text-xs text-ink-500">
                {finalizing
                  ? "Drawing your final character. About 30 seconds."
                  : isFinal
                    ? "Happy with it? Tweak it with words, or bring it to life."
                    : "Updates as you change things. Your final character is drawn in more detail."}
              </p>
            </div>
            {drafting && <Spinner className="size-4 text-ink-400" />}
          </div>

          <div className="relative mx-auto mt-4 aspect-[2/3] w-full max-w-[320px] overflow-hidden rounded-2xl bg-white">
            {selectedConcept ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={ownerUrl(selectedConcept.imageUrl, token)}
                alt={isFinal ? "Your character" : "Quick sketch of your character"}
                className={cx("size-full object-contain transition-opacity", (drafting || finalizing) && "opacity-50")}
              />
            ) : (
              <div className="grid size-full animate-pulse place-items-center bg-gradient-to-b from-ink-100 to-ink-50 px-6 text-center text-sm text-ink-500">
                Drawing you for the first time. This takes about 15 seconds.
              </div>
            )}
            {finalizing && (
              <div className="absolute inset-0 grid place-items-center">
                <span className="flex items-center gap-2 rounded-full bg-ink-900/80 px-3.5 py-2 text-xs font-medium text-white">
                  <Spinner className="size-3.5" /> Drawing your final character
                </span>
              </div>
            )}
            {isFinal && !finalizing && (
              <span className="absolute left-2 top-2 rounded-full bg-accent-500 px-2 py-0.5 text-[10px] font-medium text-white">Final</span>
            )}
          </div>

          {recent.length > 1 && (
            <div className="mt-3 flex gap-1.5 overflow-x-auto pb-1">
              {recent.map((c) => (
                <ConceptTile
                  key={c.id}
                  url={ownerUrl(c.imageUrl, token)}
                  selected={c.id === selected}
                  final={c.kind === "final"}
                  built={c.id === builtFrom}
                  onClick={() => setSelected(c.id)}
                />
              ))}
            </div>
          )}

          {isFinal && (
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
              <Notice tone="error">
                <span>{error}</span>
                {needsUpgrade && (
                  <Link href={plansUrl} className="ml-1 font-medium underline">
                    See plans
                  </Link>
                )}
              </Notice>
            </div>
          )}

          {isFinal ? (
            <>
              <Button size="lg" className="mt-4 w-full" disabled={modelBusy || finalizing} loading={building} onClick={build} variant="dark">
                {builtFrom && builtFrom !== selected
                  ? "Rebuild 3D with this look"
                  : builtFrom === selected && avatar.model?.status === "failed"
                    ? "Try building again"
                    : builtFrom === selected && avatar.model?.status === "ready"
                      ? "Rebuild 3D"
                      : "Bring it to life in 3D"}
              </Button>
              <div className="mt-2 flex items-center justify-between text-xs text-ink-500">
                <span>{locked ? `Part of the Creator plan, $${PLANS.creator.price} a month.` : "Building takes a few minutes."}</span>
                <button type="button" className="underline hover:text-ink-800 disabled:opacity-50" disabled={finalizing} onClick={finalize}>
                  Draw it again
                </button>
              </div>
            </>
          ) : (
            <>
              <Button size="lg" className="mt-4 w-full" disabled={!selectedConcept || drafting} loading={finalizing} onClick={finalize}>
                Create my character
              </Button>
              <p className="mt-2 text-center text-xs text-ink-500">Takes about 30 seconds. You can still tweak it afterwards.</p>
            </>
          )}
        </Card>
        {avatar.model && <BuildCard avatar={avatar} />}
        {avatar.model?.status === "failed" && (
          <Notice tone="warn">Try building again, or draw your character again first.</Notice>
        )}
        {modelBusy && (
          <Button variant="secondary" className="w-full" onClick={() => goTo(avatar.voice ? "persona" : "voice")}>
            Continue while it builds
          </Button>
        )}
      </aside>
    </div>
  );
}

function ConceptTile({
  url,
  selected,
  final,
  built,
  onClick,
}: {
  url: string;
  selected: boolean;
  final: boolean;
  built: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      title={final ? "Final character" : "Quick sketch"}
      className={cx(
        "relative aspect-[2/3] w-12 shrink-0 overflow-hidden rounded-lg border-2 bg-white transition-all",
        selected ? "border-accent-500" : "border-transparent hover:border-ink-200",
        !final && "opacity-70",
      )}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={url} alt="" className="size-full object-contain" />
      {(final || built) && (
        <span className={cx("absolute right-0.5 top-0.5 size-2 rounded-full", built ? "bg-ink-900" : "bg-accent-500")} />
      )}
    </button>
  );
}
