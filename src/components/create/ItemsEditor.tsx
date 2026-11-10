"use client";

/* eslint-disable @next/next/no-img-element -- item thumbnails live on any host the creator links to */

import { useState } from "react";
import {
  CONTEXT_LIMITS,
  createItemId,
  displayHost,
  itemProblem,
  videoSource,
  type ContextItem,
  type ItemKind,
} from "@/lib/avatar/context";
import { BagIcon, ImageIcon, LinkIcon, PlayIcon } from "@/components/ItemCard";
import { Button, cx, Field, inputClass } from "@/components/ui";

/** An item as typed in the form: any field may still be blank or invalid. */
export type DraftItem = ContextItem;

const KINDS: { id: ItemKind; label: string; icon: React.ReactNode; urlLabel: string; urlPlaceholder: string }[] = [
  { id: "link", label: "Link", icon: <LinkIcon className="size-4" />, urlLabel: "Link", urlPlaceholder: "https://open.spotify.com/album/…" },
  { id: "product", label: "Product", icon: <BagIcon className="size-4" />, urlLabel: "Link to buy", urlPlaceholder: "https://shop.example.com/tee" },
  { id: "video", label: "Video", icon: <PlayIcon className="size-4" />, urlLabel: "Video link", urlPlaceholder: "YouTube, Vimeo or an .mp4 link" },
  { id: "image", label: "Image", icon: <ImageIcon className="size-4" />, urlLabel: "Link when tapped (optional)", urlPlaceholder: "https://…" },
];

const kindOf = (id: ItemKind) => KINDS.find((k) => k.id === id) ?? KINDS[0];

/**
 * Lets the creator build the catalog of things their avatar can put on
 * screen. Items that aren't complete yet stay in the form and are left out of
 * what gets saved (see `savableItems`).
 */
