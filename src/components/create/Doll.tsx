"use client";

import { useEffect, useRef } from "react";
import { DOLL, dollFiles, dollLayers, dollWidth } from "@/lib/avatar/doll";
import { OUTFIT_PRESETS, type Appearance } from "@/lib/avatar/options";
import { cx } from "@/components/ui";

// Pieces are small and never change, so each is loaded once and kept.
const pictures = new Map<string, Promise<HTMLImageElement>>();
function picture(src: string): Promise<HTMLImageElement> {
  let p = pictures.get(src);
  if (!p) {
    p = new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(`Could not load ${src}`));
      img.src = src;
    });
    p.catch(() => pictures.delete(src));
    pictures.set(src, p);
  }
  return p;
}

/** Pure black cloth would lose its folds; this keeps a little light in the darkest tints. */
function lifted(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const channel = (shift: number) => Math.round(((n >> shift) & 255) * 0.92 + 14);
  return `rgb(${channel(16)}, ${channel(8)}, ${channel(0)})`;
}

/**
 * The mannequin wearing a look, drawn in the browser from ready-made pieces
 * (see src/lib/avatar/doll.ts). A change is on screen as soon as its piece
 * has loaded, which after the first time is at once.
 */
export function Doll({ look, className }: { look: Appearance; className?: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const key = JSON.stringify(look);

  useEffect(() => {
    let stale = false;
    const layers = dollLayers(look);
    Promise.all(dollFiles(look).map(picture))
      .then(async () => {
        const target = canvas.current;
        if (stale || !target) return;
        const ctx = target.getContext("2d")!;
        const scratch = document.createElement("canvas");
        scratch.width = DOLL.width;
        scratch.height = DOLL.height;
        const sc = scratch.getContext("2d")!;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, DOLL.width, DOLL.height);
        // A build is hinted at by making the figure a little wider or narrower, about its middle.
        const wide = dollWidth(look);
        ctx.setTransform(wide, 0, 0, 1, (DOLL.width * (1 - wide)) / 2, 0);
        ctx.drawImage(await picture(DOLL.mannequin), 0, 0);
        for (const layer of layers) {
          const img = await picture(layer.src);
          // Tint: the piece's gray shading multiplied by the color, kept to the piece's own shape.
          sc.globalCompositeOperation = "source-over";
          sc.clearRect(0, 0, DOLL.width, DOLL.height);
          sc.drawImage(img, 0, 0);
          sc.globalCompositeOperation = "multiply";
          sc.fillStyle = lifted(layer.tint);
          sc.fillRect(0, 0, DOLL.width, DOLL.height);
          sc.globalCompositeOperation = "destination-in";
          sc.drawImage(img, 0, 0);
          // What a piece worn over this one hides is cut away.
          sc.globalCompositeOperation = "destination-out";
          for (const over of layer.under) sc.drawImage(await picture(over), 0, 0);
          ctx.drawImage(scratch, 0, 0);
        }
        target.dataset.look = key;
      })
      .catch(() => {});
    return () => {
      stale = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // Fetch the outfit presets' pieces ahead, so the first tap on each is instant too.
  useEffect(() => {
    const ahead = setTimeout(() => {
      for (const preset of OUTFIT_PRESETS) for (const src of dollFiles({ ...look, ...preset.outfit })) void picture(src).catch(() => {});
    }, 1200);
    return () => clearTimeout(ahead);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <canvas
      ref={canvas}
      width={DOLL.width}
      height={DOLL.height}
      role="img"
      aria-label="The look on a mannequin"
      className={cx("size-full object-contain", className)}
    />
  );
}
