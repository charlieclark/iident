/* eslint-disable @next/next/no-img-element -- backdrops are user images served from our own file store */

import type { BackdropView } from "@/lib/avatar/backdrop";
import { cx } from "@/components/ui";

/**
 * The layer behind an avatar: a gradient or a picture, filling its parent.
 * Pictures get a light wash in the backdrop's tone so the avatar and the
 * text over it stay readable whatever the image.
 */
export function Backdrop({ backdrop, className }: { backdrop: BackdropView; className?: string }) {
  return (
    <div aria-hidden className={cx("absolute inset-0 overflow-hidden", className)} style={backdrop.css ? { background: backdrop.css } : undefined}>
      {backdrop.imageUrl && (
        <>
          <img src={backdrop.imageUrl} alt="" className="size-full object-cover" />
          <div className={cx("absolute inset-0", backdrop.tone === "dark" ? "bg-black/20" : "bg-white/10")} />
          {/* A shade at the top keeps the name and tagline readable over busy pictures. */}
          <div
            className={cx(
              "absolute inset-x-0 top-0 h-40 bg-gradient-to-b to-transparent",
              backdrop.tone === "dark" ? "from-black/55" : "from-white/70",
            )}
          />
        </>
      )}
    </div>
  );
}