export function ItemsEditor({ items, onChange }: { items: DraftItem[]; onChange: (items: DraftItem[]) => void }) {
  const [openId, setOpenId] = useState<string | null>(null);

  const update = (id: string, patch: Partial<DraftItem>) => onChange(items.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  const add = (kind: ItemKind) => {
    const item: DraftItem = { id: createItemId(), kind, title: "" };
    onChange([...items, item]);
    setOpenId(item.id);
  };

  return (
    <div className="space-y-2">
      {items.map((item) => {
        const problem = itemProblem(item);
        const open = openId === item.id;
        const kind = kindOf(item.kind);
        const video = item.kind === "video" ? videoSource(item.url) : null;
        const thumb = item.image || (video?.type === "embed" ? video.thumbnail : undefined);
        return (
          <div key={item.id} className={cx("rounded-2xl border bg-card", open ? "border-accent-300" : "border-ink-200")}>
            <button
              type="button"
              onClick={() => setOpenId(open ? null : item.id)}
              aria-expanded={open}
              className="flex w-full items-center gap-3 p-2 pr-3 text-left"
            >
              {thumb ? (
                <img src={thumb} alt="" referrerPolicy="no-referrer" className="size-10 shrink-0 rounded-xl bg-ink-50 object-cover" />
              ) : (
                <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-accent-50 text-accent-600">{kind.icon}</span>
              )}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-ink-900">{item.title || `New ${kind.label.toLowerCase()}`}</span>
                <span className={cx("block truncate text-xs", problem ? "text-amber-700" : "text-ink-500")}>
                  {problem ? `Not saved yet: ${problem}` : [kind.label, item.price, displayHost(item.url ?? item.image)].filter(Boolean).join(" · ")}
                </span>
              </span>
              <Chevron open={open} />
            </button>

            {open && (
              <div className="space-y-3 border-t border-ink-100 p-3">
                <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Type">
                  {KINDS.map((k) => (
                    <button
                      key={k.id}
                      type="button"
                      role="radio"
                      aria-checked={item.kind === k.id}
                      onClick={() => update(item.id, { kind: k.id })}
                      className={cx(
                        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition-colors",
                        item.kind === k.id ? "border-accent-500 bg-accent-50 text-accent-700" : "border-ink-200 text-ink-600 hover:bg-ink-50",
                      )}
                    >
                      {k.icon}
                      {k.label}
                    </button>
                  ))}
                </div>
                <Field label="Title">
                  <input
                    className={inputClass}
                    value={item.title}
                    maxLength={120}
                    placeholder={item.kind === "product" ? "Tour tee" : item.kind === "video" ? "Studio session" : "My new EP"}
                    onChange={(e) => update(item.id, { title: e.target.value })}
                  />
                </Field>
                {item.kind === "image" && (
                  <Field label="Image link">
                    <input
                      className={inputClass}
                      value={item.image ?? ""}
                      inputMode="url"
                      placeholder="https://…/poster.jpg"
                      onChange={(e) => update(item.id, { image: e.target.value })}
                    />
                  </Field>
                )}
                <Field label={kind.urlLabel}>
                  <input
                    className={inputClass}
                    value={item.url ?? ""}
                    inputMode="url"
                    placeholder={kind.urlPlaceholder}
                    onChange={(e) => update(item.id, { url: e.target.value })}
                  />
                </Field>
                <Field label="Description" hint="Shown on the card. Optional.">
                  <input
                    className={inputClass}
                    value={item.description ?? ""}
                    maxLength={300}
                    onChange={(e) => update(item.id, { description: e.target.value })}
                  />
                </Field>
                {item.kind === "product" && (
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Price">
                      <input className={inputClass} value={item.price ?? ""} maxLength={32} placeholder="$25" onChange={(e) => update(item.id, { price: e.target.value })} />
                    </Field>
                    <Field label="Button">
                      <input className={inputClass} value={item.cta ?? ""} maxLength={24} placeholder="Buy" onChange={(e) => update(item.id, { cta: e.target.value })} />
                    </Field>
                  </div>
                )}
                {item.kind !== "image" && (
                  <Field label="Thumbnail image link" hint={item.kind === "video" ? "Optional. YouTube thumbnails are added automatically." : "Optional."}>
                    <input
                      className={inputClass}
                      value={item.image ?? ""}
                      inputMode="url"
                      placeholder="https://…/cover.jpg"
                      onChange={(e) => update(item.id, { image: e.target.value })}
                    />
                  </Field>
                )}
                <Field label="When should your avatar show it?" hint="Only your avatar sees this.">
                  <input
                    className={inputClass}
                    value={item.notes ?? ""}
                    maxLength={300}
                    placeholder="When someone asks about my music or what I'm working on"
                    onChange={(e) => update(item.id, { notes: e.target.value })}
                  />
                </Field>
                <div className="flex justify-between">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      onChange(items.filter((x) => x.id !== item.id));
                      setOpenId(null);
                    }}
                  >
                    Remove
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => setOpenId(null)}>
                    Done
                  </Button>
                </div>
              </div>
            )}
          </div>
        );
      })}

      {items.length < CONTEXT_LIMITS.items && (
        <div className="flex flex-wrap items-center gap-1.5 pt-1">
          <span className="mr-1 text-xs text-ink-500">Add</span>
          {KINDS.map((k) => (
            <button
              key={k.id}
              type="button"
              onClick={() => add(k.id)}
              className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-ink-300 px-3 py-1.5 text-sm text-ink-700 transition-colors hover:border-accent-400 hover:bg-accent-50 hover:text-accent-700"
            >
              {k.icon}
              {k.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** The items that are complete and valid, which is what gets saved. */
export function savableItems(items: DraftItem[]): ContextItem[] {
  return items.filter((item) => !itemProblem(item));
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden className={cx("size-4 shrink-0 text-ink-400 transition-transform", open && "rotate-180")}>
      <path d="m6 9 6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
