"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { EXTRA_TINTS, HEAD_PICTURE, SLOTS, colorHex, hairHex, itemPicture, slotView, type ItemPicture, type Slot } from "@/lib/avatar/items";
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

type Garment = "top" | "outer" | "bottom" | "shoes";
const GARMENTS: Record<Garment, readonly { id: string; label: string }[]> = { top: TOPS, outer: OUTERWEAR, bottom: BOTTOMS, shoes: SHOES };
const isGarment = (slot: Slot): slot is Garment => slot in GARMENTS;

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

/** What a preview usually takes once the person's first picture exists, for the progress bar. */
const PREVIEW_SECONDS = 3.5;
/** What drawing the person takes: their portrait, then the character. */
const DRAWING_SECONDS = 30;
const CHARACTER_SECONDS = 20;
/** How long to keep asking whether the first picture is ready before leaving it to the Preview button. */
const STARTER_WAIT_MS = 100_000;

/** A bar that fills over roughly the time the work takes, so a wait has a visible end. */
function Progress({ seconds, className }: { seconds: number; className?: string }) {
  return (
    <span className={cx("block h-1 overflow-hidden bg-ink-900/10", className)}>
      <span className="block h-full origin-left bg-accent-500" style={{ animation: `preview-fill ${seconds}s cubic-bezier(0.2, 0.7, 0.3, 1) forwards` }} />
    </span>
  );
}

/** Pure black cloth would lose its folds; this keeps a little light in the darkest tints. */
function lifted(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const channel = (shift: number) => Math.round(((n >> shift) & 255) * 0.92 + 14);
  return `rgb(${channel(16)}, ${channel(8)}, ${channel(0)})`;
}

/**
 * One item, in its color. The picture is the item in white with its shading;
 * here it is multiplied with the color and kept to the item's own shape.
 */
