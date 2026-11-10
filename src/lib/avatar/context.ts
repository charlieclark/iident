import { z } from "zod";

/**
 * What an avatar knows and what it can show while it talks.
 *
 * This is deliberately not tied to any one kind of site. A host (a
 * link-in-bio page, a shop, a portfolio, a course) describes its content as
 * free-text knowledge plus a catalog of items with stable ids. The avatar
 * answers from the knowledge and, when it helps, puts items on screen by id
 * (see `show_items` in src/lib/server/persona.ts). It never sees or invents
 * any other links.
 */

export const ITEM_KINDS = ["link", "product", "video", "image"] as const;
export type ItemKind = (typeof ITEM_KINDS)[number];

export const CONTEXT_LIMITS = {
  knowledge: 12_000,
  items: 60,
  /** Cards the avatar may put on screen in one reply. */
  shownPerReply: 3,
} as const;

const ITEM_ID = /^[A-Za-z0-9_.:-]{1,64}$/;

export function isHttpUrl(value: string): boolean {
  try {
    const { protocol } = new URL(value);
    return protocol === "https:" || protocol === "http:";
  } catch {
    return false;
  }
}

/** Optional fields accept "" from forms and API callers and store nothing. */
const blankToUndefined = (v: unknown) => (typeof v === "string" && !v.trim() ? undefined : v);
const optionalText = (max: number) => z.preprocess(blankToUndefined, z.string().trim().max(max).optional());
const optionalUrl = z.preprocess(
  blankToUndefined,
  z.string().trim().max(2048).refine(isHttpUrl, "Use a full link starting with https://").optional(),
);

export const itemSchema = z
  .object({
    /** Stable id chosen by the host (for example its own block or product id). */
    id: z.string().trim().regex(ITEM_ID, "Item ids are 1 to 64 letters, numbers or _ . : -"),
    kind: z.enum(ITEM_KINDS),
    title: z.string().trim().min(1, "Give it a title.").max(120),
    /** Shown on the card and given to the avatar. */
    description: optionalText(300),
    /** Where the card leads. For videos, the video itself (YouTube, Vimeo or a video file). */
    url: optionalUrl,
    /** Thumbnail, or the picture itself for image items. */
    image: optionalUrl,
    /** Display price for products, e.g. "$25" or "From €40". */
    price: optionalText(32),
    /** Button label, e.g. "Buy", "Listen", "Book". */
    cta: optionalText(24),
    /** Only the avatar sees this: when the item is worth bringing up. */
    notes: optionalText(300),
    /** Opaque host data, echoed back with the item (never shown to the avatar). Not secret. */
    data: z
      .record(z.string().max(40), z.union([z.string().max(300), z.number(), z.boolean()]))
      .refine((d) => Object.keys(d).length <= 20, "Up to 20 data fields.")
      .optional(),
  })
  .superRefine((item, ctx) => {
    if (item.kind === "image") {
      if (!item.image) ctx.addIssue({ code: "custom", path: ["image"], message: "Add the image's link." });
    } else if (!item.url) {
      ctx.addIssue({ code: "custom", path: ["url"], message: "Add a link." });
    }
  });

export type ContextItem = z.infer<typeof itemSchema>;
/** What visitors' browsers receive: everything except the avatar-only notes. */
export type PublicItem = Omit<ContextItem, "notes">;

export const contextSchema = z
  .object({
    /** Facts, FAQs, policies: anything the avatar may say. */
    knowledge: z.string().max(CONTEXT_LIMITS.knowledge).default(""),
    items: z.array(itemSchema).max(CONTEXT_LIMITS.items).default([]),
  })
  .superRefine((context, ctx) => {
    const seen = new Set<string>();
    context.items.forEach((item, i) => {
      if (seen.has(item.id)) {
        ctx.addIssue({ code: "custom", path: ["items", i, "id"], message: `Duplicate item id "${item.id}".` });
      }
      seen.add(item.id);
    });
  });

export type AvatarContext = z.infer<typeof contextSchema>;

export const EMPTY_CONTEXT: AvatarContext = { knowledge: "", items: [] };

export function toPublicItem(item: ContextItem): PublicItem {
  const pub: Partial<ContextItem> = { ...item };
  delete pub.notes;
  return pub as PublicItem;
}

/** First validation problem with an item, for inline form hints. */
export function itemProblem(item: unknown): string | null {
  const result = itemSchema.safeParse(item);
  return result.success ? null : (result.error.issues[0]?.message ?? "Check this item.");
}

export function createItemId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return `i_${Array.from(bytes, (b) => b.toString(36).padStart(2, "0")).join("")}`;
}

/** "open.spotify.com" from a URL, for card captions and the avatar's catalog. */
export function displayHost(url: string | undefined): string {
  if (!url) return "";
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

export type VideoSource =
  | { type: "embed"; provider: "youtube" | "vimeo"; src: string; thumbnail?: string }
  | { type: "file"; src: string };

/**
 * How to play a video item inline: an embedded YouTube or Vimeo player, or a
 * plain video file. Anything else is shown as a link card.
 */
export function videoSource(url: string | undefined): VideoSource | null {
  if (!url) return null;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  const host = u.hostname.replace(/^(www|m)\./, "");

  let youtubeId: string | null = null;
  if (host === "youtu.be") {
    youtubeId = u.pathname.split("/")[1] ?? null;
  } else if (host === "youtube.com" || host === "music.youtube.com" || host === "youtube-nocookie.com") {
    youtubeId = u.pathname === "/watch" ? u.searchParams.get("v") : (u.pathname.match(/^\/(?:shorts|embed|live|v)\/([^/?#]+)/)?.[1] ?? null);
  }
  if (youtubeId && /^[\w-]{6,20}$/.test(youtubeId)) {
    const start = parseStartSeconds(u.searchParams.get("t") ?? u.searchParams.get("start"));
    return {
      type: "embed",
      provider: "youtube",
      src: `https://www.youtube-nocookie.com/embed/${youtubeId}?autoplay=1&playsinline=1&rel=0${start ? `&start=${start}` : ""}`,
      thumbnail: `https://i.ytimg.com/vi/${youtubeId}/hqdefault.jpg`,
    };
  }

  if (host === "vimeo.com" || host === "player.vimeo.com") {
    const m = u.pathname.match(/^\/(?:video\/)?(\d{5,12})(?:\/([\da-f]{6,}))?/);
    if (m) {
      const hash = m[2] ?? u.searchParams.get("h");
      return {
        type: "embed",
        provider: "vimeo",
        src: `https://player.vimeo.com/video/${m[1]}?autoplay=1${hash ? `&h=${hash}` : ""}`,
      };
    }
  }

  if (/\.(mp4|webm|m4v|mov)$/i.test(u.pathname)) return { type: "file", src: u.toString() };
  return null;
}

/** "90", "90s", "1m30s" or "1h2m3s" to seconds. */
function parseStartSeconds(t: string | null): number {
  if (!t) return 0;
  if (/^\d+$/.test(t)) return Number(t);
  const m = t.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/);
  if (!m) return 0;
  return Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0);
}
