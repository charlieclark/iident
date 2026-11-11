"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
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

type Tab = "outfit" | "hair" | "body" | "extras";
const TABS: { id: Tab; label: string }[] = [
  { id: "outfit", label: "Outfit" },
  { id: "hair", label: "Hair" },
  { id: "body", label: "Body" },
  { id: "extras", label: "Extras" },
];

const pick = <T,>(xs: readonly T[]) => xs[Math.floor(Math.random() * xs.length)];

/** A preset outfit in a random color, with or without an accessory. */
function randomOutfit(): Partial<Appearance> {
  const preset = pick(OUTFIT_PRESETS);
  return {
    ...preset.outfit,
    top: { ...preset.outfit.top, color: pick(COLORS).id },
    accessories: Math.random() < 0.5 ? [pick(ACCESSORIES).id] : [],
  };
}

/** How long to wait after a change before drawing: long enough to catch a second tap, short enough not to be felt. */
const REDRAW_AFTER_MS = 450;
/** Typing takes longer to finish than tapping. */
const REDRAW_AFTER_TYPING_MS = 900;
/** Most looks on the mannequin have been drawn for someone before and only need fetching. */
const MANNEQUIN_AFTER_MS = 200;
/** What a sketch usually takes, for the progress bar. */
const SKETCH_SECONDS = 3.5;
/** What drawing the person takes once their portrait is ready. */
const CHARACTER_SECONDS = 20;

/** Resolves once the browser has the picture, so it can be swapped in without a blank moment. */
const loaded = (src: string) =>
  new Promise<string>((resolve) => {
    const img = new Image();
    img.onload = img.onerror = () => resolve(src);
    img.src = src;
  });

/** A bar that fills over roughly the time the work takes, so a wait has a visible end. */
function Progress({ seconds, className }: { seconds: number; className?: string }) {
  return (
    <span className={cx("block h-1 overflow-hidden bg-ink-900/10", className)}>
      <span className="block h-full origin-left bg-accent-500" style={{ animation: `preview-fill ${seconds}s cubic-bezier(0.2, 0.7, 0.3, 1) forwards` }} />
    </span>
  );
}