function ItemImage({ picture, className }: { picture: ItemPicture; className?: string }) {
  const mask = `url(${picture.src})`;
  return (
    <span className={cx("relative block", className)}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {picture.base && <img src={picture.base} alt="" className="absolute inset-0 size-full" />}
      {/* The thin shadow gives white and pale items an edge against a pale card. */}
      <span className="absolute inset-0" style={{ filter: "drop-shadow(0 0 0.5px rgb(22 21 26 / 0.55)) drop-shadow(0 1px 1.5px rgb(22 21 26 / 0.18))" }}>
        <span
          className="absolute inset-0 isolate"
          style={{ backgroundColor: lifted(picture.tint), WebkitMaskImage: mask, maskImage: mask, WebkitMaskSize: "100% 100%", maskSize: "100% 100%" }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={picture.src} alt="" className="size-full mix-blend-multiply" />
        </span>
      </span>
    </span>
  );
}

/** A choice in a picker: the item's picture and its name. */
function ItemCard({
  label,
  selected,
  onClick,
  children,
}: {
  label: string;
  selected: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={cx(
        "flex flex-col items-center rounded-2xl border bg-card p-1.5 pb-2 text-center transition-colors",
        selected ? "border-accent-500 ring-2 ring-accent-100" : "border-ink-100 hover:border-ink-300",
      )}
    >
      <span className="grid aspect-square w-full place-items-center overflow-hidden rounded-xl bg-ink-50">{children}</span>
      <span className={cx("mt-1.5 line-clamp-1 text-xs", selected ? "font-medium text-accent-700" : "text-ink-700")}>{label}</span>
    </button>
  );
}

const Empty = ({ children }: { children: ReactNode }) => <span className="px-1 text-[10px] leading-tight text-ink-400">{children}</span>;
const cardGrid = "grid grid-cols-3 gap-2 sm:grid-cols-4 xl:grid-cols-5";

export function LookStep({ avatar, token, onChange, goTo, autoBuild }: StepProps & { autoBuild?: string | null }) {
  const [look, setLook] = useState<Appearance>(avatar.appearance);
  const [slot, setSlot] = useState<Slot>("top");
  const [previewing, setPreviewing] = useState(false);
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

  const selectedConcept = avatar.concepts.find((c) => c.id === selected) ?? null;
  const builtFrom = avatar.model?.conceptId;
  // Coming back from checkout, the build starts by itself (see the effect below).
  const plansUrl = `/pricing?next=${encodeURIComponent(selected ? `${here}&build=${selected}` : here)}`;

  // Which look each picture of the person shows, so the page knows whether the
  // picture on screen is the loadout as it stands, and a look previewed before
  // comes back without drawing it again.
  const lookKey = JSON.stringify(look);
  const [shows, setShows] = useState<Record<string, string>>(selected ? { [selected]: JSON.stringify(avatar.appearance) } : {});
  // Previews as they arrived inside the response, shown without a second request.
  const [inline, setInline] = useState<Record<string, string>>({});
  /** The loadout has changed since the picture on screen was drawn. */
  const changed = !selectedConcept || shows[selectedConcept.id] !== lookKey;
  const isFinal = selectedConcept?.kind === "final";
  /** The first picture of the person is still being drawn (it was started when the selfie was uploaded). */
  const preparing = !avatar.sketchable && avatar.concepts.length === 0;

  const set = (patch: Partial<Appearance>) => setLook((l) => ({ ...l, ...patch }));
  /** Opens a slot's choices from their start (on a phone the previous slot's list may have been scrolled). */
  const openSlot = (next: Slot) => {
    setSlot(next);
    if (window.scrollY > 0 && !window.matchMedia("(min-width: 1024px)").matches) window.scrollTo({ top: 0 });
  };

  // The first picture is drawn in the background; show it as soon as it is there.
  useEffect(() => {
    if (!preparing) return;
    const started = Date.now();
    const timer = setInterval(async () => {
      if (Date.now() - started > STARTER_WAIT_MS) return clearInterval(timer);
      try {
        const { avatar: next } = await api.get(avatar.id, token);
        const first = next.concepts[0];
        if (!first) return;
        clearInterval(timer);
        onChange(next);
        setShows((m) => ({ ...m, [first.id]: JSON.stringify(next.appearance) }));
        setSelected((current) => current ?? first.id);
      } catch {}
    }, 3000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preparing, avatar.id, token]);

  /** Shows the loadout on the person: a quick restyle of their picture, or one drawn for this look before. */
  async function preview() {
    const known = avatar.concepts.find((c) => shows[c.id] === lookKey);
    if (known) return setSelected(known.id);
    setPreviewing(true);
    setError(null);
    try {
      const { avatar: next, created, inline: picture } = await api.drawCharacter(avatar.id, token, look, "preview");
      const id = created[0];
      if (id) setShows((m) => ({ ...m, [id]: lookKey }));
      if (id && picture) setInline((m) => ({ ...m, [id]: picture }));
      onChange(next);
      setSelected(id ?? null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPreviewing(false);
    }
  }

  async function finalize() {
    setFinalizing(true);
    setError(null);
    try {
      const { avatar: next, created } = await api.drawCharacter(avatar.id, token, look, "final");
      const id = created[0];
      if (id) setShows((m) => ({ ...m, [id]: lookKey }));
      onChange(next);
      setSelected(id ?? null);
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
      const id = created[0];
      // A tweak in words keeps the loadout it was made from.
      if (id) setShows((m) => ({ ...m, [id]: m[selected] ?? lookKey }));
      onChange(next);
      setSelected(id ?? selected);
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

  const recent = avatar.concepts.slice(0, 8);
  const modelBusy = !!avatar.model && avatar.model.status !== "ready" && avatar.model.status !== "failed";
  const busy = previewing || finalizing;
  const pictureOf = (c: { id: string; imageUrl: string }) => inline[c.id] ?? ownerUrl(c.imageUrl, token);
  const photo = avatar.selfieUrl ? ownerUrl(avatar.selfieUrl, token) : null;

  /** A slot of the loadout: what is in it, and a tap opens its choices. */
  const tile = (s: (typeof SLOTS)[number]) => {
    const view = slotView(look, s.id);
    return (
      <button
        key={s.id}
        type="button"
        onClick={() => openSlot(s.id)}
        aria-pressed={slot === s.id}
        aria-label={`${s.label}: ${view.name}`}
        className={cx(
          "flex min-w-0 flex-col items-center rounded-xl border p-1 transition-colors",
          slot === s.id ? "border-accent-500 bg-accent-50" : "border-ink-100 bg-card hover:border-ink-300",
        )}
      >
        <span className="relative grid aspect-square w-full place-items-center overflow-hidden rounded-lg bg-ink-50">
          {view.pictures.length === 1 && <ItemImage picture={view.pictures[0]} className="size-full" />}
          {view.pictures.length > 1 && (
            <span className="grid size-full grid-cols-2 gap-px">
              {view.pictures.slice(0, 4).map((p) => (
                <ItemImage key={p.src} picture={p} className="size-full" />
              ))}
            </span>
          )}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {view.head && <img src={HEAD_PICTURE} alt="" className="size-full" />}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {view.fromPhoto && photo && <img src={photo} alt="" className="size-full object-cover" />}
          {view.empty && <Empty>None</Empty>}
          {s.id === "body" && (
            <Empty>
              {view.name.split(", ").map((part) => (
                <span key={part} className="block capitalize">
                  {part}
                </span>
              ))}
            </Empty>
          )}
        </span>
        <span className={cx("mt-0.5 w-full truncate text-center text-[10px]", slot === s.id ? "font-medium text-accent-700" : "text-ink-500")}>{s.label}</span>
      </button>
    );
  };

  // The same actions sit in the preview card on a wide screen and in a bar at the bottom of a phone.
  const actions: ReactNode = (
    <>
      {isFinal && !changed && (
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
      {isFinal && !changed ? (
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
          <div className="flex gap-2">
            {/* Preview first when the loadout has changed; commit once the picture shows it. */}
            <Button size="lg" variant={changed ? "primary" : "secondary"} className="flex-1 whitespace-nowrap px-2!" disabled={!changed || finalizing} loading={previewing} onClick={preview}>
              Preview on me
            </Button>
            <Button size="lg" variant={changed ? "secondary" : "primary"} className="flex-1 whitespace-nowrap px-2!" disabled={previewing} loading={finalizing} onClick={finalize}>
              Create character
            </Button>
          </div>
          <p className="hidden text-center text-xs text-ink-500 lg:block">
            {changed
              ? "A quick preview takes a few seconds. Creating your character draws it in full detail, in about 20."
              : "Like it? Create your character in full detail (about 20 seconds), or keep changing things."}
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

  const hairTint = hairHex(look);
  const garment = isGarment(slot) ? slot : null;

  return (
    <div className="grid gap-x-8 gap-y-4 pb-32 lg:grid-cols-[minmax(0,1fr)_460px] lg:grid-rows-[auto_1fr] lg:pb-0">
      <div className="lg:col-start-1">
        <p className="text-sm font-medium text-accent-600">Step 2</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-4xl">Design your character</h1>
        <p className="mt-2 hidden max-w-xl text-ink-600 sm:block">
          Pick what you wear, slot by slot. Preview the look on yourself whenever you like, then create your character and
          bring it to life in 3D.
        </p>
      </div>

      {/* You and your loadout stay on screen while the choices scroll: on a phone they are pinned under the header. */}
      <aside className="sticky top-[5.5rem] z-20 -mx-4 space-y-3 bg-paper/95 px-4 pb-3 pt-1 backdrop-blur lg:top-24 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:mx-0 lg:space-y-4 lg:self-start lg:bg-transparent lg:p-0 lg:backdrop-blur-none">
        <Card className="p-2 lg:p-4">
          <div className="flex gap-2.5 lg:block">
            <div className="relative aspect-[2/3] h-[min(31dvh,264px)] shrink-0 overflow-hidden rounded-2xl bg-white lg:mx-auto lg:h-auto lg:w-full lg:max-w-[300px]">
              {selectedConcept ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={pictureOf(selectedConcept)}
                  alt={isFinal ? "Your character" : "Preview of your character"}
                  className={cx("size-full object-contain transition-opacity duration-200", (finalizing || previewing) && "opacity-40")}
                />
              ) : (
                <div className="grid size-full place-items-center bg-gradient-to-b from-ink-100 to-ink-50 px-3 text-center">
                  <div>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    {photo && <img src={photo} alt="Your photo" className="mx-auto size-12 rounded-full object-cover" />}
                    <p className="mt-2 text-xs font-medium text-ink-800">{preparing ? "Drawing you" : "Your character"}</p>
                    <p className="mt-1 text-[11px] leading-snug text-ink-500">
                      {preparing ? "About half a minute. Pick your look meanwhile." : "Pick your look, then preview it on you."}
                    </p>
                  </div>
                </div>
              )}
              {busy && (
                <div className="absolute inset-0 grid place-items-center px-2">
                  <span className="flex items-center gap-2 rounded-full bg-ink-900/80 px-3 py-1.5 text-center text-[11px] font-medium text-white">
                    <Spinner className="size-3 shrink-0" /> {finalizing ? "Drawing your character" : "Putting it on you"}
                  </span>
                </div>
              )}
              {selectedConcept && !busy && (
                <span
                  className={cx(
                    "absolute left-2 top-2 rounded-full px-2 py-0.5 text-[10px] font-medium text-white",
                    changed ? "bg-ink-900/60" : isFinal ? "bg-accent-500" : "bg-ink-900/70",
                  )}
                >
                  {changed ? "Earlier look" : isFinal ? "Final" : "Preview"}
                </span>
              )}
              {(busy || (preparing && !selectedConcept)) && (
                <Progress
                  key={finalizing ? "final" : previewing ? lookKey : "first"}
                  seconds={finalizing ? CHARACTER_SECONDS : previewing && avatar.sketchable ? PREVIEW_SECONDS : DRAWING_SECONDS}
                  className="absolute inset-x-0 bottom-0"
                />
              )}
            </div>

            <div className="min-w-0 flex-1 lg:mt-4">
              <p className="mb-1.5 hidden text-xs font-medium text-ink-500 lg:block">Your loadout</p>
              <div className="grid grid-cols-3 gap-1.5 lg:grid-cols-8">{SLOTS.map(tile)}</div>
              {recent.length > 1 && (
                <div className="mt-2 hidden gap-1.5 overflow-x-auto pb-1 lg:flex">
                  {recent.map((c) => (
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
              )}
            </div>
          </div>

          <div className="mt-4 hidden space-y-3 lg:block">{actions}</div>
        </Card>
        <div className="hidden space-y-4 lg:block">{buildInfo}</div>
      </aside>

      <section className="min-w-0 space-y-5 lg:col-start-1">
        {garment && (
          <>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="mr-1 text-xs font-medium text-ink-500">Start from</span>
              {OUTFIT_PRESETS.map((p) => (
                <Chip key={p.id} onClick={() => set(p.outfit)}>
                  {p.label}
                </Chip>
              ))}
              <Chip className="border-dashed" onClick={() => set(randomOutfit())}>
                Surprise me
              </Chip>
            </div>
            <div>
              <SectionTitle title={SLOTS.find((s) => s.id === garment)!.label} />
              <div className={cardGrid}>
                {GARMENTS[garment].map((item) => {
                  const value = look[garment];
                  const choose = () => set({ [garment]: { ...value, type: item.id } } as Partial<Appearance>);
                  return (
                    <ItemCard key={item.id} label={item.label} selected={value.type === item.id} onClick={choose}>
                      {item.id === "none" ? <Empty>No layer</Empty> : <ItemImage picture={itemPicture(garment, item.id, colorHex(value.color))} className="size-full" />}
                    </ItemCard>
                  );
                })}
              </div>
            </div>
            {!(garment === "outer" && look.outer.type === "none") && (
              <div>
                <SectionTitle title="Color" />
                <Swatches
                  label={`${garment} color`}
                  value={look[garment].color}
                  colors={COLORS}
                  onChange={(color) => set({ [garment]: { ...look[garment], color } } as Partial<Appearance>)}
                />
              </div>
            )}
          </>
        )}

        {slot === "hair" && (
          <>
            <div>
              <SectionTitle title="Hair" hint="Keep it as in your photo, or try something new." />
              <div className={cardGrid}>
                <ItemCard label="As in photo" selected={look.hair.keep} onClick={() => set({ hair: { ...look.hair, keep: true } })}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {photo ? <img src={photo} alt="" className="size-full object-cover" /> : <Empty>Your photo</Empty>}
                </ItemCard>
                {HAIR_STYLES.map((h) => (
                  <ItemCard
                    key={h.id}
                    label={h.label}
                    selected={!look.hair.keep && look.hair.style === h.id}
                    onClick={() => set({ hair: { ...look.hair, keep: false, style: h.id } })}
                  >
                    {h.id === "bald" ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={HEAD_PICTURE} alt="" className="size-full" />
                    ) : (
                      <ItemImage picture={itemPicture("hair", h.id, look.hair.keep ? "#6a4428" : hairTint)} className="size-full" />
                    )}
                  </ItemCard>
                ))}
              </div>
            </div>
            {!look.hair.keep && look.hair.style !== "bald" && (
              <div>
                <SectionTitle title="Color" />
                <Swatches
                  label="Hair color"
                  value={look.hair.color}
                  colors={HAIR_COLORS}
                  onChange={(color) => set({ hair: { ...look.hair, color: color as Appearance["hair"]["color"] } })}
                />
              </div>
            )}
          </>
        )}

        {slot === "beard" && (
          <div>
            <SectionTitle title="Facial hair" hint="Shown in your hair color." />
            <div className={cardGrid}>
              {FACIAL_HAIR.map((f) => (
                <ItemCard key={f.id} label={f.label} selected={look.facialHair === f.id} onClick={() => set({ facialHair: f.id })}>
                  {f.id === "keep" ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    photo ? <img src={photo} alt="" className="size-full object-cover" /> : <Empty>Your photo</Empty>
                  ) : f.id === "none" ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={HEAD_PICTURE} alt="" className="size-full" />
                  ) : (
                    <ItemImage picture={itemPicture("beard", f.id, hairTint)} className="size-full" />
                  )}
                </ItemCard>
              ))}
            </div>
          </div>
        )}

        {slot === "extras" && (
          <>
            <div>
              <SectionTitle title="Accessories" hint="Up to five." />
              <div className={cardGrid}>
                {ACCESSORIES.map((a) => {
                  const on = look.accessories.includes(a.id);
                  const toggle = () => set({ accessories: on ? look.accessories.filter((x) => x !== a.id) : [...look.accessories, a.id].slice(-5) });
                  return (
                    <ItemCard key={a.id} label={a.label} selected={on} onClick={toggle}>
                      <ItemImage picture={itemPicture("extra", a.id, EXTRA_TINTS[a.id])} className="size-full" />
                    </ItemCard>
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
          </>
        )}

        {slot === "body" && (
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

        {recent.length > 1 && (
          <div className="lg:hidden">
            <SectionTitle title="Pictures of you so far" />
            <div className="flex gap-1.5 overflow-x-auto pb-1">
              {recent.map((c) => (
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
      title={final ? "Final character" : "Preview"}
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
