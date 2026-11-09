"use client";

/* eslint-disable @next/next/no-img-element -- item images live on any host the creator links to */

import { useState } from "react";
import { displayHost, videoSource, type PublicItem } from "@/lib/avatar/context";
import { cx } from "@/components/ui";

type Props = {
  item: PublicItem;
  dark?: boolean;
  /** A card's link was opened. */
  onOpen?: (item: PublicItem) => void;
  /** Inline media started playing (the avatar should stop talking). */
  onPlay?: (item: PublicItem) => void;
  className?: string;
};

const surface = (dark?: boolean) =>
  dark ? "border-white/15 bg-white/10 text-white hover:bg-white/15" : "border-ink-100 bg-card text-ink-900 hover:border-ink-200";

/**
 * How an item the avatar surfaces looks in the chat. Hosts that render items
 * themselves (with their own components) can ignore this; it only relies on
 * the generic fields every item has.
 */
export function ItemCard(props: Props) {
  if (props.item.kind === "image") return <ImageCard {...props} />;
  if (props.item.kind === "video" && videoSource(props.item.url)) return <VideoCard {...props} />;
  return <LinkCard {...props} />;
}

function LinkCard({ item, dark, onOpen, className }: Props) {
  const host = displayHost(item.url);
  const action = item.kind === "product" ? item.cta || "Buy" : item.cta;
  return (
    <a
      href={item.url}
      target="_blank"
      rel="noopener noreferrer"
      onClick={() => onOpen?.(item)}
      className={cx("flex items-center gap-3 rounded-2xl border p-2 pr-3 backdrop-blur transition-colors", surface(dark), className)}
    >
      <Thumb src={item.image} dark={dark} icon={item.kind === "video" ? <PlayIcon /> : item.kind === "product" ? <BagIcon /> : <LinkIcon />} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{item.title}</span>
        {item.description && <span className={cx("line-clamp-2 text-xs", dark ? "text-white/70" : "text-ink-500")}>{item.description}</span>}
        <span className={cx("mt-0.5 flex items-center gap-1.5 text-[11px]", dark ? "text-white/50" : "text-ink-400")}>
          {item.price && <span className={cx("font-semibold", dark ? "text-white" : "text-ink-800")}>{item.price}</span>}
          {item.price && host && <span aria-hidden>·</span>}
          {host && <span className="truncate">{host}</span>}
        </span>
      </span>
      {action ? (
        <span className="shrink-0 rounded-full bg-accent-500 px-3 py-1.5 text-xs font-medium text-white">{action}</span>
      ) : (
        <ArrowIcon className={dark ? "text-white/60" : "text-ink-400"} />
      )}
    </a>
  );
}

function ImageCard({ item, dark, onOpen, className }: Props) {
  const [failed, setFailed] = useState(false);
  const href = item.url ?? item.image;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      onClick={() => onOpen?.(item)}
      className={cx("block overflow-hidden rounded-2xl border backdrop-blur transition-colors", surface(dark), className)}
    >
      {!failed && item.image && (
        <img
          src={item.image}
          alt={item.title}
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
          className="max-h-44 w-full bg-black/5 object-cover sm:max-h-56"
        />
      )}
      <Caption item={item} dark={dark} />
    </a>
  );
}

function VideoCard({ item, dark, onPlay, className }: Props) {
  const [playing, setPlaying] = useState(false);
  const [posterFailed, setPosterFailed] = useState(false);
  const source = videoSource(item.url)!;
  const poster = item.image ?? (source.type === "embed" ? source.thumbnail : undefined);
  return (
    <div className={cx("overflow-hidden rounded-2xl border backdrop-blur", surface(dark), className)}>
      <div className="relative aspect-video bg-black">
        {playing ? (
          source.type === "embed" ? (
            <iframe
              src={source.src}
              title={item.title}
              allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
              allowFullScreen
              className="absolute inset-0 size-full"
            />
          ) : (
            <video src={source.src} poster={poster} controls autoPlay playsInline className="absolute inset-0 size-full" />
          )
        ) : (
          <button
            type="button"
            aria-label={`Play ${item.title}`}
            onClick={() => {
              setPlaying(true);
              onPlay?.(item);
            }}
            className="group absolute inset-0 grid place-items-center"
          >
            {poster && !posterFailed && (
              <img
                src={poster}
                alt=""
                loading="lazy"
                referrerPolicy="no-referrer"
                onError={() => setPosterFailed(true)}
                className="absolute inset-0 size-full object-cover opacity-90 transition-opacity group-hover:opacity-100"
              />
            )}
            <span className="relative grid size-12 place-items-center rounded-full bg-white/90 text-ink-900 shadow-lg transition-transform group-hover:scale-105">
              <PlayIcon className="ml-0.5 size-5" />
            </span>
          </button>
        )}
      </div>
      <Caption item={item} dark={dark} />
    </div>
  );
}

function Caption({ item, dark }: { item: PublicItem; dark?: boolean }) {
  return (
    <span className="block px-3 py-2">
      <span className="block truncate text-sm font-medium">{item.title}</span>
      {item.description && <span className={cx("line-clamp-2 text-xs", dark ? "text-white/70" : "text-ink-500")}>{item.description}</span>}
    </span>
  );
}

function Thumb({ src, dark, icon }: { src?: string; dark?: boolean; icon: React.ReactNode }) {
  const [failed, setFailed] = useState(false);
  if (src && !failed) {
    return (
      <img
        src={src}
        alt=""
        loading="lazy"
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
        className="size-14 shrink-0 rounded-xl bg-black/5 object-cover"
      />
    );
  }
  return (
    <span className={cx("grid size-14 shrink-0 place-items-center rounded-xl", dark ? "bg-white/10 text-white" : "bg-accent-50 text-accent-600")}>
      {icon}
    </span>
  );
}

const iconProps = { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true } as const;

export function LinkIcon({ className = "size-5" }: { className?: string }) {
  return (
    <svg {...iconProps} className={className}>
      <path d="M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1" />
      <path d="M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1" />
    </svg>
  );
}

export function BagIcon({ className = "size-5" }: { className?: string }) {
  return (
    <svg {...iconProps} className={className}>
      <path d="M5 8h14l-1 12H6L5 8Z" />
      <path d="M9 8V6a3 3 0 0 1 6 0v2" />
    </svg>
  );
}

export function PlayIcon({ className = "size-5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden className={className}>
      <path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5Z" />
    </svg>
  );
}

export function ImageIcon({ className = "size-5" }: { className?: string }) {
  return (
    <svg {...iconProps} className={className}>
      <rect x="3" y="4" width="18" height="16" rx="3" />
      <circle cx="9" cy="10" r="2" />
      <path d="m21 16-5-5-9 9" />
    </svg>
  );
}

function ArrowIcon({ className }: { className?: string }) {
  return (
    <svg {...iconProps} className={cx("size-4 shrink-0", className)}>
      <path d="M7 17 17 7M9 7h8v8" />
    </svg>
  );
}