export function LookStep({ avatar, token, onChange, goTo, autoBuild }: StepProps & { autoBuild?: string | null }) {
  const [look, setLook] = useState<Appearance>(avatar.appearance);
  const [tab, setTab] = useState<Tab>("outfit");
  const [drafting, setDrafting] = useState(false);
  const [finalizing, setFinalizing] = useState(false);
  const [refining, setRefining] = useState(false);
  const [building, setBuilding] = useState(false);
  const [needsUpgrade, setNeedsUpgrade] = useState(false);
  const router = useRouter();
  const { account } = useAccount();
  const here = `/create?id=${avatar.id}`;
  /** Building in 3D needs a plan (when payments are switched on). */
  const locked = needsPlan(account);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(avatar.selectedConceptId ?? avatar.concepts[0]?.id ?? null);
  const [instruction, setInstruction] = useState("");
  const [slot, setSlot] = useState<Slot>("top");

  const selectedConcept = avatar.concepts.find((c) => c.id === selected) ?? null;
  const builtFrom = avatar.model?.conceptId;
  /**
   * Whether quick sketches show the person themselves. They can once a
   * character of them has been drawn. Until then looks are tried on a
   * mannequin, which needs no drawing of them and is shared by everyone, so
   * there is nothing to wait for before the first choice.
   */
  const onYou = avatar.sketchable;
  // Coming back from checkout, the build starts by itself (see the effect below).
  const plansUrl = `/pricing?next=${encodeURIComponent(selected ? `${here}&build=${selected}` : here)}`;

  // The picture follows the look as it changes.
  //   drawn      the look the picture on screen shows, so nothing is redrawn without a change
  //   requested  the look being drawn right now
  //   seen       every look drawn of the person this visit and its picture: going back to one is instant
  //   dressed    the same for looks on the mannequin
  //   inline     sketches as they arrived inside the response, shown without a second request
  const lookKey = JSON.stringify(look);
  const drawn = useRef<string | null>(selected ? JSON.stringify(avatar.appearance) : null);
  const requested = useRef<string | null>(null);
  const seen = useRef(new Map<string, string>(selected ? [[JSON.stringify(avatar.appearance), selected]] : []));
  const dressed = useRef(new Map<string, string>());
  const [mannequin, setMannequin] = useState<string | null>(null);
  const [inline, setInline] = useState<Record<string, string>>({});
  const draft = useRef<AbortController | null>(null);
  const typed = useRef(false);

  /** Changes the look. A look that was already drawn comes back at once, with no request. */
  function set(patch: Partial<Appearance>, typing = false) {
    const next = { ...look, ...patch };
    typed.current = typing;
    setLook(next);
    const key = JSON.stringify(next);
    const concept = onYou ? seen.current.get(key) : undefined;
    const picture = onYou ? undefined : dressed.current.get(key);
    if (!picture && !(concept && avatar.concepts.some((c) => c.id === concept))) return;
    draft.current?.abort();
    draft.current = null;
    requested.current = null;
    drawn.current = key;
    setDrafting(false);
    setSelected(concept ?? null);
    if (picture) setMannequin(picture);
  }

  useEffect(() => {
    if (finalizing || refining) return;
    if (lookKey === drawn.current || lookKey === requested.current) return;
    const timer = setTimeout(
      async () => {
        draft.current?.abort();
        const ctrl = new AbortController();
        draft.current = ctrl;
        requested.current = lookKey;
        setDrafting(true);
        setError(null);
        try {
          if (onYou) {
            const { avatar: next, created, inline: picture } = await api.drawCharacter(avatar.id, token, look, "preview", ctrl.signal);
            if (ctrl.signal.aborted) return;
            const id = created[0];
            drawn.current = lookKey;
            if (id) seen.current.set(lookKey, id);
            if (id && picture) setInline((m) => ({ ...m, [id]: picture }));
            onChange(next);
            setSelected(id ?? null);
          } else {
            const { url, inline: picture } = await api.mannequin(look, ctrl.signal);
            const src = picture ?? (await loaded(url));
            if (ctrl.signal.aborted) return;
            drawn.current = lookKey;
            dressed.current.set(lookKey, src);
            setMannequin(src);
            setSelected(null);
          }
        } catch (e) {
          if (!ctrl.signal.aborted) {
            // Not retried by itself: the next change draws again.
            drawn.current = lookKey;
            setError((e as Error).message);
          }
        } finally {
          if (draft.current === ctrl) {
            draft.current = null;
            requested.current = null;
            setDrafting(false);
          }
        }
      },
      // The mannequin appears at once on arrival; after that, a moment after the last change.
      !onYou && drawn.current === null ? 0 : typed.current ? REDRAW_AFTER_TYPING_MS : onYou ? REDRAW_AFTER_MS : MANNEQUIN_AFTER_MS,
    );
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lookKey, finalizing, refining, drafting, onYou]);
  useEffect(() => () => draft.current?.abort(), []);

  // While looks are tried on the mannequin, the outfit presets are fetched ahead, so tapping one shows it at once.
  useEffect(() => {
    if (onYou) return;
    let stopped = false;
    const start = setTimeout(async () => {
      for (const preset of OUTFIT_PRESETS) {
        const outfit = { ...avatar.appearance, ...preset.outfit };
        const key = JSON.stringify(outfit);
        if (stopped) return;
        if (dressed.current.has(key)) continue;
        try {
          const { url, inline: picture } = await api.mannequin(outfit);
          dressed.current.set(key, picture ?? (await loaded(url)));
        } catch {
          return; // previews are a nicety: stop quietly (for example at the rate limit)
        }
      }
    }, 800);
    return () => {
      stopped = true;
      clearTimeout(start);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onYou]);

  async function finalize() {
    draft.current?.abort();
    draft.current = null;
    requested.current = null;
    setDrafting(false);
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

  async function build(conceptId = selected) {
    if (!conceptId) return;
    if (locked) {
      // The plans page leads through checkout and back here, where the build then starts.
      router.push(plansUrl);
      return;
    }
    setSelected(conceptId);
    setBuilding(true);
    setError(null);
    try {
      const { avatar: next } = await api.buildModel(avatar.id, token, conceptId);
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

  // Back from checkout with a plan: the build that was paid for starts without another click.
  const autoStarted = useRef(false);
  useEffect(() => {
    if (!autoBuild || autoStarted.current || !account || locked) return;
    const start = setTimeout(() => {
      autoStarted.current = true;
      router.replace(here);
      const concept = avatar.concepts.find((c) => c.id === autoBuild);
      const busy = !!avatar.model && avatar.model.status !== "ready" && avatar.model.status !== "failed";
      if (concept?.kind === "final" && !busy && avatar.model?.conceptId !== autoBuild) void build(autoBuild);
    }, 0);
    return () => clearTimeout(start);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoBuild, account, locked]);

  const slotValue = look[slot];
  const isFinal = selectedConcept?.kind === "final";
  const recent = avatar.concepts.slice(0, 8);
  const modelBusy = !!avatar.model && avatar.model.status !== "ready" && avatar.model.status !== "failed";
  const onMannequin = !selectedConcept;
  const pictureOf = (c: { id: string; imageUrl: string }) => inline[c.id] ?? ownerUrl(c.imageUrl, token);

  const tabs = (
    <div role="tablist" aria-label="What to change" className="flex gap-1 rounded-full bg-ink-100 p-1">
      {TABS.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          aria-selected={tab === t.id}
          onClick={() => setTab(t.id)}
          className={cx(
            "h-9 flex-1 rounded-full text-sm font-medium transition-colors",
            tab === t.id ? "bg-card text-ink-900 shadow-soft" : "text-ink-600 hover:text-ink-900",
          )}
        >
          {t.label}
        </button>
      ))}
    </div>
  );

  // The same actions sit in the preview card on a wide screen and in a bar at the bottom of a phone.
  const actions: ReactNode = (
    <>
      {isFinal && (
        <div className="flex gap-2">
          <input
            className={inputClass}
            value={instruction}
            maxLength={240}
            placeholder="Tweak it: make the sneakers red…"
            aria-label="Describe a change to your character"
            onChange={(e) => setInstruction(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && refine()}
          />
          <Button variant="secondary" onClick={refine} loading={refining} disabled={instruction.trim().length < 2}>
            Apply
          </Button>
        </div>
      )}
      {error && (
        <Notice tone="error">
          <span>{error}</span>
          {needsUpgrade && (
            <Link href={plansUrl} className="ml-1 font-medium underline">
              See plans
            </Link>
          )}
        </Notice>
      )}
      {isFinal ? (
        <>
          <Button size="lg" className="w-full" disabled={modelBusy || finalizing} loading={building} onClick={() => build()} variant="dark">
            {builtFrom && builtFrom !== selected
              ? "Rebuild 3D with this look"
              : builtFrom === selected && avatar.model?.status === "failed"
                ? "Try building again"
                : builtFrom === selected && avatar.model?.status === "ready"
                  ? "Rebuild 3D"
                  : "Bring it to life in 3D"}
          </Button>
          <div className="flex items-center justify-between text-xs text-ink-500">
            <span>{locked ? `Part of the Creator plan, $${PLANS.creator.price} a month.` : "Building takes a few minutes."}</span>
            <button type="button" className="underline hover:text-ink-800 disabled:opacity-50" disabled={finalizing} onClick={finalize}>
              Draw it again
            </button>
          </div>
        </>
      ) : (
        <>
          <Button size="lg" className="w-full" disabled={!avatar.selfieUrl} loading={finalizing} onClick={finalize}>
            {onMannequin ? "Create my character in this look" : "Create my character"}
          </Button>
          <p className="hidden text-center text-xs text-ink-500 lg:block">
            {onMannequin ? "We draw you wearing it. About 20 seconds, and you can still change things afterwards." : "Takes about 20 seconds. You can still tweak it afterwards."}
          </p>
        </>
      )}
    </>
  );

  const buildInfo = (
    <>
      {avatar.model && <BuildCard avatar={avatar} />}
      {avatar.model?.status === "failed" && <Notice tone="warn">Try building again, or draw your character again first.</Notice>}
      {modelBusy && (
        <Button variant="secondary" className="w-full" onClick={() => goTo(avatar.voice ? "persona" : "voice")}>
          Continue while it builds
        </Button>
      )}
    </>
  );

  return (
    <div className="grid gap-x-8 gap-y-4 pb-36 lg:grid-cols-[minmax(0,1fr)_460px] lg:grid-rows-[auto_1fr] lg:pb-0">
      <div className="lg:col-start-1">
        <p className="text-sm font-medium text-accent-600">Step 2</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-4xl">Design your character</h1>
        <p className="mt-2 hidden max-w-xl text-ink-600 sm:block">
          Try bodies, hair and outfits: a quick sketch of you updates as you go. When you like it, we draw your final
          character with close attention to your face, then turn it into 3D.
        </p>
      </div>

      {/* The picture stays on screen while the options scroll: on a phone it is pinned under the header. */}
      <aside className="sticky top-[5.5rem] z-20 -mx-4 space-y-3 bg-paper/95 px-4 pb-3 pt-1 backdrop-blur lg:top-24 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:mx-0 lg:space-y-4 lg:self-start lg:bg-transparent lg:p-0 lg:backdrop-blur-none">
        <Card className="p-2 lg:p-4">
          <div className="hidden items-center gap-3 lg:flex">
            {avatar.selfieUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={ownerUrl(avatar.selfieUrl, token)} alt="" className="size-11 rounded-full object-cover" />
            )}
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">{isFinal ? "Your character" : onMannequin ? "Try on a look" : "Quick sketch"}</p>
              <p className="text-xs text-ink-500">
                {finalizing
                  ? "Drawing you in this look. About 20 seconds."
                  : isFinal
                    ? "Happy with it? Tweak it with words, or bring it to life."
                    : onMannequin
                      ? "Pick an outfit on the mannequin. When you like it, we draw you wearing it."
                      : "Updates as you change things. Your final character is drawn in more detail."}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-[2.75rem_auto_2.75rem] justify-center gap-2 lg:mt-4 lg:block">
            <div className="lg:hidden">
              {avatar.selfieUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={ownerUrl(avatar.selfieUrl, token)} alt="Your photo" className="size-11 rounded-full object-cover" />
              )}
            </div>
            <div className="relative mx-auto aspect-[2/3] h-[min(30dvh,260px)] overflow-hidden rounded-2xl bg-white lg:h-auto lg:w-full lg:max-w-[320px]">
              {selectedConcept || mannequin ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={selectedConcept ? pictureOf(selectedConcept) : mannequin!}
                  alt={isFinal ? "Your character" : selectedConcept ? "Quick sketch of your character" : "The look on a mannequin"}
                  className={cx("size-full object-contain transition-opacity duration-200", finalizing && "opacity-40")}
                />
              ) : (
                <div className="size-full animate-pulse bg-gradient-to-b from-ink-100 to-ink-50" />
              )}
              {finalizing && (
                <div className="absolute inset-0 grid place-items-center px-3">
                  <span className="flex items-center gap-2 rounded-full bg-ink-900/80 px-3.5 py-2 text-center text-xs font-medium text-white">
                    <Spinner className="size-3.5 shrink-0" /> {onMannequin ? "Drawing you in this look" : "Drawing your final character"}
                  </span>
                </div>
              )}
              {(selectedConcept || mannequin) && !finalizing && (
                <span
                  className={cx(
                    "absolute left-2 top-2 rounded-full px-2 py-0.5 text-[10px] font-medium",
                    isFinal ? "bg-accent-500 text-white" : "bg-ink-900/70 text-white",
                  )}
                >
                  {isFinal ? "Final" : onMannequin ? "Mannequin" : "Sketch"}
                </span>
              )}
              {drafting && onYou && (
                <span className="absolute right-2 top-2 flex items-center gap-1.5 rounded-full bg-ink-900/75 px-2 py-0.5 text-[10px] font-medium text-white">
                  <Spinner className="size-2.5" /> Updating
                </span>
              )}
              {(drafting || finalizing) && (
                <Progress key={finalizing ? "final" : lookKey} seconds={finalizing ? CHARACTER_SECONDS : SKETCH_SECONDS} className="absolute inset-x-0 bottom-0" />
              )}
            </div>
            <div className="flex max-h-[min(30dvh,260px)] flex-col gap-1.5 overflow-y-auto lg:mt-3 lg:max-h-none lg:flex-row lg:overflow-x-auto lg:pb-1">
              {recent.length > (onMannequin ? 0 : 1) &&
                recent.map((c) => (
                  <ConceptTile
                    key={c.id}
                    url={pictureOf(c)}
                    selected={c.id === selected}
                    final={c.kind === "final"}
                    built={c.id === builtFrom}
                    onClick={() => setSelected(c.id)}
                  />
                ))}
            </div>
          </div>

          <div className="mt-4 hidden space-y-3 lg:block">{actions}</div>
        </Card>
        <div className="lg:hidden">{tabs}</div>
        <div className="hidden space-y-4 lg:block">{buildInfo}</div>
      </aside>

      <section className="min-w-0 space-y-6 lg:col-start-1">
        <div className="hidden lg:block">{tabs}</div>

        {tab === "body" && (
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
        )}

        {tab === "hair" && (
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
        )}

        {tab === "outfit" && (
          <div>
            <div className="hidden lg:block">
              <SectionTitle title="Outfit" hint="Start from a preset, then fine-tune each piece." />
            </div>
            <div className="flex flex-wrap gap-1.5">
              {OUTFIT_PRESETS.map((p) => (
                <Chip key={p.id} onClick={() => set(p.outfit)}>
                  {p.label}
                </Chip>
              ))}
              <Chip className="border-dashed" onClick={() => set(randomOutfit())}>
                Surprise me
              </Chip>
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
        )}

        {tab === "extras" && (
          <>
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
                          accessories: on ? look.accessories.filter((x) => x !== a.id) : [...look.accessories, a.id].slice(-5),
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
                onChange={(e) => set({ extras: e.target.value }, true)}
              />
            </Field>
          </>
        )}

        <div className="space-y-4 lg:hidden">{buildInfo}</div>
      </section>

      <div className="fixed inset-x-0 bottom-0 z-30 space-y-2 border-t border-ink-100 bg-paper/95 px-4 pb-[max(0.625rem,env(safe-area-inset-bottom))] pt-2.5 backdrop-blur lg:hidden">
        {actions}
      </div>
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
